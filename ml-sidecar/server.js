const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.ML_SIDECAR_HOST || '127.0.0.1';
const PORT = Number(process.env.ML_SIDECAR_PORT || 4280);
const SURF_DB_PATH = path.resolve(__dirname, '../data/surf-db.json');

function readSurfDb() {
  const raw = fs.readFileSync(SURF_DB_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    meta: parsed.meta || {},
    signalViews: Array.isArray(parsed.signalViews) ? parsed.signalViews : [],
    walletSyncs: Array.isArray(parsed.walletSyncs) ? parsed.walletSyncs : [],
    walletPageViews: Array.isArray(parsed.walletPageViews) ? parsed.walletPageViews : [],
    walletHistoryRows: Array.isArray(parsed.walletHistoryRows) ? parsed.walletHistoryRows : [],
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function parsePair(rawPair) {
  const normalized = String(rawPair || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
  const [base, quote] = normalized.split('/');
  if (!base || !quote) {
    return null;
  }
  return { base, quote, pair: `${base}/${quote}` };
}

function summarizePairs(signalViews) {
  const map = new Map();
  for (const view of signalViews) {
    const base = String(view.baseSymbol || '').toUpperCase();
    const quote = String(view.quoteSymbol || '').toUpperCase();
    if (!base || !quote) {
      continue;
    }
    const pair = `${base}/${quote}`;
    const current = map.get(pair) || {
      pair,
      samples: 0,
      timeframes: new Set(),
      latestCapturedAt: null,
    };
    current.samples += 1;
    if (view.timeframe) {
      current.timeframes.add(String(view.timeframe));
    }
    const capturedAt = view.capturedAt || view.savedAt || null;
    if (capturedAt && (!current.latestCapturedAt || capturedAt > current.latestCapturedAt)) {
      current.latestCapturedAt = capturedAt;
    }
    map.set(pair, current);
  }
  return Array.from(map.values())
    .map((entry) => ({
      pair: entry.pair,
      samples: entry.samples,
      timeframes: Array.from(entry.timeframes).sort(),
      latestCapturedAt: entry.latestCapturedAt,
    }))
    .sort((a, b) => b.samples - a.samples || a.pair.localeCompare(b.pair));
}

function buildSummary(db) {
  const pairSummary = summarizePairs(db.signalViews);
  const latestSignalView = db.signalViews
    .slice()
    .sort((a, b) => String(b.capturedAt || b.savedAt || '').localeCompare(String(a.capturedAt || a.savedAt || '')))[0] || null;
  const latestWalletSync = db.walletSyncs
    .slice()
    .sort((a, b) => String(b.syncedAt || b.savedAt || '').localeCompare(String(a.syncedAt || a.savedAt || '')))[0] || null;

  return {
    source: {
      surfDbPath: SURF_DB_PATH,
      exists: fs.existsSync(SURF_DB_PATH),
      updatedAt: db.meta.updatedAt || null,
      createdAt: db.meta.createdAt || null,
    },
    counts: {
      signalViews: db.signalViews.length,
      walletSyncs: db.walletSyncs.length,
      walletPageViews: db.walletPageViews.length,
      walletHistoryRows: db.walletHistoryRows.length,
      pairs: pairSummary.length,
    },
    latest: {
      signalViewAt: latestSignalView ? latestSignalView.capturedAt || latestSignalView.savedAt || null : null,
      walletSyncAt: latestWalletSync ? latestWalletSync.syncedAt || latestWalletSync.savedAt || null : null,
    },
    pairs: pairSummary.slice(0, 20),
    storage: {
      sqliteSchema: path.join(__dirname, 'db', 'schema.sql'),
      sqliteMigrations: path.join(__dirname, 'db', 'migrations'),
      sqliteFilePlanned: path.join(__dirname, 'db', 'ml-sidecar.sqlite'),
    },
  };
}

function getLatestSignalView(signalViews, base, quote) {
  const matches = signalViews.filter((view) =>
    String(view.baseSymbol || '').toUpperCase() === base &&
    String(view.quoteSymbol || '').toUpperCase() === quote
  );
  matches.sort((a, b) => String(b.capturedAt || b.savedAt || '').localeCompare(String(a.capturedAt || a.savedAt || '')));
  return matches[0] || null;
}

function buildPlaceholderPrediction(view) {
  const datasetBars = Array.isArray(view?.dataset?.bars) ? view.dataset.bars : [];
  const latestBar = datasetBars[datasetBars.length - 1] || null;
  const forecastPoints = Array.isArray(view?.forecast?.points) ? view.forecast.points : [];
  const lastForecastPoint = forecastPoints[forecastPoints.length - 1] || null;
  const anchorClose = safeNumber(view?.forecast?.anchorClose) ?? safeNumber(latestBar?.close);

  if (!view) {
    return {
      modelStatus: 'no-pair-data',
      prediction: null,
    };
  }

  return {
    modelStatus: 'placeholder-from-gathered-data',
    prediction: {
      anchorTime: view.capturedAt || view.savedAt || null,
      anchorClose,
      horizonLabel: view?.forecast?.detail || null,
      summary: view?.forecast?.summary || 'No saved forecast on the latest sample.',
      targetValue: safeNumber(lastForecastPoint?.value) ?? anchorClose,
      targetTime: lastForecastPoint?.time || null,
      source: lastForecastPoint ? 'saved-forecast' : 'latest-anchor-close',
    },
  };
}

function handleHealth(res) {
  sendJson(res, 200, {
    ok: true,
    service: 'ml-sidecar',
    port: PORT,
    surfDbPath: SURF_DB_PATH,
    surfDbPresent: fs.existsSync(SURF_DB_PATH),
    checkedAt: new Date().toISOString(),
  });
}

function handleSummary(res) {
  try {
    const db = readSurfDb();
    sendJson(res, 200, buildSummary(db));
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: 'summary_read_failed',
      detail: error.message,
    });
  }
}

function handlePredict(res, rawPair) {
  const parsedPair = parsePair(rawPair);
  if (!parsedPair) {
    sendJson(res, 400, {
      ok: false,
      error: 'invalid_pair',
      detail: 'Use a pair like BTC_ETH, BTC-ETH, or BTC/ETH.',
    });
    return;
  }

  try {
    const db = readSurfDb();
    const latestView = getLatestSignalView(db.signalViews, parsedPair.base, parsedPair.quote);
    const sampleCount = db.signalViews.filter((view) =>
      String(view.baseSymbol || '').toUpperCase() === parsedPair.base &&
      String(view.quoteSymbol || '').toUpperCase() === parsedPair.quote
    ).length;
    const payload = buildPlaceholderPrediction(latestView);

    sendJson(res, latestView ? 200 : 404, {
      ok: Boolean(latestView),
      pair: parsedPair.pair,
      samples: sampleCount,
      latestCapturedAt: latestView ? latestView.capturedAt || latestView.savedAt || null : null,
      latestTimeframe: latestView ? latestView.timeframe || null : null,
      latestMaMode: latestView ? latestView.maMode || null : null,
      latestSignals: latestView ? latestView.signals || {} : {},
      ...payload,
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: 'predict_read_failed',
      detail: error.message,
    });
  }
}

function handleIndex(res) {
  const html = [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8"><title>ML Sidecar</title>',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<style>',
    'body{margin:0;font-family:ui-monospace,Consolas,monospace;background:#101626;color:#ecf1ff;padding:24px;}',
    '.card{max-width:860px;margin:0 auto;border:1px solid #26314d;border-radius:16px;padding:24px;background:#161f33;}',
    'h1{margin:0 0 12px;font-size:28px;}',
    'p,li{color:#9db0d2;line-height:1.5;}',
    'code,a{color:#63d5ff;}',
    '</style></head><body><div class="card">',
    '<h1>ML Sidecar</h1>',
    '<p>Minimal local scaffold that reads <code>../data/surf-db.json</code> and exposes placeholder prediction routes.</p>',
    '<ul>',
    '<li><a href="/health">/health</a></li>',
    '<li><a href="/api/summary">/api/summary</a></li>',
    '<li><a href="/api/predict/BTC_ETH">/api/predict/BTC_ETH</a></li>',
    '</ul>',
    '</div></body></html>',
  ].join('');
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || `${HOST}:${PORT}`}`);

  if (req.method !== 'GET') {
    sendJson(res, 405, { ok: false, error: 'method_not_allowed' });
    return;
  }

  if (requestUrl.pathname === '/' || requestUrl.pathname === '/index.html') {
    handleIndex(res);
    return;
  }
  if (requestUrl.pathname === '/health') {
    handleHealth(res);
    return;
  }
  if (requestUrl.pathname === '/api/summary') {
    handleSummary(res);
    return;
  }
  if (requestUrl.pathname.startsWith('/api/predict/')) {
    handlePredict(res, decodeURIComponent(requestUrl.pathname.slice('/api/predict/'.length)));
    return;
  }

  sendJson(res, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, HOST, () => {
  console.log(`ML sidecar listening on http://${HOST}:${PORT}`);
});
