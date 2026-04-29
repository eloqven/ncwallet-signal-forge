const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 4173;
const ROOT = __dirname;
const DEVTOOLS_LIST_URL = "http://127.0.0.1:9222/json/list";
const NCW_APP_PREFIX = "https://app.ncwallet.net/";
const DB_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DB_DIR, "surf-db.json");
const EXPORT_DIR = path.join(ROOT, "exports");
const DB_LIMITS = {
  signalViews: 400,
  walletSyncs: 200,
  walletPageViews: 2000,
  walletHistoryRows: 5000,
  modelDeltaAudits: 2000,
};
const MODEL_K_HSH = 14.60e-6 / 90;
const MODEL_K_CTC = 0.000228;
const MODEL_K_TOTAL_USD = (0.1171e-6 * 1e8) / 72198;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const MONTH_INDEX = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

function createEmptyDb() {
  const now = new Date().toISOString();
  return {
    meta: {
      createdAt: now,
      updatedAt: now,
    },
    signalViews: [],
    walletSyncs: [],
    walletPageViews: [],
    walletHistoryRows: [],
    modelDeltaAudits: [],
    todoItems: [],
    bugItems: [],
  };
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function safeJoin(root, targetPath) {
  const resolved = path.resolve(root, "." + targetPath);
  return resolved.startsWith(root) ? resolved : null;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

function ensureDbFile() {
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(createEmptyDb(), null, 2));
  }
}

function ensureExportDir() {
  if (!fs.existsSync(EXPORT_DIR)) {
    fs.mkdirSync(EXPORT_DIR, { recursive: true });
  }
}

function readDb() {
  ensureDbFile();
  try {
    const raw = fs.readFileSync(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      meta: parsed.meta || createEmptyDb().meta,
      signalViews: Array.isArray(parsed.signalViews) ? parsed.signalViews : [],
      walletSyncs: Array.isArray(parsed.walletSyncs) ? parsed.walletSyncs : [],
      walletPageViews: Array.isArray(parsed.walletPageViews) ? parsed.walletPageViews : [],
      walletHistoryRows: Array.isArray(parsed.walletHistoryRows) ? parsed.walletHistoryRows : [],
      modelDeltaAudits: Array.isArray(parsed.modelDeltaAudits) ? parsed.modelDeltaAudits : [],
      todoItems: Array.isArray(parsed.todoItems) ? parsed.todoItems : [],
      bugItems: Array.isArray(parsed.bugItems) ? parsed.bugItems : [],
    };
  } catch (error) {
    const fallback = createEmptyDb();
    fs.writeFileSync(DB_FILE, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function writeDb(db) {
  ensureDbFile();
  db.meta = db.meta || {};
  if (!db.meta.createdAt) db.meta.createdAt = new Date().toISOString();
  db.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function trimDbList(list, maxSize) {
  return list.length > maxSize ? list.slice(list.length - maxSize) : list;
}

function getDbSummary(db) {
  const latestSignal = db.signalViews.length ? db.signalViews[db.signalViews.length - 1] : null;
  const latestWallet = db.walletSyncs.length ? db.walletSyncs[db.walletSyncs.length - 1] : null;
  const latestWalletPage = db.walletPageViews.length ? db.walletPageViews[db.walletPageViews.length - 1] : null;
  const latestWalletHistoryRow = db.walletHistoryRows.length ? db.walletHistoryRows[db.walletHistoryRows.length - 1] : null;
  const latestModelDeltaAudit = Array.isArray(db.modelDeltaAudits) && db.modelDeltaAudits.length ? db.modelDeltaAudits[db.modelDeltaAudits.length - 1] : null;
  return {
    updatedAt: db.meta && db.meta.updatedAt ? db.meta.updatedAt : null,
    signalViewCount: db.signalViews.length,
    walletSyncCount: db.walletSyncs.length,
    walletPageViewCount: db.walletPageViews.length,
    walletHistoryRowCount: db.walletHistoryRows.length,
    modelDeltaAuditCount: Array.isArray(db.modelDeltaAudits) ? db.modelDeltaAudits.length : 0,
    todoItemCount: Array.isArray(db.todoItems) ? db.todoItems.length : 0,
    bugItemCount: Array.isArray(db.bugItems) ? db.bugItems.length : 0,
    latestSignalView: latestSignal ? {
      savedAt: latestSignal.savedAt,
      pairLabel: latestSignal.pairLabel,
      timeframe: latestSignal.timeframe,
      maMode: latestSignal.maMode,
      barCount: latestSignal.dataset && latestSignal.dataset.barCount ? latestSignal.dataset.barCount : 0,
    } : null,
    latestWalletSync: latestWallet ? {
      savedAt: latestWallet.savedAt,
      walletTotalUsd: latestWallet.walletTotalUsd,
      fundedWalletCount: latestWallet.fundedWalletCount,
      visibleCount: latestWallet.visibleCount,
    } : null,
    latestWalletPageView: latestWalletPage ? {
      savedAt: latestWalletPage.savedAt,
      symbol: latestWalletPage.symbol,
      rangeLabel: latestWalletPage.rangeLabel,
      priceUsdText: latestWalletPage.priceUsdText,
      totalUsdText: latestWalletPage.totalUsdText,
    } : null,
    latestWalletHistoryRow: latestWalletHistoryRow ? {
      savedAt: latestWalletHistoryRow.savedAt,
      datetimeLabel: latestWalletHistoryRow.datetimeLabel,
      amountText: latestWalletHistoryRow.amountText,
      symbol: latestWalletHistoryRow.symbol,
    } : null,
    latestModelDeltaAudit: latestModelDeltaAudit ? {
      savedAt: latestModelDeltaAudit.savedAt,
      newHistoryRowCount: latestModelDeltaAudit.newHistoryRowCount,
      walletTotalUsdDelta: latestModelDeltaAudit.walletTotalUsdDelta,
      latestModelRateMicro: latestModelDeltaAudit.latestModelRateMicro,
      latestActualRateMicro: latestModelDeltaAudit.latestActualRateMicro,
      latestErrorPercent: latestModelDeltaAudit.latestErrorPercent,
    } : null,
  };
}

function roundNumber(value, digits = 10) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function parseNcwalletDateLabel(label) {
  if (!label || typeof label !== "string") return null;
  const match = label.trim().match(/^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{2}):(\d{2})$/);
  if (!match) return null;
  const day = parseInt(match[1], 10);
  const monthIndex = MONTH_INDEX[match[2]];
  const hour = parseInt(match[3], 10);
  const minute = parseInt(match[4], 10);
  if (monthIndex == null) return null;

  const now = new Date();
  let year = now.getFullYear();
  if (monthIndex > now.getMonth() + 1) {
    year -= 1;
  }
  return new Date(year, monthIndex, day, hour, minute);
}

function parseUsdLabel(label) {
  if (!label || typeof label !== "string") return null;
  const match = label.replace(/,/g, "").match(/([+-]?\d+(?:\.\d+)?)\s*USD/i);
  return match ? parseFloat(match[1]) : null;
}

function normalizeNcwalletEntry(entry, index) {
  const amountText = entry.amountText || entry.amount || null;
  const amountMatch = amountText ? amountText.match(/^([+-])?\s*([\d.]+)\s+([A-Z0-9]+)$/) : null;
  const sign = amountMatch ? (amountMatch[1] === "-" ? -1 : 1) : 1;
  const amountAbs = amountMatch ? parseFloat(amountMatch[2]) : null;
  const symbol = amountMatch ? amountMatch[3] : null;
  const parsedDate = parseNcwalletDateLabel(entry.datetimeLabel || entry.datetime || "");

  return {
    id: entry.rowId || `history-${index + 1}`,
    assetName: entry.assetName || entry.asset || null,
    amountText,
    amountValue: Number.isFinite(amountAbs) ? sign * amountAbs : null,
    amountAbs: Number.isFinite(amountAbs) ? amountAbs : null,
    symbol,
    status: entry.status || null,
    datetimeLabel: entry.datetimeLabel || entry.datetime || null,
    datetimeIso: parsedDate ? parsedDate.toISOString() : null,
  };
}

function normalizeNcwalletWallet(entry, index) {
  const balanceText = entry.balanceText || null;
  const balanceMatch = balanceText ? balanceText.match(/^([\d.]+)\s+([A-Z0-9]+)$/) : null;
  const holdingAmount = balanceMatch ? parseFloat(balanceMatch[1]) : null;
  const symbol = balanceMatch ? balanceMatch[2] : null;

  return {
    id: entry.rowId || `wallet-${index + 1}`,
    assetName: entry.assetName || null,
    symbol,
    balanceText,
    holdingAmount: Number.isFinite(holdingAmount) ? holdingAmount : null,
    priceUsdText: entry.priceUsdText || null,
    priceUsd: parseUsdLabel(entry.priceUsdText),
    totalUsdText: entry.totalUsdText || null,
    totalUsd: parseUsdLabel(entry.totalUsdText),
    changeText: entry.changeText || null,
  };
}

function isFundedWallet(wallet) {
  if (!wallet || !wallet.symbol) return false;
  if (Number.isFinite(wallet.totalUsd) && wallet.totalUsd > 0) return true;
  if (Number.isFinite(wallet.holdingAmount) && wallet.holdingAmount > 0) return true;
  return false;
}

function buildWalletFromActiveDetail(detail) {
  if (!detail || !detail.symbol) return null;
  return {
    id: `active-${detail.symbol}`,
    assetName: detail.titleLine || detail.symbol,
    symbol: detail.symbol,
    balanceText: detail.balanceText || null,
    holdingAmount: Number.isFinite(detail.holdingAmount) ? detail.holdingAmount : null,
    priceUsdText: detail.priceUsdText || null,
    priceUsd: Number.isFinite(detail.priceUsd) ? detail.priceUsd : null,
    totalUsdText: detail.totalUsdText || null,
    totalUsd: Number.isFinite(detail.totalUsd) ? detail.totalUsd : null,
    changeText: detail.changeText || null,
  };
}

function mergeWalletRows(baseWallets, patchWallets) {
  const bySymbol = new Map();

  [...baseWallets, ...patchWallets].forEach((wallet, index) => {
    if (!wallet || !wallet.symbol) return;
    const previous = bySymbol.get(wallet.symbol) || { id: wallet.id || `wallet-${index + 1}`, symbol: wallet.symbol };
    bySymbol.set(wallet.symbol, {
      ...previous,
      ...wallet,
      assetName: wallet.assetName || previous.assetName || wallet.symbol,
      balanceText: wallet.balanceText || previous.balanceText || null,
      totalUsdText: wallet.totalUsdText || previous.totalUsdText || null,
      priceUsdText: wallet.priceUsdText || previous.priceUsdText || null,
      changeText: wallet.changeText || previous.changeText || null,
      holdingAmount: Number.isFinite(wallet.holdingAmount) ? wallet.holdingAmount : previous.holdingAmount,
      totalUsd: Number.isFinite(wallet.totalUsd) ? wallet.totalUsd : previous.totalUsd,
      priceUsd: Number.isFinite(wallet.priceUsd) ? wallet.priceUsd : previous.priceUsd,
    });
  });

  return Array.from(bySymbol.values())
    .filter(isFundedWallet)
    .sort((a, b) => {
      const usdDiff = (Number(b.totalUsd) || 0) - (Number(a.totalUsd) || 0);
      if (usdDiff !== 0) return usdDiff;
      return String(a.symbol).localeCompare(String(b.symbol));
    });
}

function getLastKnownWallets(db) {
  const snapshots = Array.isArray(db.walletSyncs) ? db.walletSyncs.slice() : [];
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const wallets = Array.isArray(snapshots[index].wallets) ? snapshots[index].wallets.filter(isFundedWallet) : [];
    if (wallets.length) {
      return wallets.map((wallet) => ({ ...wallet }));
    }
  }
  return [];
}

function resolveWalletDisplayState(db, payload) {
  const liveWallets = Array.isArray(payload && payload.wallets) ? payload.wallets.filter(isFundedWallet) : [];
  const cachedWallets = getLastKnownWallets(db);
  const activeWallet = buildWalletFromActiveDetail(payload && payload.activeWalletDetail ? payload.activeWalletDetail : null);
  let wallets = [];

  if (liveWallets.length) {
    const activePatch = activeWallet && liveWallets.some((wallet) => wallet.symbol === activeWallet.symbol) ? [activeWallet] : [];
    wallets = mergeWalletRows(liveWallets, activePatch);
  } else if (cachedWallets.length) {
    wallets = mergeWalletRows(cachedWallets, activeWallet ? [activeWallet] : []);
  } else if (activeWallet && isFundedWallet(activeWallet)) {
    wallets = [activeWallet];
  }

  const walletTotalUsd = wallets.reduce((sum, wallet) => {
    return sum + (Number.isFinite(wallet.totalUsd) ? wallet.totalUsd : 0);
  }, 0);

  return {
    wallets,
    walletTotalUsd,
    fundedWalletCount: wallets.length,
    walletSnapshotSource: liveWallets.length ? "live-wallets-page" : (cachedWallets.length ? "cached-wallets" : "active-wallet-only"),
  };
}

function normalizeNcwalletActiveWalletDetail(raw, entries) {
  if (!raw || !Array.isArray(raw.pageLines)) return null;

  let parsedUrl = null;
  try {
    parsedUrl = new URL(String(raw.url || NCW_APP_PREFIX));
  } catch (_) {
    parsedUrl = null;
  }

  const symbol = parsedUrl ? parsedUrl.searchParams.get("c") : null;
  const isWalletPage = parsedUrl ? /^\/wallet\//.test(parsedUrl.pathname) : false;
  if (!isWalletPage || !symbol) return null;

  const lines = raw.pageLines.map((line) => String(line || "").trim()).filter(Boolean);
  const marketIndex = lines.findIndex((line) => /^Market price$/i.test(line));
  const walletIndex = lines.findIndex((line) => /^Your wallet$/i.test(line));
  const historyIndex = lines.findIndex((line) => /^History$/i.test(line));

  const priceUsdText = marketIndex >= 0 ? lines[marketIndex + 1] || null : null;
  const changeText = marketIndex >= 0 ? lines[marketIndex + 2] || null : null;
  const referencePriceUsdText = marketIndex >= 0 ? lines[marketIndex + 3] || null : null;
  const referenceDateLabel = marketIndex >= 0 ? lines[marketIndex + 4] || null : null;
  const balanceText = walletIndex >= 0 ? lines[walletIndex + 2] || null : null;
  const totalUsdText = walletIndex >= 0 ? lines[walletIndex + 3] || null : null;
  const balanceMatch = balanceText ? balanceText.match(/^([\d.]+)\s+([A-Z0-9]+)$/) : null;
  const changeMatch = changeText ? changeText.replace(/,/g, "").match(/^([+-]?\d+(?:\.\d+)?)\s*\(([+-]?\d+(?:\.\d+)?)%\)$/) : null;

  return {
    source: "ncwallet-open-wallet-page",
    symbol,
    titleLine: lines[0] || symbol,
    pageTitle: raw.title || "NC Wallet",
    url: raw.url || NCW_APP_PREFIX,
    priceUsdText,
    priceUsd: parseUsdLabel(priceUsdText),
    changeText,
    changeUsd: changeMatch ? parseFloat(changeMatch[1]) : null,
    changePercent: changeMatch ? parseFloat(changeMatch[2]) : null,
    referencePriceUsdText,
    referencePriceUsd: parseUsdLabel(referencePriceUsdText),
    referenceDateLabel,
    address: walletIndex >= 0 ? lines[walletIndex + 1] || null : null,
    balanceText,
    holdingAmount: balanceMatch ? parseFloat(balanceMatch[1]) : null,
    totalUsdText,
    totalUsd: parseUsdLabel(totalUsdText),
    timeframeOptions: ["Day", "Week", "Month", "Year", "All"].filter((label) => lines.includes(label)),
    activeRangeLabel: raw.activeRangeLabel || null,
    chartFillPath: raw.chartFillPath || null,
    chartLinePath: raw.chartLinePath || null,
    chartViewBox: raw.chartViewBox || "0 0 1023 110",
    actions: Array.isArray(raw.actionCards)
      ? raw.actionCards
          .map((action) => ({
            testId: action && action.testId ? action.testId : null,
            title: action && action.title ? action.title : null,
            subtitle: action && action.subtitle ? action.subtitle : null,
          }))
          .filter((action) => action.title || action.subtitle)
      : [],
    visibleHistoryCount: Array.isArray(entries) ? entries.length : 0,
    historyPrompt: historyIndex >= 0 ? lines[historyIndex + 1] || null : null,
  };
}

function normalizeSignalSnapshot(payload) {
  const bars = Array.isArray(payload.dataset && payload.dataset.bars)
    ? payload.dataset.bars.slice(-240).map((bar) => ({
        time: typeof bar.time === "number" ? bar.time : null,
        open: roundNumber(Number(bar.open)),
        high: roundNumber(Number(bar.high)),
        low: roundNumber(Number(bar.low)),
        close: roundNumber(Number(bar.close)),
        volume: roundNumber(Number(bar.volume)),
        fastAverage: roundNumber(Number(bar.fastAverage)),
        slowAverage: roundNumber(Number(bar.slowAverage)),
      }))
    : [];

  return {
    dedupeKey: String(payload.dedupeKey || ""),
    savedAt: new Date().toISOString(),
    capturedAt: payload.capturedAt || null,
    pairLabel: payload.pairLabel || null,
    baseSymbol: payload.baseSymbol || null,
    quoteSymbol: payload.quoteSymbol || null,
    timeframe: payload.timeframe || null,
    maMode: payload.maMode || null,
    market: payload.market || null,
    signals: payload.signals || null,
    forecast: payload.forecast || null,
    dataset: {
      barCount: Number(payload.dataset && payload.dataset.barCount) || bars.length,
      rsi: roundNumber(Number(payload.dataset && payload.dataset.rsi), 6),
      bars,
    },
  };
}

function summarizeNcwalletEntries(entries) {
  return entries.reduce((summary, entry) => {
    if (entry.symbol && Number.isFinite(entry.amountValue)) {
      summary.totalsBySymbol[entry.symbol] = (summary.totalsBySymbol[entry.symbol] || 0) + entry.amountValue;
    }
    if (entry.status) {
      summary.statusCounts[entry.status] = (summary.statusCounts[entry.status] || 0) + 1;
    }
    return summary;
  }, {
    totalsBySymbol: {},
    statusCounts: {},
  });
}

function buildWalletHistoryRow(entry, syncedAt) {
  if (!entry || !entry.assetName || !entry.amountText) return null;
  const contentKey = [
    entry.datetimeIso || entry.datetimeLabel || "",
    entry.assetName || "",
    entry.amountText || "",
    entry.status || "",
  ].join("__");
  const savedAt = new Date().toISOString();
  return {
    contentKey,
    savedAt,
    lastSeenAt: syncedAt || savedAt,
    id: entry.id || contentKey,
    assetName: entry.assetName || null,
    symbol: entry.symbol || null,
    amountText: entry.amountText || null,
    amountValue: roundNumber(Number(entry.amountValue), 12),
    amountAbs: roundNumber(Number(entry.amountAbs), 12),
    status: entry.status || null,
    datetimeLabel: entry.datetimeLabel || null,
    datetimeIso: entry.datetimeIso || null,
  };
}

function appendWalletHistoryRows(db, payload) {
  const entries = payload && Array.isArray(payload.entries) ? payload.entries : [];
  if (!entries.length) {
    return {
      addedCount: 0,
      rowCount: db.walletHistoryRows.length,
    };
  }

  const indexByKey = new Map(
    db.walletHistoryRows.map((row, index) => [row.contentKey, index]),
  );
  let addedCount = 0;
  const addedRows = [];

  entries.forEach((entry) => {
    const row = buildWalletHistoryRow(entry, payload.syncedAt);
    if (!row) return;
    const existingIndex = indexByKey.get(row.contentKey);
    if (existingIndex != null) {
      db.walletHistoryRows[existingIndex] = {
        ...db.walletHistoryRows[existingIndex],
        ...row,
        savedAt: db.walletHistoryRows[existingIndex].savedAt || row.savedAt,
        lastSeenAt: row.lastSeenAt,
      };
      return;
    }
    indexByKey.set(row.contentKey, db.walletHistoryRows.length);
    db.walletHistoryRows.push(row);
    addedCount += 1;
    addedRows.push(row);
  });

  db.walletHistoryRows = trimDbList(db.walletHistoryRows, DB_LIMITS.walletHistoryRows);
  return {
    addedCount,
    addedRows,
    rowCount: db.walletHistoryRows.length,
  };
}

function getCachedWalletHistoryRows(db, limit = 240) {
  const rows = Array.isArray(db.walletHistoryRows) ? db.walletHistoryRows.slice() : [];
  rows.sort((a, b) => {
    const aTime = Date.parse(a.datetimeIso || a.savedAt || 0) || 0;
    const bTime = Date.parse(b.datetimeIso || b.savedAt || 0) || 0;
    return bTime - aTime;
  });
  return rows.slice(0, limit);
}

function buildWalletSymbolMap(wallets) {
  return new Map((Array.isArray(wallets) ? wallets : []).filter((wallet) => wallet && wallet.symbol).map((wallet) => [wallet.symbol, wallet]));
}

function buildWalletModelInputs(payload) {
  const wallets = Array.isArray(payload && payload.wallets) ? payload.wallets : [];
  const walletMap = buildWalletSymbolMap(wallets);
  const ctcWallet = walletMap.get("CTC") || null;
  const hshWallet = walletMap.get("HSH") || null;
  const btcWallet = walletMap.get("BTC") || null;
  const walletTotalUsd = Number.isFinite(Number(payload && payload.walletTotalUsd)) ? Number(payload.walletTotalUsd) : 0;
  const ctcUsd = ctcWallet && Number.isFinite(ctcWallet.totalUsd) ? ctcWallet.totalUsd : 0;
  const hshUsd = hshWallet && Number.isFinite(hshWallet.totalUsd) ? hshWallet.totalUsd : 0;
  const walletBaseUsd = Math.max(0, walletTotalUsd - ctcUsd - hshUsd);
  const ctcHolding = ctcWallet && Number.isFinite(ctcWallet.holdingAmount) ? ctcWallet.holdingAmount : 0;
  const hshHolding = hshWallet && Number.isFinite(hshWallet.holdingAmount) ? hshWallet.holdingAmount : 0;
  const latestModelRateMicro = roundNumber(((MODEL_K_HSH * hshHolding) + (MODEL_K_CTC * ctcHolding) + (MODEL_K_TOTAL_USD * walletBaseUsd)) * 1e6, 6);
  return {
    walletBaseUsd: roundNumber(walletBaseUsd, 8),
    walletTotalUsd: roundNumber(walletTotalUsd, 8),
    ctcHolding: roundNumber(ctcHolding, 12),
    hshHolding: roundNumber(hshHolding, 8),
    btcPriceUsd: btcWallet && Number.isFinite(btcWallet.priceUsd) ? roundNumber(btcWallet.priceUsd, 8) : null,
    ctcPriceUsd: ctcWallet && Number.isFinite(ctcWallet.priceUsd) ? roundNumber(ctcWallet.priceUsd, 8) : null,
    latestModelRateMicro,
  };
}

function buildLatestActualMetrics(entries) {
  const dated = (Array.isArray(entries) ? entries : []).filter((entry) => entry && entry.datetimeIso);
  if (!dated.length) {
    return {
      latestHistoryDay: null,
      latestActualRateMicro: null,
      latestBtcMinedSat: null,
    };
  }
  const latestHistoryDay = dated.reduce((best, entry) => {
    const day = String(entry.datetimeIso).slice(0, 10);
    return day > best ? day : best;
  }, "0000-00-00");
  const latestDayEntries = dated.filter((entry) => String(entry.datetimeIso).slice(0, 10) === latestHistoryDay);
  const latestActualRateMicro = roundNumber(latestDayEntries.filter((entry) => entry.symbol === "CTC").reduce((sum, entry) => sum + (Number(entry.amountValue) || 0), 0) * 1e6, 6);
  const latestBtcMinedSat = roundNumber(latestDayEntries.filter((entry) => entry.symbol === "BTC").reduce((sum, entry) => sum + (Number(entry.amountValue) || 0), 0) * 1e8, 2);
  return {
    latestHistoryDay,
    latestActualRateMicro: latestActualRateMicro || null,
    latestBtcMinedSat: latestBtcMinedSat || null,
  };
}

function buildWalletDeltaAudit(previousSnapshot, payload, historyStore, cachedEntries) {
  const currentInputs = buildWalletModelInputs(payload);
  const previousInputs = buildWalletModelInputs(previousSnapshot || {});
  const latestActual = buildLatestActualMetrics(cachedEntries);
  const previousWalletMap = buildWalletSymbolMap(previousSnapshot && previousSnapshot.wallets);
  const currentWalletMap = buildWalletSymbolMap(payload && payload.wallets);
  const touchedSymbols = Array.from(new Set([
    ...Array.from(previousWalletMap.keys()),
    ...Array.from(currentWalletMap.keys()),
    ...((historyStore && Array.isArray(historyStore.addedRows)) ? historyStore.addedRows.map((row) => row.symbol).filter(Boolean) : []),
  ])).sort();
  const holdingsDeltaBySymbol = {};

  touchedSymbols.forEach((symbol) => {
    const previousHolding = previousWalletMap.get(symbol) && Number.isFinite(previousWalletMap.get(symbol).holdingAmount) ? previousWalletMap.get(symbol).holdingAmount : 0;
    const currentHolding = currentWalletMap.get(symbol) && Number.isFinite(currentWalletMap.get(symbol).holdingAmount) ? currentWalletMap.get(symbol).holdingAmount : 0;
    const delta = roundNumber(currentHolding - previousHolding, 12);
    if (delta) holdingsDeltaBySymbol[symbol] = delta;
  });

  const latestErrorPercent = latestActual.latestActualRateMicro && currentInputs.latestModelRateMicro
    ? roundNumber(((currentInputs.latestModelRateMicro - latestActual.latestActualRateMicro) / latestActual.latestActualRateMicro) * 100, 6)
    : null;

  return {
    id: `model-audit-${payload.syncedAt || Date.now()}`,
    savedAt: new Date().toISOString(),
    syncedAt: payload.syncedAt || null,
    newHistoryRowCount: historyStore && Number.isFinite(historyStore.addedCount) ? historyStore.addedCount : 0,
    newHistoryRows: (historyStore && Array.isArray(historyStore.addedRows) ? historyStore.addedRows : []).slice(-12).map((row) => ({
      symbol: row.symbol || null,
      amountText: row.amountText || null,
      datetimeIso: row.datetimeIso || null,
    })),
    walletTotalUsd: currentInputs.walletTotalUsd,
    walletTotalUsdDelta: roundNumber(currentInputs.walletTotalUsd - previousInputs.walletTotalUsd, 8),
    walletBaseUsd: currentInputs.walletBaseUsd,
    walletBaseUsdDelta: roundNumber(currentInputs.walletBaseUsd - previousInputs.walletBaseUsd, 8),
    holdingsDeltaBySymbol,
    latestHistoryDay: latestActual.latestHistoryDay,
    latestModelRateMicro: currentInputs.latestModelRateMicro,
    latestActualRateMicro: latestActual.latestActualRateMicro,
    latestErrorPercent,
    latestBtcMinedSat: latestActual.latestBtcMinedSat,
    btcPriceUsd: currentInputs.btcPriceUsd,
    ctcPriceUsd: currentInputs.ctcPriceUsd,
  };
}

function appendWalletDeltaAudit(db, previousSnapshot, payload, historyStore, cachedEntries) {
  const audit = buildWalletDeltaAudit(previousSnapshot, payload, historyStore, cachedEntries);
  db.modelDeltaAudits = Array.isArray(db.modelDeltaAudits) ? db.modelDeltaAudits : [];
  db.modelDeltaAudits.push(audit);
  db.modelDeltaAudits = trimDbList(db.modelDeltaAudits, DB_LIMITS.modelDeltaAudits);
  return audit;
}

function buildWalletPageSnapshot(payload) {
  const detail = payload && payload.activeWalletDetail ? payload.activeWalletDetail : null;
  if (!detail || !detail.symbol) return null;

  return {
    contentKey: [
      detail.symbol || "",
      detail.activeRangeLabel || "",
      detail.priceUsdText || "",
      detail.changeText || "",
      detail.referencePriceUsdText || "",
      detail.referenceDateLabel || "",
      detail.balanceText || "",
      detail.totalUsdText || "",
      detail.chartLinePath || "",
    ].join("__"),
    savedAt: new Date().toISOString(),
    syncedAt: payload.syncedAt || null,
    symbol: detail.symbol || null,
    rangeLabel: detail.activeRangeLabel || null,
    titleLine: detail.titleLine || null,
    pageTitle: detail.pageTitle || null,
    url: detail.url || null,
    priceUsdText: detail.priceUsdText || null,
    priceUsd: roundNumber(Number(detail.priceUsd), 8),
    changeText: detail.changeText || null,
    changeUsd: roundNumber(Number(detail.changeUsd), 8),
    changePercent: roundNumber(Number(detail.changePercent), 6),
    referencePriceUsdText: detail.referencePriceUsdText || null,
    referencePriceUsd: roundNumber(Number(detail.referencePriceUsd), 8),
    referenceDateLabel: detail.referenceDateLabel || null,
    address: detail.address || null,
    balanceText: detail.balanceText || null,
    holdingAmount: roundNumber(Number(detail.holdingAmount), 12),
    totalUsdText: detail.totalUsdText || null,
    totalUsd: roundNumber(Number(detail.totalUsd), 8),
    timeframeOptions: Array.isArray(detail.timeframeOptions) ? detail.timeframeOptions : [],
    chartViewBox: detail.chartViewBox || null,
    chartLinePath: detail.chartLinePath || null,
    chartFillPath: detail.chartFillPath || null,
    actions: Array.isArray(detail.actions) ? detail.actions : [],
    visibleHistoryCount: detail.visibleHistoryCount || 0,
    historyPrompt: detail.historyPrompt || null,
  };
}

function appendWalletPageSnapshot(db, payload) {
  const snapshot = buildWalletPageSnapshot(payload);
  if (!snapshot) return false;

  const lastSnapshot = db.walletPageViews.length ? db.walletPageViews[db.walletPageViews.length - 1] : null;
  if (
    lastSnapshot &&
    lastSnapshot.contentKey === snapshot.contentKey &&
    lastSnapshot.symbol === snapshot.symbol &&
    lastSnapshot.rangeLabel === snapshot.rangeLabel
  ) {
    lastSnapshot.lastSeenAt = snapshot.syncedAt || snapshot.savedAt;
    return false;
  }

  db.walletPageViews.push(snapshot);
  db.walletPageViews = trimDbList(db.walletPageViews, DB_LIMITS.walletPageViews);
  return true;
}

function persistWalletSyncSnapshot(payload) {
  const db = readDb();
  const previousSnapshot = Array.isArray(db.walletSyncs) && db.walletSyncs.length ? db.walletSyncs[db.walletSyncs.length - 1] : null;
  const walletDisplayState = resolveWalletDisplayState(db, payload);
  payload.wallets = walletDisplayState.wallets;
  payload.walletTotalUsd = walletDisplayState.walletTotalUsd;
  payload.fundedWalletCount = walletDisplayState.fundedWalletCount;
  payload.walletSnapshotSource = walletDisplayState.walletSnapshotSource;
  const snapshot = {
    dedupeKey: [
      payload.lastTransaction && payload.lastTransaction.datetimeLabel,
      payload.lastTransaction && payload.lastTransaction.amountText,
      payload.walletTotalUsd,
      payload.visibleCount,
      payload.activeWalletDetail && payload.activeWalletDetail.symbol,
    ].join("__"),
    savedAt: new Date().toISOString(),
    syncedAt: payload.syncedAt,
    walletTotalUsd: roundNumber(Number(payload.walletTotalUsd), 8),
    fundedWalletCount: payload.fundedWalletCount || 0,
    visibleCount: payload.visibleCount || 0,
    activeWalletSymbol: payload.activeWalletDetail && payload.activeWalletDetail.symbol ? payload.activeWalletDetail.symbol : null,
    lastTransaction: payload.lastTransaction || null,
    wallets: Array.isArray(payload.wallets) ? payload.wallets : [],
    totalsBySymbol: payload.totalsBySymbol || {},
    statusCounts: payload.statusCounts || {},
  };

  const existingIndex = db.walletSyncs.findIndex((item) => item.dedupeKey === snapshot.dedupeKey);
  if (existingIndex >= 0) {
    db.walletSyncs[existingIndex] = snapshot;
  } else {
    db.walletSyncs.push(snapshot);
  }
  db.walletSyncs = trimDbList(db.walletSyncs, DB_LIMITS.walletSyncs);
  appendWalletPageSnapshot(db, payload);
  const historyStore = appendWalletHistoryRows(db, payload);
  const cachedEntries = getCachedWalletHistoryRows(db);
  const cachedSummary = summarizeNcwalletEntries(cachedEntries);
  const latestModelDeltaAudit = appendWalletDeltaAudit(db, previousSnapshot, payload, historyStore, cachedEntries);
  writeDb(db);
  return {
    summary: getDbSummary(db),
    cachedEntries,
    cachedTotalsBySymbol: cachedSummary.totalsBySymbol,
    cachedStatusCounts: cachedSummary.statusCounts,
    cachedHistoryCount: db.walletHistoryRows.length,
    cachedHistoryAdded: historyStore.addedCount,
    latestModelDeltaAudit,
  };
}

function persistSignalViewSnapshot(payload) {
  if (!payload || !payload.dedupeKey || !payload.baseSymbol || !payload.quoteSymbol) {
    throw new Error("Signal snapshot payload is incomplete.");
  }
  const db = readDb();
  const snapshot = normalizeSignalSnapshot(payload);
  const existingIndex = db.signalViews.findIndex((item) => item.dedupeKey === snapshot.dedupeKey);
  if (existingIndex >= 0) {
    db.signalViews[existingIndex] = snapshot;
  } else {
    db.signalViews.push(snapshot);
  }
  db.signalViews = trimDbList(db.signalViews, DB_LIMITS.signalViews);
  writeDb(db);
  return {
    saved: true,
    snapshot,
    summary: getDbSummary(db),
  };
}

function inferTodoHandlerId(item) {
  const id = String(item && item.id ? item.id : "");
  const text = [item && item.task, item && item.scope, id].join(" ").toLowerCase();
  if (
    id === "ncwallet-gatherer-bot"
    || text.includes("funded wallet scan")
    || text.includes("surf wallet coins across day, week, month and year")
  ) {
    return "gatherer-sidecar:funded-wallet-scan";
  }
  if (
    text.includes("ui")
    || text.includes("chart")
    || text.includes("plot")
    || text.includes("card")
    || text.includes("dropdown")
    || text.includes("icon")
    || text.includes("zoom")
    || text.includes("theme")
    || text.includes("handler")
    || text.includes("queue")
    || text.includes("todo")
    || text.includes("cooldown")
    || text.includes("button")
    || text.includes("pause")
    || text.includes("server")
    || text.includes("sidecar")
  ) {
    return "codex-session-task";
  }
  return "manual-review";
}

function normalizeTodoItem(item) {
  return {
    id: String(item.id),
    status: item.status === "done" ? "done" : "open",
    priority: Math.max(1, Math.min(3, Number(item.priority) || 3)),
    task: String(item.task),
    scope: item.scope ? String(item.scope) : "",
    specialRule: item.specialRule ? String(item.specialRule) : null,
    specialCycle: Math.max(1, Number(item.specialCycle) || 1),
    spawnedFrom: item.spawnedFrom ? String(item.spawnedFrom) : null,
    handlerId: item.handlerId || inferTodoHandlerId(item),
    agentRequest: item.agentRequest && item.agentRequest.status ? {
      status: String(item.agentRequest.status),
      queuedAt: item.agentRequest.queuedAt || null,
      startedAt: item.agentRequest.startedAt || null,
      finishedAt: item.agentRequest.finishedAt || null,
      runner: item.agentRequest.runner || null,
      note: item.agentRequest.note || null,
    } : null,
    savedAt: new Date().toISOString(),
  };
}

function slugifyTodoLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

function createTodoId(prefix, label) {
  return `${prefix}-${slugifyTodoLabel(label)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

function buildRecursiveFollowupTask(cycle) {
  const recipes = [
    {
      priority: 2,
      task: "Model audit history panel",
      scope: "Show saved wallet sync audit rows in-app so model deltas can be reviewed without opening exported JSON snapshots.",
    },
    {
      priority: 3,
      task: "Snapshot export history strip",
      scope: "Show the latest exported snapshot filename and timestamp near the footer export button for quick operator feedback.",
    },
    {
      priority: 2,
      task: "Wallet sync source badge",
      scope: "Expose whether current wallet values come from live wallets, cached wallets, or active-wallet fallback directly in the sync section.",
    },
    {
      priority: 3,
      task: "Forecast archive axis cleanup",
      scope: "Tighten dense date-axis readability in the forecast archive views after the main model chart stabilization pass.",
    },
  ];
  const recipe = recipes[(Math.max(1, cycle) - 1) % recipes.length];
  return {
    id: createTodoId("recursive-followup", recipe.task),
    status: "open",
    priority: recipe.priority,
    task: recipe.task,
    scope: recipe.scope,
    handlerId: inferTodoHandlerId(recipe),
    agentRequest: null,
    specialRule: null,
    specialCycle: 1,
    spawnedFrom: "recursive-special-task",
  };
}

function buildRecursiveSpecialClone(sourceItem) {
  const nextCycle = Math.max(1, Number(sourceItem && sourceItem.specialCycle) || 1) + 1;
  return {
    id: createTodoId("recursive-special", sourceItem && sourceItem.task ? sourceItem.task : "recursive-special-task"),
    status: "open",
    priority: Math.max(1, Math.min(3, Number(sourceItem && sourceItem.priority) || 3)),
    task: sourceItem && sourceItem.task ? String(sourceItem.task) : "Recursive special task",
    scope: sourceItem && sourceItem.scope ? String(sourceItem.scope) : "",
    specialRule: "recursive-regenerator",
    specialCycle: nextCycle,
    spawnedFrom: sourceItem && sourceItem.id ? String(sourceItem.id) : null,
    handlerId: sourceItem && sourceItem.handlerId ? String(sourceItem.handlerId) : "manual-review",
    agentRequest: null,
  };
}

function expandRecursiveTodoItems(previousItems, nextItems) {
  const previousById = new Map((Array.isArray(previousItems) ? previousItems : []).filter((item) => item && item.id).map((item) => [item.id, item]));
  const expanded = Array.isArray(nextItems) ? nextItems.slice() : [];

  (Array.isArray(nextItems) ? nextItems : []).forEach((item) => {
    if (!item || item.specialRule !== "recursive-regenerator") return;
    const previous = previousById.get(item.id);
    const justCompleted = item.status === "done" && (!previous || previous.status !== "done");
    if (!justCompleted) return;
    expanded.push(normalizeTodoItem(buildRecursiveFollowupTask(item.specialCycle)));
    expanded.push(normalizeTodoItem(buildRecursiveSpecialClone(item)));
  });

  return expanded;
}

async function wakeTodoRunner() {
  try {
    await fetch("http://127.0.0.1:4295/api/wake", {
      method: "POST",
      headers: { accept: "application/json" },
    });
  } catch (_) {}
}

function persistTodoItems(items) {
  const db = readDb();
  if (!Array.isArray(items)) {
    throw new Error("Todo items payload must be an array.");
  }
  const previousItems = Array.isArray(db.todoItems) ? db.todoItems.slice() : [];
  const normalizedItems = items
    .filter((item) => item && item.id && item.task)
    .map(normalizeTodoItem);
  db.todoItems = expandRecursiveTodoItems(previousItems, normalizedItems);
  writeDb(db);
  return {
    saved: true,
    items: db.todoItems,
    summary: getDbSummary(db),
  };
}

function readTodoItems() {
  const db = readDb();
  return {
    ok: true,
    items: Array.isArray(db.todoItems) ? db.todoItems : [],
    summary: getDbSummary(db),
  };
}

function readModelDeltaAudits(limit = 40) {
  const db = readDb();
  const items = Array.isArray(db.modelDeltaAudits) ? db.modelDeltaAudits.slice() : [];
  items.sort((a, b) => {
    const aTime = Date.parse(a.syncedAt || a.savedAt || 0) || 0;
    const bTime = Date.parse(b.syncedAt || b.savedAt || 0) || 0;
    return bTime - aTime;
  });
  return {
    ok: true,
    items: items.slice(0, limit),
    summary: getDbSummary(db),
  };
}

async function queueTodoTask(taskId) {
  if (!taskId) {
    throw new Error("Task id is required.");
  }
  const db = readDb();
  const items = Array.isArray(db.todoItems) ? db.todoItems.slice() : [];
  const itemIndex = items.findIndex((item) => item && item.id === taskId);
  if (itemIndex < 0) {
    throw new Error("Todo task was not found.");
  }
  const item = items[itemIndex];
  if (item.status === "done") {
    throw new Error("Completed tasks cannot be queued.");
  }
  const agentStatus = item.agentRequest && item.agentRequest.status ? String(item.agentRequest.status) : "";
  if (agentStatus === "queued" || agentStatus === "running") {
    throw new Error("Task is already queued or running.");
  }
  const handlerId = item.handlerId || inferTodoHandlerId(item);
  if (handlerId !== "gatherer-sidecar:funded-wallet-scan") {
    throw new Error("This task is not automated yet.");
  }
  items[itemIndex] = {
    ...item,
    handlerId,
    agentRequest: {
      status: "queued",
      queuedAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      runner: "todo-runner-sidecar",
      note: "Queued from dashboard.",
    },
  };
  const result = persistTodoItems(items);
  await wakeTodoRunner();
  return result;
}

function normalizeBugItem(item) {
  return {
    id: String(item.id),
    status: item.status === "done" ? "done" : "open",
    reportedAt: item.reportedAt ? String(item.reportedAt) : null,
    bug: String(item.bug),
    context: item.context ? String(item.context) : "",
    savedAt: new Date().toISOString(),
  };
}

function persistBugItems(items) {
  const db = readDb();
  if (!Array.isArray(items)) {
    throw new Error("Bug items payload must be an array.");
  }
  db.bugItems = items
    .filter((item) => item && item.id && item.bug)
    .map(normalizeBugItem);
  writeDb(db);
  return {
    saved: true,
    items: db.bugItems,
    summary: getDbSummary(db),
  };
}

function readBugItems() {
  const db = readDb();
  return {
    ok: true,
    items: Array.isArray(db.bugItems) ? db.bugItems : [],
    summary: getDbSummary(db),
  };
}

async function cdpEvaluate(webSocketUrl, expression, options = {}) {
  const awaitPromise = options.awaitPromise !== false;
  const timeoutMs = options.timeoutMs || 15000;

  return new Promise((resolve, reject) => {
    let messageId = 0;
    let settled = false;
    const pending = new Map();
    const socket = new WebSocket(webSocketUrl);

    function finishError(error) {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) {}
      reject(error instanceof Error ? error : new Error(String(error)));
    }

    function finishValue(value) {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch (_) {}
      resolve(value);
    }

    function send(method, params = {}) {
      const id = ++messageId;
      socket.send(JSON.stringify({ id, method, params }));
      return new Promise((resolveSend, rejectSend) => {
        pending.set(id, { resolve: resolveSend, reject: rejectSend });
      });
    }

    const timeout = setTimeout(() => {
      finishError(new Error("DevTools request timed out"));
    }, timeoutMs);

    socket.addEventListener("open", async () => {
      try {
        await send("Runtime.enable");
        const result = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise,
        });
        clearTimeout(timeout);
        finishValue(result.result ? result.result.value : null);
      } catch (error) {
        clearTimeout(timeout);
        finishError(error);
      }
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (!message.id || !pending.has(message.id)) return;
      const handler = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) handler.reject(new Error(message.error.message || "CDP error"));
      else handler.resolve(message.result);
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      finishError(new Error("DevTools WebSocket error"));
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        clearTimeout(timeout);
        finishError(new Error("DevTools WebSocket closed unexpectedly"));
      }
    });
  });
}

async function getNcwalletAppTarget() {
  const targets = await fetchJson(DEVTOOLS_LIST_URL);
  const appTarget = Array.isArray(targets)
    ? targets.find((target) => target.type === "page" && String(target.url || "").startsWith(NCW_APP_PREFIX))
    : null;

  if (!appTarget || !appTarget.webSocketDebuggerUrl) {
    throw new Error("Open the authenticated NC Wallet page in the prompted browser window first.");
  }
  return appTarget;
}

async function clickNcwalletRange(label) {
  const normalized = ["Day", "Week", "Month", "Year", "All"].find((item) => item.toLowerCase() === String(label || "").trim().toLowerCase());
  if (!normalized) {
    throw new Error("Unsupported NC Wallet range label.");
  }

  const appTarget = await getNcwalletAppTarget();
  const expression = `
    new Promise((resolve) => {
      const wanted = ${JSON.stringify(normalized)};
      const candidates = Array.from(document.querySelectorAll('div'))
        .map((node) => ({
          node,
          label: (node.innerText || '').trim(),
          cursor: getComputedStyle(node).cursor,
          rect: node.getBoundingClientRect()
        }))
        .filter((item) => item.label === wanted && item.cursor === 'pointer' && item.rect.width > 80 && item.rect.height >= 20)
        .sort((a, b) => b.rect.width - a.rect.width);
      const chosen = candidates[candidates.length - 1] || null;
      if (!chosen) {
        resolve(JSON.stringify({ clicked: false, label: wanted }));
        return;
      }
      chosen.node.click();
      setTimeout(() => {
        resolve(JSON.stringify({ clicked: true, label: wanted, url: location.href }));
      }, 1200);
    })
  `;

  const raw = await cdpEvaluate(appTarget.webSocketDebuggerUrl, expression, { timeoutMs: 20000 });
  const parsed = raw ? JSON.parse(raw) : null;
  if (!parsed || !parsed.clicked) {
    throw new Error(`Failed to switch NC Wallet range to ${normalized}.`);
  }
  return parsed;
}

async function getNcwalletDashboardPayload() {
  const appTarget = await getNcwalletAppTarget();

  const expression = `
    JSON.stringify((() => {
      const historySelector = '[data-testid^="history-"][data-testid$="-item"]';
      const walletSelector = '[data-testid^="coin-wallet-"]';
      const actionIds = ['buy_select_coin', 'deposit_select_coin', 'send_select_coin', 'exchange_select_coin', 'history_select_coin'];
      const historyNodes = Array.from(document.querySelectorAll(historySelector));
      const walletNodes = Array.from(document.querySelectorAll(walletSelector));
      const bodyText = document.body ? document.body.innerText : '';
      const historyEntries = historyNodes.map((node, index) => {
        const lines = (node.innerText || '')
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean);
        return {
          rowId: node.getAttribute('data-testid') || 'history-' + (index + 1),
          assetName: lines[0] || null,
          amountText: lines[1] || null,
          datetimeLabel: lines[2] || null,
          status: lines[3] || null
        };
      });
      const walletEntries = walletNodes.map((node, index) => {
        const lines = (node.innerText || '')
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean);
        return {
          rowId: node.getAttribute('data-testid') || 'wallet-' + (index + 1),
          assetName: lines[0] || null,
          balanceText: lines[1] || null,
          priceUsdText: lines[2] || null,
          totalUsdText: lines[3] || null,
          changeText: lines[4] || null
        };
      });
      const actionCards = actionIds.map((testId) => {
        const node = document.querySelector('[data-testid="' + testId + '"]');
        if (!node) return null;
        const lines = (node.innerText || '')
          .split('\\n')
          .map((line) => line.trim())
          .filter(Boolean);
        return {
          testId,
          title: lines[0] || null,
          subtitle: lines[1] || null
        };
      }).filter(Boolean);
      const chartSvg = Array.from(document.querySelectorAll('svg'))
        .filter((node) => /^0 0 10[0-9]{2} 110$/.test((node.getAttribute('viewBox') || '').trim()))
        .sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0] || null;
      const chartPaths = chartSvg ? Array.from(chartSvg.querySelectorAll('path')).map((pathNode) => pathNode.getAttribute('d')).filter(Boolean) : [];
      const rangeMeta = ['Day', 'Week', 'Month', 'Year', 'All'].map((label) => {
        const nodes = Array.from(document.querySelectorAll('div')).filter((node) => (node.innerText || '').trim() === label);
        const activeNode = nodes.find((node) => String(node.getAttribute('style') || '').includes('247, 147, 26'));
        return {
          label,
          active: Boolean(activeNode),
        };
      });
      const activeRange = rangeMeta.find((item) => item.active);
      const lastTransactionInfo = document.querySelector('[data-testid="last_trans_info"]');
      const lastTransactionStatus = document.querySelector('[data-testid="last_trans_status"]');
      return {
        title: document.title,
        url: location.href,
        authenticated: historyEntries.length > 0 || walletEntries.length > 0 || document.title.indexOf('NC Wallet') >= 0,
        bodyPreview: bodyText.slice(0, 500),
        pageLines: bodyText.split('\\n').map((line) => line.trim()).filter(Boolean).slice(0, 120),
        historyEntries,
        walletEntries,
        actionCards,
        chartFillPath: chartPaths[0] || null,
        chartLinePath: chartPaths[1] || null,
        chartViewBox: chartSvg ? chartSvg.getAttribute('viewBox') : null,
        activeRangeLabel: activeRange ? activeRange.label : null,
        lastTransactionInfo: lastTransactionInfo ? lastTransactionInfo.innerText : '',
        lastTransactionStatus: lastTransactionStatus ? lastTransactionStatus.innerText : ''
      };
    })())
  `;

  const raw = await cdpEvaluate(appTarget.webSocketDebuggerUrl, expression);
  const evaluated = raw ? JSON.parse(raw) : null;
  if (!evaluated) {
    throw new Error("NC Wallet page returned no wallet data.");
  }

  const health = detectNcwalletPageHealth(evaluated);

  const entries = Array.isArray(evaluated.historyEntries)
    ? evaluated.historyEntries.map(normalizeNcwalletEntry).filter((entry) => entry.assetName && entry.amountText)
    : [];
  const wallets = Array.isArray(evaluated.walletEntries)
    ? evaluated.walletEntries.map(normalizeNcwalletWallet).filter((entry) => entry.assetName && entry.balanceText)
    : [];
  const summary = summarizeNcwalletEntries(entries);
  const walletTotalUsd = wallets.reduce((sum, wallet) => sum + (Number.isFinite(wallet.totalUsd) ? wallet.totalUsd : 0), 0);
  const activeWalletDetail = normalizeNcwalletActiveWalletDetail({
    title: evaluated.title,
    url: evaluated.url,
    pageLines: evaluated.pageLines,
    actionCards: evaluated.actionCards,
    chartFillPath: evaluated.chartFillPath,
    chartLinePath: evaluated.chartLinePath,
    chartViewBox: evaluated.chartViewBox,
    activeRangeLabel: evaluated.activeRangeLabel,
  }, entries);
  const lastInfoLines = String(evaluated.lastTransactionInfo || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const lastStatusLines = String(evaluated.lastTransactionStatus || "").split("\n").map((line) => line.trim()).filter(Boolean);

  return {
    source: "ncwallet-live-tab",
    syncedAt: new Date().toISOString(),
    authenticated: Boolean(evaluated.authenticated),
    health,
    title: evaluated.title || "NC Wallet",
    url: evaluated.url || NCW_APP_PREFIX,
    visibleCount: entries.length,
    bodyPreview: evaluated.bodyPreview || "",
    entries,
    wallets,
    walletTotalUsd,
    fundedWalletCount: wallets.length,
    activeWalletDetail,
    lastTransaction: {
      status: lastStatusLines[0] || null,
      label: lastStatusLines[lastStatusLines.length - 1] || null,
      datetimeLabel: lastInfoLines[0] || null,
      amountText: lastInfoLines[1] || null,
    },
    ...summary,
  };
}

function detectNcwalletPageHealth(raw) {
  const title = String(raw && raw.title ? raw.title : "NC Wallet");
  const pageLines = Array.isArray(raw && raw.pageLines) ? raw.pageLines.map((line) => String(line || "").trim()).filter(Boolean) : [];
  const haystack = [title, String(raw && raw.bodyPreview ? raw.bodyPreview : ""), ...pageLines].join("\n").toLowerCase();

  if (haystack.includes("requested data incorrect or expired")) {
    return {
      state: "expired",
      stale: true,
      message: "NC Wallet says the opened page data is incorrect or expired.",
      recovery: "Reopen Wallets, History, or a specific coin page in the logged-in NC Wallet tab, then sync again.",
    };
  }

  if (haystack.includes("something went wrong")) {
    return {
      state: "broken",
      stale: true,
      message: "NC Wallet is showing an error page instead of live wallet data.",
      recovery: "Refresh the NC Wallet tab until real wallet content is visible, then sync again.",
    };
  }

  if (haystack.includes("sign in") || haystack.includes("welcome to nc wallet")) {
    return {
      state: "signin",
      stale: true,
      message: "NC Wallet is on a welcome or sign-in screen.",
      recovery: "Log back in and reopen Wallets, History, or a coin page before syncing.",
    };
  }

  return {
    state: "ok",
    stale: false,
    message: "",
    recovery: "",
  };
}

async function handleBinanceProxy(res, url) {
  const route = url.pathname.replace(/^\/api\/binance\//, "");
  if (route !== "ticker/price" && route !== "klines") {
    sendJson(res, 404, { error: "Unsupported Binance route" });
    return;
  }

  const upstream = new URL(`https://api.binance.com/api/v3/${route}`);
  url.searchParams.forEach((value, key) => upstream.searchParams.set(key, value));

  try {
    const response = await fetch(upstream, {
      headers: { accept: "application/json" },
    });
    const body = await response.text();
    res.writeHead(response.status, {
      "Content-Type": response.headers.get("content-type") || "application/json; charset=utf-8",
      "Cache-Control": route === "ticker/price" ? "no-store" : "public, max-age=15",
    });
    res.end(body);
  } catch (error) {
    sendJson(res, 502, { error: "Proxy request failed", detail: formatError(error) });
  }
}

async function handleNcwalletHistory(res) {
  try {
    const payload = await getNcwalletDashboardPayload();
    if (payload.health && payload.health.stale) {
      sendJson(res, 409, {
        error: payload.health.message,
        detail: payload.health.recovery,
        payload,
      });
      return;
    }
    if (!payload.authenticated || (!payload.visibleCount && !payload.wallets.length && !payload.activeWalletDetail)) {
      sendJson(res, 409, {
        error: "NC Wallet data is not visible in the authenticated browser tab.",
        detail: "Keep the NC Wallet browser window on Wallets, History, or a specific wallet page.",
        payload,
      });
      return;
    }
    const persisted = persistWalletSyncSnapshot(payload);
    payload.dbSummary = persisted.summary;
    payload.cachedEntries = persisted.cachedEntries;
    payload.cachedTotalsBySymbol = persisted.cachedTotalsBySymbol;
    payload.cachedStatusCounts = persisted.cachedStatusCounts;
    payload.cachedHistoryCount = persisted.cachedHistoryCount;
    payload.cachedHistoryAdded = persisted.cachedHistoryAdded;
    payload.latestModelDeltaAudit = persisted.latestModelDeltaAudit;
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, {
      error: "NC Wallet history sync failed",
      detail: formatError(error),
    });
  }
}

async function handleNcwalletRange(req, res) {
  try {
    const payload = await readJsonBody(req);
    await clickNcwalletRange(payload && payload.label);
    const synced = await getNcwalletDashboardPayload();
    if (synced.health && synced.health.stale) {
      sendJson(res, 409, {
        error: synced.health.message,
        detail: synced.health.recovery,
        payload: synced,
      });
      return;
    }
    const persisted = persistWalletSyncSnapshot(synced);
    synced.dbSummary = persisted.summary;
    synced.cachedEntries = persisted.cachedEntries;
    synced.cachedTotalsBySymbol = persisted.cachedTotalsBySymbol;
    synced.cachedStatusCounts = persisted.cachedStatusCounts;
    synced.cachedHistoryCount = persisted.cachedHistoryCount;
    synced.cachedHistoryAdded = persisted.cachedHistoryAdded;
    synced.latestModelDeltaAudit = persisted.latestModelDeltaAudit;
    sendJson(res, 200, synced);
  } catch (error) {
    sendJson(res, 502, {
      error: "NC Wallet range switch failed",
      detail: formatError(error),
    });
  }
}

function handleDbSummary(res) {
  try {
    const db = readDb();
    sendJson(res, 200, {
      ok: true,
      dbFile: DB_FILE,
      summary: getDbSummary(db),
    });
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to read local DB summary",
      detail: formatError(error),
    });
  }
}

function handleDbExport(res) {
  try {
    ensureExportDir();
    const db = readDb();
    const exportedAt = new Date().toISOString();
    const stamp = exportedAt.replace(/[:.]/g, "-");
    const filename = `ncwallet-snapshot-${stamp}.json`;
    const filePath = path.join(EXPORT_DIR, filename);
    const payload = {
      exportedAt,
      dbSummary: getDbSummary(db),
      data: db,
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
    sendJson(res, 200, {
      ok: true,
      exportedAt,
      filename,
      filePath,
      summary: payload.dbSummary,
    });
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to export DB snapshot",
      detail: formatError(error),
    });
  }
}

async function handleSignalViewStore(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = persistSignalViewSnapshot(payload);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, {
      error: "Failed to store signal view snapshot",
      detail: formatError(error),
    });
  }
}

function handleTodoRead(res) {
  try {
    sendJson(res, 200, readTodoItems());
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to read todo items",
      detail: formatError(error),
    });
  }
}

function handleModelDeltaAuditRead(res) {
  try {
    sendJson(res, 200, readModelDeltaAudits());
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to read model delta audits",
      detail: formatError(error),
    });
  }
}

function handleBugRead(res) {
  try {
    sendJson(res, 200, readBugItems());
  } catch (error) {
    sendJson(res, 500, {
      error: "Failed to read bug items",
      detail: formatError(error),
    });
  }
}

async function handleTodoStore(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = persistTodoItems(payload && payload.items);
    await wakeTodoRunner();
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, {
      error: "Failed to store todo items",
      detail: formatError(error),
    });
  }
}

async function handleBugStore(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = persistBugItems(payload && payload.items);
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, {
      error: "Failed to store bug items",
      detail: formatError(error),
    });
  }
}

async function handleTodoQueue(req, res) {
  try {
    const payload = await readJsonBody(req);
    const result = await queueTodoTask(payload && payload.id ? String(payload.id) : "");
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 400, {
      error: "Failed to queue todo task",
      detail: formatError(error),
    });
  }
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith("/api/binance/")) {
    await handleBinanceProxy(res, url);
    return;
  }

  if (url.pathname === "/api/ncwallet/history") {
    await handleNcwalletHistory(res);
    return;
  }

  if (url.pathname === "/api/ncwallet/range" && req.method === "POST") {
    await handleNcwalletRange(req, res);
    return;
  }

  if (url.pathname === "/api/local-db/summary" && req.method === "GET") {
    handleDbSummary(res);
    return;
  }

  if (url.pathname === "/api/local-db/export" && req.method === "POST") {
    handleDbExport(res);
    return;
  }

  if (url.pathname === "/api/local-db/todo" && req.method === "GET") {
    handleTodoRead(res);
    return;
  }

  if (url.pathname === "/api/local-db/model-delta-audits" && req.method === "GET") {
    handleModelDeltaAuditRead(res);
    return;
  }

  if (url.pathname === "/api/local-db/bugs" && req.method === "GET") {
    handleBugRead(res);
    return;
  }

  if (url.pathname === "/api/local-db/todo" && req.method === "POST") {
    await handleTodoStore(req, res);
    return;
  }

  if (url.pathname === "/api/local-db/bugs" && req.method === "POST") {
    await handleBugStore(req, res);
    return;
  }

  if (url.pathname === "/api/local-db/todo/queue" && req.method === "POST") {
    await handleTodoQueue(req, res);
    return;
  }

  if (url.pathname === "/api/local-db/signal-view" && req.method === "POST") {
    await handleSignalViewStore(req, res);
    return;
  }

  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = safeJoin(ROOT, pathname);
  if (!filePath) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }
    serveFile(res, filePath);
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`NC Wallet local server running at http://127.0.0.1:${PORT}`);
});
