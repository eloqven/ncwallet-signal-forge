# ML Sidecar

Minimal local sidecar for future model work.

## Run

```powershell
cd D:\ncwallet_daily_anal\ml-sidecar
npm start
```

Default URL: `http://127.0.0.1:4280`

## Routes

- `GET /health`
- `GET /api/summary`
- `GET /api/predict/BTC_ETH`

## Storage Layout

- `db/schema.sql`: SQLite target schema
- `db/migrations/0001_init.sql`: first migration stub
- `db/ml-sidecar.sqlite`: planned runtime database file

Current scaffold reads source data from `../data/surf-db.json`. It does not ingest into SQLite yet.
