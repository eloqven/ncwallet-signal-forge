PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS ingestion_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_updated_at TEXT,
  signal_view_count INTEGER NOT NULL DEFAULT 0,
  wallet_sync_count INTEGER NOT NULL DEFAULT 0,
  wallet_page_view_count INTEGER NOT NULL DEFAULT 0,
  wallet_history_row_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  notes_json TEXT
);

CREATE TABLE IF NOT EXISTS raw_signal_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT NOT NULL UNIQUE,
  saved_at TEXT,
  captured_at TEXT,
  pair_label TEXT,
  base_symbol TEXT NOT NULL,
  quote_symbol TEXT NOT NULL,
  timeframe TEXT,
  ma_mode TEXT,
  market_json TEXT,
  signals_json TEXT,
  forecast_json TEXT,
  dataset_json TEXT
);

CREATE TABLE IF NOT EXISTS raw_wallet_syncs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dedupe_key TEXT UNIQUE,
  saved_at TEXT,
  synced_at TEXT,
  wallet_total_usd REAL,
  funded_wallet_count INTEGER,
  visible_count INTEGER,
  active_wallet_symbol TEXT,
  last_transaction_json TEXT,
  wallets_json TEXT,
  totals_by_symbol_json TEXT,
  status_counts_json TEXT
);

CREATE TABLE IF NOT EXISTS raw_wallet_page_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_key TEXT UNIQUE,
  saved_at TEXT,
  synced_at TEXT,
  symbol TEXT,
  range_label TEXT,
  page_title TEXT,
  url TEXT,
  price_usd REAL,
  change_usd REAL,
  change_percent REAL,
  holding_amount REAL,
  total_usd REAL,
  chart_view_box TEXT,
  chart_line_path TEXT,
  chart_fill_path TEXT,
  payload_json TEXT
);

CREATE TABLE IF NOT EXISTS feature_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_signal_view_id INTEGER NOT NULL,
  pair_key TEXT NOT NULL,
  timeframe TEXT,
  ma_mode TEXT,
  anchor_time TEXT,
  ratio_value REAL,
  rsi REAL,
  bar_count INTEGER,
  feature_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_signal_view_id) REFERENCES raw_signal_views(id)
);

CREATE TABLE IF NOT EXISTS forecast_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_key TEXT NOT NULL,
  model_name TEXT NOT NULL,
  model_version TEXT NOT NULL,
  anchor_time TEXT,
  horizon_label TEXT,
  prediction_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'placeholder'
);

CREATE INDEX IF NOT EXISTS idx_raw_signal_views_pair_time
  ON raw_signal_views(base_symbol, quote_symbol, captured_at);

CREATE INDEX IF NOT EXISTS idx_feature_rows_pair_time
  ON feature_rows(pair_key, anchor_time);

CREATE INDEX IF NOT EXISTS idx_forecast_runs_pair_time
  ON forecast_runs(pair_key, anchor_time);
