# ML Sidecar

Minimal local sidecar for future model work.

## Run

```powershell
cd ml-sidecar
npm start
```

Default URL: `http://127.0.0.1:4280`

## Routes

- `GET /health`
- `GET /api/summary`
- `GET /api/storage`
- `GET /api/readiness`
- `GET /api/features/preview`
- `GET /api/predict/BTC_ETH`

## Storage Layout

- `db/schema.sql`: SQLite target schema
- `db/migrations/0001_init.sql`: first migration stub
- `db/ml-sidecar.sqlite`: runtime database file, generated locally and ignored by Git

The sidecar still reads source feature inputs from `../data/surf-db.json`. Prediction calls now attempt to initialize the SQLite database and append a row to `forecast_runs` with model metadata, anchor time, horizon label, and the JSON prediction payload.

SQLite uses Node's built-in `node:sqlite` module when available. On older Node versions the API continues to run, but `/api/storage` reports that SQLite persistence is unavailable.
