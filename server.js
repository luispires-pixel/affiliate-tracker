import "dotenv/config";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import pg from "pg";
import geoip from "geoip-lite";
import { UAParser } from "ua-parser-js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const { Pool } = pg;
const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (
  process.env.BASE_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : `http://localhost:${PORT}`)
).replace(/\/$/, "");
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET precisa ter pelo menos 32 caracteres.");
}
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD) {
  throw new Error("Defina ADMIN_USERNAME e ADMIN_PASSWORD no .env.");
}
if (!process.env.DATABASE_URL) {
  throw new Error("Defina DATABASE_URL no .env.");
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(express.json({ limit: "100kb" }));
app.use(cookieParser());

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false
});

function auth(req, res, next) {
  const token = req.cookies.dashboard_token;
  if (!token) return res.status(401).json({ error: "Não autenticado." });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.clearCookie("dashboard_token", cookieOptions());
    return res.status(401).json({ error: "Sessão expirada." });
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  };
}

function createSlug() {
  return crypto.randomBytes(6).toString("base64url");
}

function maskIp(ip) {
  if (!ip) return null;
  if (ip.includes(":")) {
    const parts = ip.split(":");
    return parts.slice(0, 4).join(":") + "::";
  }
  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0` : ip;
}

function detectPlatform(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("mercadolivre") || host.includes("mercadolibre")) return "Mercado Livre";
  if (host.includes("shopee")) return "Shopee";
  if (host.includes("amazon")) return "Amazon";
  return "Outro";
}

function validateDestination(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("URL inválida.");
  }
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new Error("A URL precisa começar com http:// ou https://.");
  }
  if (!u.hostname || u.hostname.length > 253) {
    throw new Error("Hostname inválido.");
  }
  return u.toString();
}

function getClientIp(req) {
  // Express trust proxy + req.ip gives the client IP behind a trusted proxy.
  return req.ip || req.socket.remoteAddress || "";
}

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: "Usuário ou senha inválidos." });
  }

  const token = jwt.sign({ username, role: "admin" }, JWT_SECRET, { expiresIn: "8h" });
  res.cookie("dashboard_token", token, cookieOptions());
  res.json({ ok: true });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("dashboard_token", cookieOptions());
  res.json({ ok: true });
});

app.get("/api/auth/me", auth, (req, res) => {
  res.json({ authenticated: true, username: req.user.username });
});

app.use("/api", apiLimiter);

app.post("/api/links", auth, async (req, res) => {
  try {
    const productName = String(req.body?.productName || "").trim();
    const rawUrl = String(req.body?.destinationUrl || "").trim();

    if (productName.length < 2 || productName.length > 200) {
      return res.status(400).json({ error: "Nome do produto deve ter entre 2 e 200 caracteres." });
    }

    const destinationUrl = validateDestination(rawUrl);
    const platform = detectPlatform(destinationUrl);

    let link;
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = createSlug();
      try {
        const result = await pool.query(
          `INSERT INTO links (slug, product_name, destination_url, platform)
           VALUES ($1, $2, $3, $4)
           RETURNING id, slug, product_name, destination_url, platform, created_at`,
          [slug, productName, destinationUrl, platform]
        );
        link = result.rows[0];
        break;
      } catch (err) {
        if (err.code !== "23505") throw err;
      }
    }

    if (!link) throw new Error("Não foi possível gerar um slug único.");

    res.status(201).json({
      ...link,
      trackingUrl: `${BASE_URL}/r/${link.slug}`
    });
  } catch (err) {
    console.error("create link:", err);
    res.status(400).json({ error: err.message || "Erro ao criar link." });
  }
});

app.get("/api/links", auth, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        l.id, l.slug, l.product_name, l.destination_url, l.platform,
        l.created_at, l.active,
        COUNT(c.id)::int AS clicks
      FROM links l
      LEFT JOIN clicks c ON c.link_id = l.id
      GROUP BY l.id
      ORDER BY l.created_at DESC
      LIMIT 500
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao carregar links." });
  }
});

app.get("/api/analytics", auth, async (req, res) => {
  try {
    const { from, to, platform, product } = req.query;
    const params = [];
    const where = [];

    if (from) {
      params.push(`${from}T00:00:00`);
      where.push(`c.clicked_at >= $${params.length}::timestamptz`);
    }
    if (to) {
      params.push(`${to}T23:59:59.999`);
      where.push(`c.clicked_at <= $${params.length}::timestamptz`);
    }
    if (platform) {
      params.push(String(platform));
      where.push(`l.platform = $${params.length}`);
    }
    if (product) {
      params.push(`%${String(product)}%`);
      where.push(`l.product_name ILIKE $${params.length}`);
    }

    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const summary = await pool.query(`
      SELECT COUNT(*)::int AS total_clicks,
             COUNT(DISTINCT c.link_id)::int AS products_clicked
      FROM clicks c
      JOIN links l ON l.id = c.link_id
      ${clause}
    `, params);

    const byProduct = await pool.query(`
      SELECT l.product_name, l.platform, COUNT(*)::int AS clicks
      FROM clicks c
      JOIN links l ON l.id = c.link_id
      ${clause}
      GROUP BY l.product_name, l.platform
      ORDER BY clicks DESC
      LIMIT 100
    `, params);

    const history = await pool.query(`
      SELECT
        c.clicked_at, l.product_name, l.platform, l.slug,
        c.device, c.browser, c.os, c.country, c.region, c.city
      FROM clicks c
      JOIN links l ON l.id = c.link_id
      ${clause}
      ORDER BY c.clicked_at DESC
      LIMIT 1000
    `, params);

    res.json({
      summary: summary.rows[0],
      byProduct: byProduct.rows,
      history: history.rows
    });
  } catch (err) {
    console.error("analytics:", err);
    res.status(400).json({ error: "Filtros inválidos ou erro no relatório." });
  }
});

// This route is intentionally outside the /api auth middleware.
// It logs the click and redirects even if analytics storage fails.
app.get("/r/:slug", async (req, res) => {
  const slug = String(req.params.slug || "");
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(slug)) return res.status(404).send("Link não encontrado.");

  let link;
  try {
    const result = await pool.query(
      "SELECT id, destination_url, active FROM links WHERE slug = $1 LIMIT 1",
      [slug]
    );
    link = result.rows[0];
  } catch (err) {
    console.error("lookup redirect:", err);
    return res.status(503).send("Serviço temporariamente indisponível.");
  }

  if (!link || !link.active) return res.status(404).send("Link não encontrado.");

  try {
    const ip = getClientIp(req);
    const maskedIp = maskIp(ip);
    const geo = geoip.lookup(ip);
    const ua = new UAParser(req.get("user-agent") || "").getResult();

    await pool.query(
      `INSERT INTO clicks
       (link_id, ip_address, country, region, city, device, browser, os, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        link.id,
        maskedIp,
        geo?.country || null,
        geo?.region || null,
        geo?.city || null,
        ua.device.type || "desktop",
        ua.browser.name || "Unknown",
        ua.os.name || "Unknown",
        req.get("user-agent") || null
      ]
    );
  } catch (err) {
    // Never turn a tracking failure into a lost affiliate click.
    console.error("click tracking failed:", err);
  }

  res.redirect(302, link.destination_url);
});

app.use(express.static(path.join(__dirname, "public")));

app.use((_req, res) => {
  res.status(404).sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((err, _req, res, _next) => {
  console.error("unhandled:", err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

export default app;