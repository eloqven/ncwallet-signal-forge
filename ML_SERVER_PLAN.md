# Sidecar Plans

## ML Sidecar Plan

## Purpose
Build a separate local server with its own button/UI that uses the data already gathered by this app, stores it in a model-ready database, and later serves forecasts once enough history exists.

Status: proposed handoff plan only. No model training is assumed yet.

## Current Inputs Already Available
- `data/surf-db.json`
- `signalViews[]`
- `walletSyncs[]`
- `walletPageViews[]`
- `GET /api/local-db/summary`
- `POST /api/local-db/signal-view`
- `GET /api/ncwallet/history`
- `POST /api/ncwallet/range`

## Current Raw Data Shapes
### `signalViews[]`
Tracks what was actually viewed in Signal View.

```json
{
  "dedupeKey": "BTC__ETH__7__sma__1777377600000",
  "savedAt": "2026-04-28T12:58:01.258Z",
  "capturedAt": "2026-04-28T12:58:01.252Z",
  "pairLabel": "BTC / ETH",
  "baseSymbol": "BTC",
  "quoteSymbol": "ETH",
  "timeframe": "7",
  "maMode": "sma",
  "market": {},
  "signals": {},
  "forecast": {},
  "dataset": {}
}
```

### `walletSyncs[]`
Tracks wallet-level sync snapshots.

```json
{
  "dedupeKey": "..."
}
```

Actual fields in code:
- `savedAt`
- `syncedAt`
- `walletTotalUsd`
- `fundedWalletCount`
- `visibleCount`
- `activeWalletSymbol`
- `lastTransaction`
- `wallets[]`
- `totalsBySymbol{}`
- `statusCounts{}`

### `walletPageViews[]`
Tracks opened NC Wallet coin-page mirror snapshots.

Actual fields in code:
- `savedAt`
- `syncedAt`
- `symbol`
- `rangeLabel`
- `titleLine`
- `pageTitle`
- `url`
- `priceUsdText`
- `priceUsd`
- `changeText`
- `changeUsd`
- `changePercent`
- `referencePriceUsdText`
- `referencePriceUsd`
- `referenceDateLabel`
- `address`
- `balanceText`
- `holdingAmount`
- `totalUsdText`
- `totalUsd`
- `timeframeOptions[]`
- `chartViewBox`
- `chartLinePath`
- `chartFillPath`
- `actions[]`
- `visibleHistoryCount`
- `historyPrompt`

## Target Shape
### Separate server
- Suggested folder: `ml-sidecar/`
- Suggested local port: `4280`
- Suggested stack: Node.js + SQLite
- Reason: it matches the current app’s local-first setup and keeps the first branch small

### Separate button in main app
- Add one button in the current app: `Open ML Lab`
- Button target: `http://127.0.0.1:4280`
- This UI should stay separate from the main dashboard

### First-phase responsibility split
- Main app keeps gathering and saving raw user-viewed data
- ML sidecar ingests that raw data into a structured database
- ML sidecar exposes placeholder prediction endpoints until sample count is sufficient

## Current Checkpoint
The sidecar already exists and should be extended, not replaced.

Current implementation focus:
- keep reading `data/surf-db.json`
- expose inspection routes before training routes
- normalize saved signal snapshots into stable feature rows
- measure coverage honestly before any model claims

## Proposed Database
Use SQLite first. Keep raw tables close to current JSON shapes, then add derived tables.

### Raw tables
#### `raw_signal_views`
- `id`
- `dedupe_key`
- `saved_at`
- `captured_at`
- `pair_label`
- `base_symbol`
- `quote_symbol`
- `timeframe`
- `ma_mode`
- `market_json`
- `signals_json`
- `forecast_json`
- `dataset_json`

#### `raw_wallet_syncs`
- `id`
- `dedupe_key`
- `saved_at`
- `synced_at`
- `wallet_total_usd`
- `funded_wallet_count`
- `visible_count`
- `active_wallet_symbol`
- `last_transaction_json`
- `wallets_json`
- `totals_by_symbol_json`
- `status_counts_json`

#### `raw_wallet_page_views`
- `id`
- `content_key`
- `saved_at`
- `synced_at`
- `symbol`
- `range_label`
- `title_line`
- `page_title`
- `url`
- `price_usd`
- `price_usd_text`
- `change_usd`
- `change_percent`
- `change_text`
- `reference_price_usd`
- `reference_price_usd_text`
- `reference_date_label`
- `address`
- `holding_amount`
- `balance_text`
- `total_usd`
- `total_usd_text`
- `timeframe_options_json`
- `chart_view_box`
- `chart_line_path`
- `chart_fill_path`
- `actions_json`
- `visible_history_count`
- `history_prompt`

### Derived tables
#### `feature_rows`
One row per prediction candidate.

- `id`
- `source_signal_view_id`
- `base_symbol`
- `quote_symbol`
- `timeframe`
- `ma_mode`
- `anchor_time`
- `ratio_value`
- `base_price`
- `quote_price`
- `rsi`
- `trend_label`
- `momentum_label`
- `volume_label`
- `pattern_label`
- `extra_signals_json`
- `bar_count`
- `feature_json`
- `created_at`

#### `forecast_runs`
- `id`
- `model_version`
- `base_symbol`
- `quote_symbol`
- `timeframe`
- `forecast_horizon`
- `anchor_time`
- `prediction_json`
- `confidence_json`
- `status`
- `created_at`

#### `forecast_actuals`
- `id`
- `forecast_run_id`
- `resolved_at`
- `actual_json`
- `error_json`

#### `model_registry`
- `id`
- `model_name`
- `model_version`
- `training_window_start`
- `training_window_end`
- `feature_schema_version`
- `artifact_path`
- `metrics_json`
- `created_at`

## Proposed Server Routes
### Ingestion
- `POST /api/ingest/signal-view`
- `POST /api/ingest/wallet-sync`
- `POST /api/ingest/wallet-page-view`
- `POST /api/ingest/bootstrap-from-json`

### Read/UI
- `GET /api/summary`
- `GET /api/datasets/recent`
- `GET /api/forecasts/latest`
- `GET /api/forecasts/history`
- `GET /api/models`

### Ops
- `GET /health`
- `POST /api/jobs/extract-features`
- `POST /api/jobs/train-baseline`
- `POST /api/jobs/backfill-actuals`

## Suggested Folder Layout
```text
ml-sidecar/
  server.js
  db/
    ml.sqlite
    migrations/
  services/
    ingest.js
    features.js
    forecasts.js
    training.js
  routes/
    ingest.js
    forecasts.js
    summary.js
  public/
    index.html
  models/
    registry/
```

## Stories
### Story 1: bootstrap the sidecar server
As the operator, I want a separate ML server with its own UI so I can keep forecasting work isolated from the dashboard app.

Acceptance:
- `ml-sidecar/` boots on its own port
- `GET /health` returns OK
- sidecar static page opens in browser

### Story 2: add a button from the main app to the ML sidecar
As the operator, I want one button in the current app that opens the ML sidecar UI.

Acceptance:
- button is visible in the main app
- button opens the sidecar page in a new tab/window
- no existing dashboard behavior breaks

### Story 3: ingest existing gathered data
As the operator, I want the sidecar to import the current `surf-db.json` file so the ML stack starts with real collected data.

Acceptance:
- sidecar can read `signalViews`
- sidecar can read `walletSyncs`
- sidecar can read `walletPageViews`
- imported counts match source counts

### Story 4: normalize raw data into model-ready rows
As the operator, I want feature extraction from the gathered raw data so future training does not depend on UI JSON blobs.

Acceptance:
- `feature_rows` gets populated from `signalViews`
- anchor time is preserved
- one row can be traced back to its source snapshot

### Story 5: register placeholder forecast runs
As the operator, I want prediction records to exist before real ML training so the app contract is stable early.

Acceptance:
- forecast endpoint returns structured placeholder output
- response clearly marks low-data / no-model status
- placeholder records are written to `forecast_runs`

### Story 6: backfill actual outcomes later
As the operator, I want forecast records to be matched with later observed market data so the system can score itself.

Acceptance:
- forecast run can be resolved into `forecast_actuals`
- error metrics are stored per run
- unresolved runs remain queryable

### Story 7: train the first baseline model
As the operator, I want a baseline model path ready once the sample threshold is reached.

Acceptance:
- training job reads `feature_rows`
- model metadata is written to `model_registry`
- metrics are stored even if weak

## 8 Hour Sprint Story Plan
### Hour 1: feature extraction baseline
Story:
- turn `signalViews[]` into one deterministic feature row per saved view

Implementation:
- normalize pair, timeframe, MA mode, prices, ratio value, RSI, labels, forecast fields
- derive compact bar metrics from `dataset.bars`

Acceptance:
- `GET /api/features/preview` returns stable rows from the current JSON store
- rows are traceable back to `dedupeKey`

### Hour 2: readiness inspection
Story:
- show how much usable pair/timeframe data actually exists

Implementation:
- group feature rows by pair and timeframe
- count total rows, forecast-labeled rows, and latest sample time

Acceptance:
- `GET /api/readiness` exposes pair/timeframe coverage
- missing forecast labels are visible, not hidden

### Hour 3: SQLite bootstrap import
Story:
- move raw JSON inputs into SQLite raw tables without losing traceability

Implementation:
- bootstrap `raw_signal_views`, `raw_wallet_syncs`, and `raw_wallet_page_views`
- upsert by current dedupe/content keys

Acceptance:
- rerunning bootstrap does not explode duplicates
- imported counts can be compared to source counts

### Hour 4: persisted derived feature rows
Story:
- persist extracted feature rows instead of computing them only in memory

Implementation:
- add `feature_rows`
- store schema version, anchor time, derived metrics, and target fields

Acceptance:
- feature rows can be rebuilt from raw tables
- schema version stays attached to every derived row

### Hour 5: forecast outcome resolver
Story:
- connect old saved forecasts to later observed data so the sidecar can score outcomes

Implementation:
- backfill resolved actuals where later bars already exist
- write errors into `forecast_actuals`

Acceptance:
- at least one forecast can resolve to an actual path
- unresolved forecasts remain explicitly unresolved

### Hour 6: supervised export path
Story:
- export clean, labeled rows for first-pass training experiments

Implementation:
- add a dataset export route or job
- exclude unlabeled rows unless explicitly requested

Acceptance:
- exported rows are traceable back to source snapshots
- labeled and unlabeled counts are reported separately

### Hour 7: baseline model runner
Story:
- prove the end-to-end ML path with one conservative baseline run

Implementation:
- run one simple baseline model and one naive benchmark
- store run metadata and metrics in `model_registry`

Acceptance:
- a local training run completes on current data
- outputs are versioned and inspectable

### Hour 8: ML lab inspection surface
Story:
- expose model/data state in one small page that is easy to inspect

Implementation:
- show counts, readiness, latest trained model, and latest scored forecast batch
- keep it separate from the main dashboard UI

Acceptance:
- a dev can tell what data exists, what is missing, and what the next ML step should be
- the sidecar has one human-readable inspection page

## First Branch Cut
Suggested branch name: `feat/ml-sidecar-foundation`

Scope for that branch:
- create `ml-sidecar/`
- add SQLite schema + migrations
- add bootstrap import from `data/surf-db.json`
- add sidecar landing page
- add `Open ML Lab` button in the current app
- return placeholder forecast responses only

## Not In Scope For The First Branch
- real training quality work
- cloud deployment
- auth changes
- replacing the current dashboard server
- automatic trading or wallet actions

## Handoff Note
The safest first move is to treat the current app as the raw data producer and the ML sidecar as a consumer. That keeps the existing dashboard stable while the separate branch builds the ingestion, schema, and forecast contract.
