const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const HOST = process.env.ML_SIDECAR_HOST || '127.0.0.1';
const PORT = Number(process.env.ML_SIDECAR_PORT || 4280);
const SURF_DB_PATH = process.env.ML_SIDECAR_SURF_DB_PATH
  ? path.resolve(process.env.ML_SIDECAR_SURF_DB_PATH)
  : path.resolve(__dirname, '../data/surf-db.json');
const SQLITE_DB_PATH = process.env.ML_SIDECAR_SQLITE_PATH || path.join(__dirname, 'db', 'ml-sidecar.sqlite');
const SQLITE_SCHEMA_PATH = path.join(__dirname, 'db', 'schema.sql');
const FEATURE_SCHEMA_VERSION = 'v0-preview';
const MODEL_NAME = 'signal-view-placeholder';
const MODEL_VERSION = `${FEATURE_SCHEMA_VERSION}-sqlite`;

function loadSqliteDriver() {
  try {
    return { ok: true, module: require('node:sqlite') };
  } catch (error) {
    return {
      ok: false,
      error: error && error.code === 'ERR_UNKNOWN_BUILTIN_MODULE'
        ? 'node:sqlite is unavailable in this Node.js version'
        : error.message,
    };
  }
}

function openSqliteStore() {
  const driver = loadSqliteDriver();
  if (!driver.ok) {
    return { ok: false, reason: driver.error, path: SQLITE_DB_PATH };
  }
  try {
    fs.mkdirSync(path.dirname(SQLITE_DB_PATH), { recursive: true });
    const db = new driver.module.DatabaseSync(SQLITE_DB_PATH);
    db.exec(fs.readFileSync(SQLITE_SCHEMA_PATH, 'utf8'));
    return { ok: true, db, path: SQLITE_DB_PATH, driver: 'node:sqlite' };
  } catch (error) {
    return { ok: false, reason: error.message, path: SQLITE_DB_PATH };
  }
}

function withSqliteStore(callback) {
  const store = openSqliteStore();
  if (!store.ok) {
    return { ok: false, persisted: false, reason: store.reason, path: store.path };
  }
  try {
    return callback(store.db, store);
  } finally {
    try {
      store.db.close();
    } catch {}
  }
}

function sqliteStorageStatus() {
  const store = openSqliteStore();
  if (!store.ok) {
    return {
      ok: false,
      available: false,
      path: store.path,
      reason: store.reason,
      schemaPath: SQLITE_SCHEMA_PATH,
    };
  }
  try {
    const row = store.db.prepare('SELECT COUNT(*) AS count FROM forecast_runs').get();
    return {
      ok: true,
      available: true,
      path: store.path,
      schemaPath: SQLITE_SCHEMA_PATH,
      driver: store.driver,
      forecastRuns: row ? row.count : 0,
    };
  } finally {
    try {
      store.db.close();
    } catch {}
  }
}

function persistForecastRun(pair, latestView, latestFeature, predictionPayload) {
  if (!latestView || !predictionPayload || !predictionPayload.prediction) {
    return { ok: false, persisted: false, reason: 'no prediction payload' };
  }
  return withSqliteStore((db, store) => {
    const prediction = predictionPayload.prediction;
    const result = db.prepare(`
      INSERT INTO forecast_runs (
        pair_key,
        model_name,
        model_version,
        anchor_time,
        horizon_label,
        prediction_json,
        created_at,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      pair,
      MODEL_NAME,
      MODEL_VERSION,
      prediction.anchorTime || latestFeature?.capturedAt || null,
      prediction.horizonLabel || null,
      JSON.stringify({
        pair,
        latestFeature,
        prediction,
        modelStatus: predictionPayload.modelStatus,
      }),
      new Date().toISOString(),
      predictionPayload.modelStatus || 'placeholder'
    );

    return {
      ok: true,
      persisted: true,
      path: store.path,
      runId: Number(result.lastInsertRowid),
      modelName: MODEL_NAME,
      modelVersion: MODEL_VERSION,
    };
  });
}

function recentForecastRuns(limit = 20) {
  return withSqliteStore((db) => {
    const rows = db.prepare(`
      SELECT
        id,
        pair_key AS pair,
        model_name AS modelName,
        model_version AS modelVersion,
        anchor_time AS anchorTime,
        horizon_label AS horizonLabel,
        created_at AS createdAt,
        status
      FROM forecast_runs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
    return { ok: true, items: rows };
  });
}

function readSurfDb() {
  const raw = fs.readFileSync(SURF_DB_PATH, 'utf8').replace(/^\uFEFF/, '');
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
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNumericText(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? safeNumber(match[0]) : null;
}

function parseTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  const numeric = safeNumber(value);
  if (numeric !== null) {
    return numeric;
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
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

function parseLimit(rawValue, fallback, maxValue) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return fallback;
  }
  return Math.min(Math.floor(numeric), maxValue);
}

function mean(values) {
  if (!values.length) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values) {
  if (values.length < 2) {
    return null;
  }
  const avg = mean(values);
  const variance = values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function pctChange(current, reference) {
  if (!Number.isFinite(current) || !Number.isFinite(reference) || reference === 0) {
    return null;
  }
  return ((current - reference) / Math.abs(reference)) * 100;
}

function getSignalText(bucket, field) {
  if (!bucket || typeof bucket !== 'object') {
    return null;
  }
  const value = bucket[field];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getCapturedAt(view) {
  return view && (view.capturedAt || view.savedAt) ? (view.capturedAt || view.savedAt) : null;
}

function compareByCapturedDesc(left, right) {
  return String(getCapturedAt(right) || '').localeCompare(String(getCapturedAt(left) || ''));
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
    const capturedAt = getCapturedAt(view);
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

function normalizeBars(rawBars) {
  if (!Array.isArray(rawBars)) {
    return [];
  }
  return rawBars
    .map((bar) => ({
      time: parseTimestamp(bar && bar.time),
      open: safeNumber(bar && bar.open),
      high: safeNumber(bar && bar.high),
      low: safeNumber(bar && bar.low),
      close: safeNumber(bar && bar.close),
      volume: safeNumber(bar && bar.volume),
      fastAverage: safeNumber(bar && bar.fastAverage),
      slowAverage: safeNumber(bar && bar.slowAverage),
    }))
    .filter((bar) => bar.time !== null && bar.close !== null);
}

function computeBarMetrics(bars) {
  const normalizedBars = normalizeBars(bars);
  const latestBar = normalizedBars[normalizedBars.length - 1] || null;
  const previousBar = normalizedBars[normalizedBars.length - 2] || null;
  const bar5 = normalizedBars.length >= 6 ? normalizedBars[normalizedBars.length - 6] : null;
  const recent20 = normalizedBars.slice(-20);
  const returns20 = [];

  for (let index = 1; index < recent20.length; index += 1) {
    const nextReturn = pctChange(recent20[index].close, recent20[index - 1].close);
    if (nextReturn !== null) {
      returns20.push(nextReturn);
    }
  }

  const volumes20 = recent20
    .map((bar) => bar.volume)
    .filter((value) => Number.isFinite(value));
  const avgVolume20 = mean(volumes20);

  return {
    barCount: normalizedBars.length,
    latestBarTime: latestBar ? latestBar.time : null,
    latestClose: latestBar ? latestBar.close : null,
    latestVolume: latestBar ? latestBar.volume : null,
    closeChange1Pct: latestBar && previousBar ? pctChange(latestBar.close, previousBar.close) : null,
    closeChange5Pct: latestBar && bar5 ? pctChange(latestBar.close, bar5.close) : null,
    volumeVs20Avg: latestBar && avgVolume20 ? latestBar.volume / avgVolume20 : null,
    closeVsFastPct: latestBar && latestBar.fastAverage ? pctChange(latestBar.close, latestBar.fastAverage) : null,
    closeVsSlowPct: latestBar && latestBar.slowAverage ? pctChange(latestBar.close, latestBar.slowAverage) : null,
    fastSlowSpreadPct: latestBar && latestBar.fastAverage && latestBar.slowAverage
      ? pctChange(latestBar.fastAverage, latestBar.slowAverage)
      : null,
    volatility20Pct: stddev(returns20),
  };
}

function parseRsi(view) {
  const datasetRsi = safeNumber(view && view.dataset && view.dataset.rsi);
  if (datasetRsi !== null) {
    return datasetRsi;
  }
  return parseNumericText(getSignalText(view && view.signals && view.signals.momentum, 'label'));
}

function buildFeatureRow(view) {
  if (!view || typeof view !== 'object') {
    return null;
  }
  const baseSymbol = String(view.baseSymbol || '').toUpperCase();
  const quoteSymbol = String(view.quoteSymbol || '').toUpperCase();
  if (!baseSymbol || !quoteSymbol) {
    return null;
  }

  const capturedAt = getCapturedAt(view);
  const bars = view.dataset && Array.isArray(view.dataset.bars) ? view.dataset.bars : [];
  const barMetrics = computeBarMetrics(bars);
  const forecastPoints = Array.isArray(view.forecast && view.forecast.points) ? view.forecast.points : [];
  const lastForecastPoint = forecastPoints[forecastPoints.length - 1] || null;
  const capturedAtMs = parseTimestamp(capturedAt);
  const targetTimeMs = parseTimestamp(lastForecastPoint && lastForecastPoint.time);
  const forecastAnchorClose = safeNumber(view.forecast && view.forecast.anchorClose) ?? barMetrics.latestClose;

  return {
    dedupeKey: view.dedupeKey || null,
    capturedAt,
    capturedAtMs,
    pair: `${baseSymbol}/${quoteSymbol}`,
    pairLabel: view.pairLabel || `${baseSymbol} / ${quoteSymbol}`,
    baseSymbol,
    quoteSymbol,
    timeframe: view.timeframe ? String(view.timeframe) : null,
    maMode: view.maMode ? String(view.maMode) : null,
    ratioValue: parseNumericText(view.market && view.market.ratioValue),
    basePriceUsd: parseNumericText(view.market && view.market.basePrice),
    quotePriceUsd: parseNumericText(view.market && view.market.quotePrice),
    marketStatusText: getSignalText(view.market, 'statusText'),
    marketUpdatedLabel: getSignalText(view.market, 'lastUpdated'),
    rsi: parseRsi(view),
    trendLabel: getSignalText(view.signals && view.signals.trend, 'label'),
    trendDetail: getSignalText(view.signals && view.signals.trend, 'detail'),
    momentumLabel: getSignalText(view.signals && view.signals.momentum, 'label'),
    momentumDetail: getSignalText(view.signals && view.signals.momentum, 'detail'),
    volumeLabel: getSignalText(view.signals && view.signals.volume, 'label'),
    volumeDetail: getSignalText(view.signals && view.signals.volume, 'detail'),
    patternLabel: getSignalText(view.signals && view.signals.pattern, 'label'),
    patternDetail: getSignalText(view.signals && view.signals.pattern, 'detail'),
    barCount: barMetrics.barCount,
    latestBarTime: barMetrics.latestBarTime,
    latestClose: barMetrics.latestClose,
    latestVolume: barMetrics.latestVolume,
    closeChange1Pct: barMetrics.closeChange1Pct,
    closeChange5Pct: barMetrics.closeChange5Pct,
    volumeVs20Avg: barMetrics.volumeVs20Avg,
    closeVsFastPct: barMetrics.closeVsFastPct,
    closeVsSlowPct: barMetrics.closeVsSlowPct,
    fastSlowSpreadPct: barMetrics.fastSlowSpreadPct,
    volatility20Pct: barMetrics.volatility20Pct,
    forecastPointCount: forecastPoints.length,
    hasForecast: Boolean(lastForecastPoint),
    forecastSummary: getSignalText(view.forecast, 'summary'),
    forecastDetail: getSignalText(view.forecast, 'detail'),
    forecastAnchorClose,
    forecastTargetTime: targetTimeMs,
    forecastTargetValue: safeNumber(lastForecastPoint && lastForecastPoint.value),
    forecastFinalChangePct: safeNumber(view.forecast && view.forecast.finalChangePct),
    forecastHorizonMs: Number.isFinite(targetTimeMs) && Number.isFinite(capturedAtMs) ? (targetTimeMs - capturedAtMs) : null,
    forecastSource: lastForecastPoint ? 'saved-forecast' : 'missing',
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
  };
}

function buildFeatureRows(signalViews) {
  return signalViews
    .map((view) => buildFeatureRow(view))
    .filter(Boolean)
    .sort((left, right) => (right.capturedAtMs || 0) - (left.capturedAtMs || 0));
}

function buildSummary(db) {
  const pairSummary = summarizePairs(db.signalViews);
  const featureRows = buildFeatureRows(db.signalViews);
  const latestSignalView = db.signalViews
    .slice()
    .sort(compareByCapturedDesc)[0] || null;
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
      featureRows: featureRows.length,
      labeledFeatureRows: featureRows.filter((row) => row.hasForecast).length,
      walletSyncs: db.walletSyncs.length,
      walletPageViews: db.walletPageViews.length,
      walletHistoryRows: db.walletHistoryRows.length,
      pairs: pairSummary.length,
    },
    latest: {
      signalViewAt: latestSignalView ? getCapturedAt(latestSignalView) : null,
      walletSyncAt: latestWalletSync ? latestWalletSync.syncedAt || latestWalletSync.savedAt || null : null,
    },
    pairs: pairSummary.slice(0, 20),
    ml: {
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      previewRoute: '/api/features/preview',
      readinessRoute: '/api/readiness',
      storageRoute: '/api/storage',
    },
    storage: sqliteStorageStatus(),
  };
}

function getLatestSignalView(signalViews, base, quote) {
  return signalViews
    .filter((view) =>
      String(view.baseSymbol || '').toUpperCase() === base &&
      String(view.quoteSymbol || '').toUpperCase() === quote
    )
    .sort(compareByCapturedDesc)[0] || null;
}

function buildPlaceholderPrediction(view) {
  const datasetBars = Array.isArray(view && view.dataset && view.dataset.bars) ? view.dataset.bars : [];
  const latestBar = datasetBars[datasetBars.length - 1] || null;
  const forecastPoints = Array.isArray(view && view.forecast && view.forecast.points) ? view.forecast.points : [];
  const lastForecastPoint = forecastPoints[forecastPoints.length - 1] || null;
  const anchorClose = safeNumber(view && view.forecast && view.forecast.anchorClose) ?? safeNumber(latestBar && latestBar.close);

  if (!view) {
    return {
      modelStatus: 'no-pair-data',
      prediction: null,
    };
  }

  return {
    modelStatus: 'placeholder-from-gathered-data',
    prediction: {
      anchorTime: getCapturedAt(view),
      anchorClose,
      horizonLabel: view && view.forecast ? view.forecast.detail || null : null,
      summary: view && view.forecast ? view.forecast.summary || 'No saved forecast on the latest sample.' : 'No saved forecast on the latest sample.',
      targetValue: safeNumber(lastForecastPoint && lastForecastPoint.value) ?? anchorClose,
      targetTime: parseTimestamp(lastForecastPoint && lastForecastPoint.time),
      source: lastForecastPoint ? 'saved-forecast' : 'latest-anchor-close',
    },
  };
}

function buildReadiness(db) {
  const featureRows = buildFeatureRows(db.signalViews);
  const byPair = new Map();
  const byTimeframe = new Map();

  for (const row of featureRows) {
    const pairEntry = byPair.get(row.pair) || {
      pair: row.pair,
      rows: 0,
      labeledRows: 0,
      timeframes: new Set(),
      maModes: new Set(),
      latestCapturedAt: null,
      latestClose: null,
    };
    pairEntry.rows += 1;
    if (row.hasForecast) {
      pairEntry.labeledRows += 1;
    }
    if (row.timeframe) {
      pairEntry.timeframes.add(row.timeframe);
    }
    if (row.maMode) {
      pairEntry.maModes.add(row.maMode);
    }
    if (row.capturedAt && (!pairEntry.latestCapturedAt || row.capturedAt > pairEntry.latestCapturedAt)) {
      pairEntry.latestCapturedAt = row.capturedAt;
      pairEntry.latestClose = row.latestClose;
    }
    byPair.set(row.pair, pairEntry);

    const timeframeKey = row.timeframe || '--';
    const timeframeEntry = byTimeframe.get(timeframeKey) || {
      timeframe: timeframeKey,
      rows: 0,
      labeledRows: 0,
      pairs: new Set(),
    };
    timeframeEntry.rows += 1;
    if (row.hasForecast) {
      timeframeEntry.labeledRows += 1;
    }
    timeframeEntry.pairs.add(row.pair);
    byTimeframe.set(timeframeKey, timeframeEntry);
  }

  return {
    ok: true,
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    counts: {
      signalViews: db.signalViews.length,
      featureRows: featureRows.length,
      labeledRows: featureRows.filter((row) => row.hasForecast).length,
      unlabeledRows: featureRows.filter((row) => !row.hasForecast).length,
      pairs: byPair.size,
      timeframes: byTimeframe.size,
    },
    byPair: Array.from(byPair.values())
      .map((entry) => ({
        pair: entry.pair,
        rows: entry.rows,
        labeledRows: entry.labeledRows,
        timeframes: Array.from(entry.timeframes).sort(),
        maModes: Array.from(entry.maModes).sort(),
        latestCapturedAt: entry.latestCapturedAt,
        latestClose: entry.latestClose,
        status: entry.labeledRows ? 'signal-plus-forecast' : 'signal-only',
      }))
      .sort((a, b) => b.rows - a.rows || a.pair.localeCompare(b.pair)),
    byTimeframe: Array.from(byTimeframe.values())
      .map((entry) => ({
        timeframe: entry.timeframe,
        rows: entry.rows,
        labeledRows: entry.labeledRows,
        pairCount: entry.pairs.size,
        pairs: Array.from(entry.pairs).sort(),
      }))
      .sort((a, b) => Number(a.timeframe || 0) - Number(b.timeframe || 0)),
  };
}

function handleHealth(res) {
  const storage = sqliteStorageStatus();
  sendJson(res, 200, {
    ok: true,
    service: 'ml-sidecar',
    host: HOST,
    port: PORT,
    surfDbPath: SURF_DB_PATH,
    surfDbPresent: fs.existsSync(SURF_DB_PATH),
    featureSchemaVersion: FEATURE_SCHEMA_VERSION,
    storage,
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

function handleReadiness(res) {
  try {
    const db = readSurfDb();
    sendJson(res, 200, buildReadiness(db));
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: 'readiness_read_failed',
      detail: error.message,
    });
  }
}

function handleStorage(res, requestUrl) {
  const limit = parseLimit(requestUrl.searchParams.get('limit'), 20, 100);
  const status = sqliteStorageStatus();
  const recentRuns = status.available ? recentForecastRuns(limit) : { ok: false, items: [], reason: status.reason };
  sendJson(res, status.available ? 200 : 503, {
    ok: status.available,
    storage: status,
    recentForecastRuns: recentRuns.items || [],
    reason: recentRuns.reason || status.reason || null,
  });
}

function handleFeaturesPreview(res, requestUrl) {
  try {
    const db = readSurfDb();
    let rows = buildFeatureRows(db.signalViews);
    const pairFilterRaw = requestUrl.searchParams.get('pair');
    const timeframeFilter = requestUrl.searchParams.get('timeframe');
    const maModeFilter = requestUrl.searchParams.get('maMode');
    const labeledOnly = requestUrl.searchParams.get('labeled') === '1';
    const limit = parseLimit(requestUrl.searchParams.get('limit'), 25, 200);
    let pairFilter = null;

    if (pairFilterRaw) {
      pairFilter = parsePair(pairFilterRaw);
      if (!pairFilter) {
        sendJson(res, 400, {
          ok: false,
          error: 'invalid_pair',
          detail: 'Use a pair like BTC_ETH, BTC-ETH, or BTC/ETH.',
        });
        return;
      }
      rows = rows.filter((row) => row.baseSymbol === pairFilter.base && row.quoteSymbol === pairFilter.quote);
    }

    if (timeframeFilter) {
      rows = rows.filter((row) => String(row.timeframe || '') === String(timeframeFilter));
    }
    if (maModeFilter) {
      rows = rows.filter((row) => String(row.maMode || '').toLowerCase() === String(maModeFilter).toLowerCase());
    }
    if (labeledOnly) {
      rows = rows.filter((row) => row.hasForecast);
    }

    sendJson(res, 200, {
      ok: true,
      featureSchemaVersion: FEATURE_SCHEMA_VERSION,
      filters: {
        pair: pairFilter ? pairFilter.pair : null,
        timeframe: timeframeFilter || null,
        maMode: maModeFilter || null,
        labeledOnly,
        limit,
      },
      totalRows: rows.length,
      items: rows.slice(0, limit),
    });
  } catch (error) {
    sendJson(res, 500, {
      ok: false,
      error: 'feature_preview_failed',
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
    const latestFeature = buildFeatureRows(db.signalViews)
      .find((row) => row.baseSymbol === parsedPair.base && row.quoteSymbol === parsedPair.quote) || null;
    const sampleCount = db.signalViews.filter((view) =>
      String(view.baseSymbol || '').toUpperCase() === parsedPair.base &&
      String(view.quoteSymbol || '').toUpperCase() === parsedPair.quote
    ).length;
    const payload = buildPlaceholderPrediction(latestView);
    const persistence = latestView
      ? persistForecastRun(parsedPair.pair, latestView, latestFeature, payload)
      : { ok: false, persisted: false, reason: 'no pair data' };

    sendJson(res, latestView ? 200 : 404, {
      ok: Boolean(latestView),
      pair: parsedPair.pair,
      persistence,
      samples: sampleCount,
      latestCapturedAt: latestView ? getCapturedAt(latestView) : null,
      latestTimeframe: latestView ? latestView.timeframe || null : null,
      latestMaMode: latestView ? latestView.maMode || null : null,
      latestSignals: latestView ? latestView.signals || {} : {},
      latestFeature,
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
    '.card{max-width:900px;margin:0 auto;border:1px solid #26314d;border-radius:16px;padding:24px;background:#161f33;}',
    'h1{margin:0 0 12px;font-size:28px;}',
    'p,li{color:#9db0d2;line-height:1.5;}',
    'code,a,strong{color:#63d5ff;}',
    '</style></head><body><div class="card">',
    '<h1>ML Sidecar</h1>',
    '<p>Local preview service that reads <code>../data/surf-db.json</code>, normalizes signal snapshots into feature rows, and exposes readiness routes for the next training step.</p>',
    '<ul>',
    '<li><a href="/health">/health</a></li>',
    '<li><a href="/api/summary">/api/summary</a></li>',
    '<li><a href="/api/storage">/api/storage</a></li>',
    '<li><a href="/api/readiness">/api/readiness</a></li>',
    '<li><a href="/api/features/preview">/api/features/preview</a></li>',
    '<li><a href="/api/features/preview?pair=BTC_ETH">/api/features/preview?pair=BTC_ETH</a></li>',
    '<li><a href="/api/predict/BTC_ETH">/api/predict/BTC_ETH</a></li>',
    '</ul>',
    '<p><strong>Schema:</strong> ' + FEATURE_SCHEMA_VERSION + '</p>',
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
  if (requestUrl.pathname === '/api/storage') {
    handleStorage(res, requestUrl);
    return;
  }
  if (requestUrl.pathname === '/api/readiness') {
    handleReadiness(res);
    return;
  }
  if (requestUrl.pathname === '/api/features/preview') {
    handleFeaturesPreview(res, requestUrl);
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
