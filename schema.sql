CREATE TABLE IF NOT EXISTS links (
  id BIGSERIAL PRIMARY KEY,
  slug VARCHAR(32) UNIQUE NOT NULL,
  product_name VARCHAR(200) NOT NULL,
  destination_url TEXT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS clicks (
  id BIGSERIAL PRIMARY KEY,
  link_id BIGINT NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  clicked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address VARCHAR(100),
  country VARCHAR(100),
  region VARCHAR(100),
  city VARCHAR(100),
  device VARCHAR(50),
  browser VARCHAR(100),
  os VARCHAR(100),
  user_agent TEXT
);

CREATE INDEX IF NOT EXISTS idx_clicks_link_id ON clicks(link_id);
CREATE INDEX IF NOT EXISTS idx_clicks_clicked_at ON clicks(clicked_at);
CREATE INDEX IF NOT EXISTS idx_links_platform ON links(platform);
