const $ = (id) => document.getElementById(id);
let chart;

async function api(url, options = {}) {
  const res = await fetch(url, { credentials: "same-origin", ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro na requisição.");
  return data;
}

function showDashboard() {
  $("loginView").classList.add("hidden");
  $("dashboard").classList.remove("hidden");
  $("logoutBtn").classList.remove("hidden");
  loadAll();
}

async function checkAuth() {
  try {
    await api("/api/auth/me");
    showDashboard();
  } catch {
    $("loginView").classList.remove("hidden");
  }
}

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginMsg").textContent = "";
  try {
    await api("/api/auth/login", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ username: $("username").value, password: $("password").value })
    });
    showDashboard();
  } catch (err) {
    $("loginMsg").textContent = err.message;
  }
});

$("logoutBtn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  location.reload();
});

$("linkForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const data = await api("/api/links", {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        productName: $("productName").value,
        destinationUrl: $("destinationUrl").value
      })
    });
    $("createdLink").classList.remove("hidden");
    $("createdLink").innerHTML = `<span class="text-slate-400">Link:</span>
      <a class="text-indigo-300 underline break-all" href="${escapeHtml(data.trackingUrl)}" target="_blank">${escapeHtml(data.trackingUrl)}</a>`;
    $("linkForm").reset();
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

$("filterBtn").addEventListener("click", loadAnalytics);

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;" }[c]));
}

async function loadAll() {
  await Promise.all([loadLinks(), loadAnalytics()]);
}

async function loadLinks() {
  const links = await api("/api/links");
  $("linksCount").textContent = links.length;
  $("linksTable").innerHTML = links.map(l => `
    <tr class="border-t border-slate-800">
      <td class="p-2">${escapeHtml(l.product_name)}</td>
      <td class="text-center">${escapeHtml(l.platform)}</td>
      <td class="text-center font-semibold">${l.clicks}</td>
      <td class="text-center"><a target="_blank" class="text-indigo-300 underline" href="/r/${encodeURIComponent(l.slug)}">Abrir</a></td>
    </tr>`).join("");
}

async function loadAnalytics() {
  const params = new URLSearchParams();
  if ($("from").value) params.set("from", $("from").value);
  if ($("to").value) params.set("to", $("to").value);
  if ($("platform").value) params.set("platform", $("platform").value);
  if ($("productFilter").value) params.set("product", $("productFilter").value);

  const data = await api("/api/analytics?" + params.toString());
  $("totalClicks").textContent = data.summary.total_clicks;
  $("productsClicked").textContent = data.summary.products_clicked;

  const labels = data.byProduct.map(x => x.product_name);
  const values = data.byProduct.map(x => x.clicks);

  if (chart) chart.destroy();
  chart = new Chart($("chart"), {
    type: "bar",
    data: { labels, datasets: [{ label: "Cliques", data: values }] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#cbd5e1" } } },
      scales: {
        x: { ticks: { color: "#94a3b8" } },
        y: { beginAtZero: true, ticks: { color: "#94a3b8" } }
      }
    }
  });

  $("historyTable").innerHTML = data.history.map(x => {
    const when = new Date(x.clicked_at).toLocaleString("pt-BR");
    const location = [x.city, x.region, x.country].filter(Boolean).join(", ") || "Indisponível";
    return `<tr class="border-t border-slate-800">
      <td class="p-2 whitespace-nowrap">${escapeHtml(when)}</td>
      <td>${escapeHtml(x.product_name)}</td>
      <td>${escapeHtml(x.platform)}</td>
      <td>${escapeHtml(x.device || "-")}</td>
      <td>${escapeHtml(x.browser || "-")} / ${escapeHtml(x.os || "-")}</td>
      <td>${escapeHtml(location)}</td>
    </tr>`;
  }).join("");
}

checkAuth();
