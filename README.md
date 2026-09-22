# Affiliate Tracker

Dashboard de links rastreáveis para afiliados.

## Stack

- Node.js 20+
- Express
- PostgreSQL
- Tailwind via CDN
- Chart.js
- JWT em cookie HttpOnly
- geoip-lite + UAParser

## Rodar local

1. Instale Node.js 20+ e Docker.
2. Copie `.env.example` para `.env`.
3. Suba o PostgreSQL:
   `docker compose up -d`
4. No `.env`, use:
   `DATABASE_URL=postgresql://tracker:tracker@localhost:5432/tracker`
5. Troque `JWT_SECRET` e `ADMIN_PASSWORD`.
6. Instale:
   `npm install`
7. Rode:
   `npm run dev`
8. Abra:
   `http://localhost:3000`

## Como usar

1. Entre no painel.
2. Informe o nome do produto.
3. Cole o URL final/afiliado.
4. O sistema cria `/r/<slug>`.
5. Cada visita ao slug grava horário, IP mascarado, localização aproximada, dispositivo, navegador e sistema operacional.
6. O servidor então responde com redirect 302 para o destino.

## Produção

Para produção, prefira PostgreSQL gerenciado. O projeto funciona com Supabase usando `DATABASE_URL`.

Não use SQLite local em um servidor com filesystem efêmero.

## Privacidade

O código mascara o IP antes de gravá-lo no banco. A geolocalização é aproximada e depende da base GeoIP. Verifique LGPD, política de privacidade e termos do programa de afiliados que você usar.

## Importante

Links de afiliado podem ter regras próprias sobre encurtamento, redirecionamento, cloaking e parâmetros. Confirme os termos do Mercado Livre, Shopee, Amazon ou da rede de afiliados antes de publicar em escala.
