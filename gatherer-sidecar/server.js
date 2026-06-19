const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = process.env.GATHERER_SIDECAR_HOST || "127.0.0.1";
const PORT = Number(process.env.GATHERER_SIDECAR_PORT || 4290);
const ROOT = path.join(__dirname, "..");
const MAIN_APP_BASE = process.env.GATHERER_MAIN_APP_BASE || "http://127.0.0.1:4173";
const DEVTOOLS_LIST_URL = process.env.GATHERER_DEVTOOLS_LIST_URL || "http://127.0.0.1:9222/json/list";
const NCW_APP_PREFIX = "https://app.ncwallet.net/";
const NCW_PIN_DIGITS = ["7", "4", "5", "6"];
const DB_FILE = path.join(ROOT, "data", "surf-db.json");
const STATE_DIR = path.join(__dirname, "data");
const STATE_FILE = path.join(STATE_DIR, "state.json");
const RANGE_LABELS = ["Day", "Week", "Month", "Year"];

let runtime = {
  running: false,
  stopRequested: false,
  currentRunId: null,
  currentRunType: null,
  lastMessage: "Idle",
  startedAt: null,
  statusDetail: null,
  currentTargetSymbol: null,
  currentRangeLabel: null,
  schedulePath: null,
  pauseUntil: null,
};

function ensureStateDir() {
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
}

function createEmptyState() {
  return {
    runs: [],
    manualTargets: [],
    updatedAt: new Date().toISOString(),
  };
}

function readState() {
  ensureStateDir();
  if (!fs.existsSync(STATE_FILE)) {
    const empty = createEmptyState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      runs: Array.isArray(parsed.runs) ? parsed.runs : [],
      manualTargets: Array.isArray(parsed.manualTargets) ? parsed.manualTargets : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch (_) {
    const empty = createEmptyState();
    fs.writeFileSync(STATE_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
}

function writeState(state) {
  ensureStateDir();
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function appendRun(run) {
  const state = readState();
  state.runs.push(run);
  state.runs = state.runs.slice(-120);
  writeState(state);
  return state;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_) {
    payload = { raw: text };
  }
  if (!response.ok) {
    throw new Error(payload && (payload.detail || payload.error) ? `${payload.error || "HTTP error"}: ${payload.detail || ""}`.trim() : `HTTP ${response.status}`);
  }
  return payload;
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9._-]/g, "");
}

function normalizeKnownTarget(target, defaultSource = "manual") {
  const rawUrl = String(target && target.url ? target.url : "").trim();
  if (!rawUrl) return null;
  let parsedUrl = null;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_) {
    return null;
  }
  if (parsedUrl.origin !== "https://app.ncwallet.net" || !parsedUrl.pathname.startsWith("/wallet/")) {
    return null;
  }
  const symbolFromUrl = normalizeSymbol(parsedUrl.searchParams.get("c"));
  const requestedSymbol = normalizeSymbol(target && target.symbol ? target.symbol : "");
  const symbol = requestedSymbol || symbolFromUrl;
  if (!symbol) return null;
  if (symbolFromUrl && requestedSymbol && symbolFromUrl !== requestedSymbol) {
    throw new Error("The wallet URL coin symbol does not match the typed symbol.");
  }
  parsedUrl.searchParams.set("c", symbol);
  return {
    symbol,
    url: parsedUrl.toString(),
    source: target && target.source ? String(target.source) : defaultSource,
    addedAt: target && target.addedAt ? target.addedAt : null,
    lastSeenAt: target && target.lastSeenAt ? target.lastSeenAt : null,
  };
}

function mergeKnownTargets(...lists) {
  const bySymbol = new Map();
  lists.forEach((list) => {
    (Array.isArray(list) ? list : []).forEach((item) => {
      const normalized = normalizeKnownTarget(item, item && item.source ? item.source : "known");
      if (!normalized) return;
      bySymbol.set(normalized.symbol, {
        ...(bySymbol.get(normalized.symbol) || {}),
        ...normalized,
      });
    });
  });
  return Array.from(bySymbol.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sleepWithStopCheck(ms, chunkMs = 250) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < ms) {
    if (runtime.stopRequested) return false;
    const remaining = ms - (Date.now() - startedAt);
    await sleep(Math.min(chunkMs, Math.max(remaining, 0)));
  }
  return !runtime.stopRequested;
}

function getLocalDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getWalletPageSnapshotTimestamp(snapshot) {
  return Date.parse(
    snapshot && (snapshot.lastSeenAt || snapshot.syncedAt || snapshot.savedAt)
      ? (snapshot.lastSeenAt || snapshot.syncedAt || snapshot.savedAt)
      : 0,
  ) || 0;
}

function getLatestWalletPageSnapshot(db, symbol, rangeLabel) {
  const pageViews = db && Array.isArray(db.walletPageViews) ? db.walletPageViews : [];
  for (let index = pageViews.length - 1; index >= 0; index -= 1) {
    const item = pageViews[index];
    if (!item || item.symbol !== symbol || item.rangeLabel !== rangeLabel) continue;
    return item;
  }
  return null;
}

function getPersistedWalletPageCoverage(symbol, dayKey = getLocalDateKey()) {
  const db = readMainDb();
  const pageViews = db && Array.isArray(db.walletPageViews) ? db.walletPageViews : [];
  const coveredRanges = new Set();

  for (let index = pageViews.length - 1; index >= 0; index -= 1) {
    const item = pageViews[index];
    if (!item || item.symbol !== symbol || !item.rangeLabel) continue;
    if (getLocalDateKey(item.lastSeenAt || item.syncedAt || item.savedAt) !== dayKey) continue;
    coveredRanges.add(item.rangeLabel);
  }

  return {
    dayKey,
    ranges: RANGE_LABELS.filter((label) => coveredRanges.has(label)),
  };
}

function resolveTargetSchedule(symbol, dayKey = getLocalDateKey()) {
  const coverage = getPersistedWalletPageCoverage(symbol, dayKey);
  const hasNonDayCoverage = ["Week", "Month", "Year"].every((label) => coverage.ranges.includes(label));
  return {
    dayKey,
    existingRanges: coverage.ranges,
    path: hasNonDayCoverage ? "day-only" : "full-sweep",
    labels: hasNonDayCoverage ? ["Day"] : RANGE_LABELS.slice(),
  };
}

function verifyWalletPagePersistence(symbol, rangeLabel, sinceMs) {
  const snapshot = getLatestWalletPageSnapshot(readMainDb(), symbol, rangeLabel);
  if (!snapshot) {
    throw new Error(`DB verification failed for ${symbol} ${rangeLabel}: wallet-page snapshot was not saved.`);
  }
  const persistedAtMs = getWalletPageSnapshotTimestamp(snapshot);
  if (persistedAtMs + 1000 < sinceMs) {
    throw new Error(`DB verification failed for ${symbol} ${rangeLabel}: wallet-page snapshot was not updated by the API call.`);
  }
  return {
    savedAt: snapshot.savedAt || null,
    syncedAt: snapshot.syncedAt || null,
    lastSeenAt: snapshot.lastSeenAt || null,
  };
}

async function syncWalletRangeWithPersistence(label, expectedSymbol) {
  const startedAtMs = Date.now();
  const payload = await syncWalletRange(label);
  const activeDetail = payload && payload.activeWalletDetail ? payload.activeWalletDetail : null;
  const activeSymbol = normalizeSymbol(activeDetail && activeDetail.symbol ? activeDetail.symbol : "");
  const activeRange = activeDetail && activeDetail.activeRangeLabel ? activeDetail.activeRangeLabel : label;
  if (expectedSymbol && activeSymbol && activeSymbol !== expectedSymbol) {
    throw new Error(`Expected ${expectedSymbol} but NC Wallet stayed on ${activeSymbol}.`);
  }
  if (activeRange !== label) {
    throw new Error(`Expected ${label} but NC Wallet reported ${activeRange || "unknown"} instead.`);
  }
  const symbolToVerify = expectedSymbol || activeSymbol;
  if (!symbolToVerify) {
    throw new Error(`DB verification failed for ${label}: missing active wallet symbol in API response.`);
  }
  const persisted = verifyWalletPagePersistence(symbolToVerify, activeRange, startedAtMs);
  return {
    payload,
    persisted,
    activeSymbol: symbolToVerify,
    activeRange,
  };
}

async function waitForRangeCooldown(run, symbol, fromLabel, toLabel) {
  const pauseMs = 3000 + Math.floor(Math.random() * 5001);
  const pauseUntil = new Date(Date.now() + pauseMs).toISOString();
  runtime.currentTargetSymbol = symbol;
  runtime.currentRangeLabel = toLabel;
  runtime.pauseUntil = pauseUntil;
  runtime.statusDetail = `Cooldown ${Math.round(pauseMs / 100) / 10}s before ${symbol} ${toLabel}.`;
  runtime.lastMessage = `Pausing before ${symbol} ${toLabel}`;
  run.steps.push({
    at: new Date().toISOString(),
    action: "range-cooldown",
    symbol,
    fromRange: fromLabel,
    toRange: toLabel,
    pauseMs,
  });
  const completed = await sleepWithStopCheck(pauseMs, 250);
  runtime.pauseUntil = null;
  runtime.statusDetail = null;
  return completed;
}

async function cdpEvaluate(webSocketUrl, expression, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let messageId = 0;
    let settled = false;

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

    const timeout = setTimeout(() => finishError(new Error("DevTools request timed out")), timeoutMs);

    socket.addEventListener("open", async () => {
      try {
        await send("Runtime.enable");
        const result = await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
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

async function cdpNavigate(webSocketUrl, url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const pending = new Map();
    let messageId = 0;
    let settled = false;
    let navigatedAt = 0;

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

    const timeout = setTimeout(() => finishError(new Error("DevTools navigate timed out")), timeoutMs);

    socket.addEventListener("open", async () => {
      try {
        await send("Page.enable");
        await send("Page.navigate", { url });
        navigatedAt = Date.now();
      } catch (error) {
        clearTimeout(timeout);
        finishError(error);
      }
    });

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && pending.has(message.id)) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) handler.reject(new Error(message.error.message || "CDP error"));
        else handler.resolve(message.result);
        return;
      }

      if (message.method === "Page.loadEventFired" && navigatedAt) {
        clearTimeout(timeout);
        finishValue({ ok: true, url });
      }
    });

    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      finishError(new Error("DevTools WebSocket error"));
    });

    socket.addEventListener("close", () => {
      if (!settled) {
        if (navigatedAt && Date.now() - navigatedAt > 1200) {
          clearTimeout(timeout);
          finishValue({ ok: true, url });
          return;
        }
        clearTimeout(timeout);
        finishError(new Error("DevTools WebSocket closed unexpectedly"));
      }
    });
  });
}

async function getNcwalletAppTarget() {
  const targets = await fetchJson(DEVTOOLS_LIST_URL);
  const target = Array.isArray(targets)
    ? targets.find((item) => item.type === "page" && String(item.url || "").startsWith(NCW_APP_PREFIX))
    : null;
  if (!target || !target.webSocketDebuggerUrl) {
    throw new Error("Open the authenticated NC Wallet page in the prompted browser window first.");
  }
  return target;
}

async function readNcwalletPageState() {
  const target = await getNcwalletAppTarget();
  const expression = `
    JSON.stringify({
      title: document.title || '',
      url: location.href || '',
      needsPin: Boolean(document.querySelector('[data-testid^="pin-key-"]'))
        || /enter your pin code/i.test(document.body.innerText || '')
    })
  `;
  const raw = await cdpEvaluate(target.webSocketDebuggerUrl, expression, 15000);
  return raw ? JSON.parse(raw) : { title: "", url: NCW_APP_PREFIX, needsPin: false };
}

async function unlockNcwalletIfNeeded() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const state = await readNcwalletPageState();
    if (!state.needsPin) {
      return { unlocked: attempt > 0, state };
    }
    const target = await getNcwalletAppTarget();
    const expression = `
      (async () => {
        const digits = ${JSON.stringify(NCW_PIN_DIGITS)};
        for (const digit of digits) {
          const key = document.querySelector('[data-testid="pin-key-' + digit + '"]')
            || Array.from(document.querySelectorAll('[tabindex="0"]')).find((node) => (node.innerText || '').trim() === digit);
          if (!key) {
            throw new Error('Missing PIN key ' + digit);
          }
          key.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          await new Promise((resolve) => setTimeout(resolve, 160));
        }
        return JSON.stringify({ entered: true, title: document.title || '', url: location.href || '' });
      })()
    `;
    await cdpEvaluate(target.webSocketDebuggerUrl, expression, 15000);
    await sleep(1200);
  }
  const finalState = await readNcwalletPageState();
  if (finalState.needsPin) {
    throw new Error("NC Wallet PIN prompt is still open.");
  }
  return { unlocked: true, state: finalState };
}

async function navigateNcwallet(url) {
  const target = await getNcwalletAppTarget();
  return cdpNavigate(target.webSocketDebuggerUrl, url, 25000);
}

async function scrapeWalletLinks() {
  const target = await getNcwalletAppTarget();
  const expression = `
    JSON.stringify(
      Array.from(document.querySelectorAll('a[href*="/wallet/"]'))
        .map((node) => {
          const href = node.href || node.getAttribute('href') || '';
          let symbol = '';
          try {
            symbol = new URL(href, location.origin).searchParams.get('c') || '';
          } catch (_) {}
          return { href, symbol };
        })
        .filter((item) => item.href && item.symbol)
    )
  `;
  const raw = await cdpEvaluate(target.webSocketDebuggerUrl, expression, 20000);
  const parsed = raw ? JSON.parse(raw) : [];
  const deduped = new Map();
  parsed.forEach((item) => {
    if (!item || !item.symbol || !item.href) return;
    deduped.set(item.symbol, { symbol: item.symbol, url: item.href });
  });
  return Array.from(deduped.values()).sort((a, b) => a.symbol.localeCompare(b.symbol));
}

async function syncWalletHistory() {
  return fetchJson(`${MAIN_APP_BASE}/api/ncwallet/history`, {
    headers: { accept: "application/json" },
  });
}

async function syncWalletRange(label) {
  return fetchJson(`${MAIN_APP_BASE}/api/ncwallet/range`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ label }),
  });
}

async function syncWalletHistoryWithRetry(attempts = 8, delayMs = 1500) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await unlockNcwalletIfNeeded();
      return await syncWalletHistory();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError || new Error("Wallet history sync failed.");
}

function readMainDb() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (_) {
    return null;
  }
}

function getCachedWalletUrls() {
  const db = readMainDb();
  const latestSyncs = db && Array.isArray(db.walletSyncs) ? db.walletSyncs : [];
  const latestWallets = latestSyncs.length && Array.isArray(latestSyncs[latestSyncs.length - 1].wallets)
    ? latestSyncs[latestSyncs.length - 1].wallets
    : [];
  const wantedSymbols = latestWallets
    .filter((wallet) => wallet && wallet.symbol)
    .map((wallet) => wallet.symbol);

  const pageViews = db && Array.isArray(db.walletPageViews) ? db.walletPageViews.slice() : [];
  const urlsBySymbol = new Map();
  for (let index = pageViews.length - 1; index >= 0; index -= 1) {
    const item = pageViews[index];
    if (!item || !item.symbol || !item.url || urlsBySymbol.has(item.symbol)) continue;
    urlsBySymbol.set(item.symbol, item.url);
  }

  return wantedSymbols
    .filter((symbol) => urlsBySymbol.has(symbol))
    .map((symbol) => ({ symbol, url: urlsBySymbol.get(symbol), source: "cached" }));
}

function getManualTargets() {
  const state = readState();
  return mergeKnownTargets(Array.isArray(state.manualTargets) ? state.manualTargets : []);
}

function getKnownTargetsSnapshot() {
  return mergeKnownTargets(getCachedWalletUrls(), getManualTargets());
}

async function getOpenedCoinTarget() {
  const target = await getNcwalletAppTarget();
  const expression = `
    (() => {
      const href = location.href || '';
      let symbol = '';
      try {
        symbol = new URL(href).searchParams.get('c') || '';
      } catch (_) {}
      const heading = (document.querySelector('h1')?.textContent || '').trim();
      return JSON.stringify({ url: href, symbol, heading });
    })()
  `;
  const raw = await cdpEvaluate(target.webSocketDebuggerUrl, expression, 20000);
  const parsed = raw ? JSON.parse(raw) : null;
  const normalized = normalizeKnownTarget({
    symbol: parsed && parsed.symbol ? parsed.symbol : (parsed && parsed.heading ? parsed.heading : ""),
    url: parsed && parsed.url ? parsed.url : "",
    source: "opened-page",
  }, "opened-page");
  if (!normalized) {
    throw new Error("Open a specific NC Wallet coin page first, then try again.");
  }
  return normalized;
}

async function resolveKnownTargetInput(input) {
  const symbol = normalizeSymbol(input && input.symbol ? input.symbol : "");
  const rawUrl = String(input && input.url ? input.url : "").trim();
  if (rawUrl) {
    const normalized = normalizeKnownTarget({ symbol, url: rawUrl, source: "manual" }, "manual");
    if (!normalized) {
      throw new Error("Paste a valid NC Wallet coin URL or use the opened-coin helper.");
    }
    return normalized;
  }
  const opened = await getOpenedCoinTarget();
  if (symbol && opened.symbol !== symbol) {
    throw new Error(`Opened coin is ${opened.symbol}, not ${symbol}.`);
  }
  return {
    ...opened,
    symbol: symbol || opened.symbol,
    source: "manual",
  };
}

async function saveManualTarget(input) {
  const resolved = await resolveKnownTargetInput(input);
  const state = readState();
  const now = new Date().toISOString();
  const current = Array.isArray(state.manualTargets) ? state.manualTargets : [];
  const next = current.filter((item) => item && item.symbol !== resolved.symbol);
  next.push({
    ...resolved,
    source: "manual",
    addedAt: current.find((item) => item && item.symbol === resolved.symbol)?.addedAt || now,
    lastSeenAt: now,
  });
  state.manualTargets = mergeKnownTargets(next);
  writeState(state);
  return {
    saved: true,
    target: state.manualTargets.find((item) => item.symbol === resolved.symbol) || resolved,
    knownTargets: mergeKnownTargets(getCachedWalletUrls(), state.manualTargets),
  };
}

async function buildScanTargets() {
  const visibleLinks = await scrapeWalletLinks().catch(() => []);
  return mergeKnownTargets(
    getCachedWalletUrls(),
    visibleLinks.map((item) => ({ ...item, source: "wallets-page" })),
    getManualTargets(),
  );
}

function beginRun(type, message) {
  const runId = `${type}-${Date.now()}`;
  runtime = {
    running: true,
    stopRequested: false,
    currentRunId: runId,
    currentRunType: type,
    lastMessage: message,
    startedAt: new Date().toISOString(),
    statusDetail: null,
    currentTargetSymbol: null,
    currentRangeLabel: null,
    schedulePath: null,
    pauseUntil: null,
  };
  return {
    id: runId,
    type,
    startedAt: runtime.startedAt,
    finishedAt: null,
    status: "running",
    message,
    steps: [],
    errors: [],
  };
}

function finishRun(run, status, message) {
  runtime.running = false;
  runtime.currentRunId = null;
  runtime.currentRunType = null;
  runtime.stopRequested = false;
  runtime.lastMessage = message;
  runtime.startedAt = null;
  runtime.statusDetail = null;
  runtime.currentTargetSymbol = null;
  runtime.currentRangeLabel = null;
  runtime.schedulePath = null;
  runtime.pauseUntil = null;
  run.status = status;
  run.message = message;
  run.finishedAt = new Date().toISOString();
  appendRun(run);
  return run;
}

async function runHistoryImport() {
  const run = beginRun("history-import", "Importing currently visible NC Wallet history.");
  try {
    const payload = await syncWalletHistory();
    run.steps.push({
      at: new Date().toISOString(),
      action: "sync-wallet-history",
      visibleCount: payload.visibleCount || 0,
      cachedHistoryCount: payload.cachedHistoryCount || 0,
      fundedWalletCount: payload.fundedWalletCount || 0,
    });
    return finishRun(run, "completed", "History import completed.");
  } catch (error) {
    run.errors.push({ at: new Date().toISOString(), message: formatError(error) });
    return finishRun(run, "failed", formatError(error));
  }
}

async function runFundedWalletScan() {
  const run = beginRun("funded-wallet-scan", "Scanning funded NC Wallet coin pages with daily schedule checks.");
  try {
    try {
      const unlockResult = await unlockNcwalletIfNeeded();
      if (unlockResult.unlocked) {
        run.steps.push({
          at: new Date().toISOString(),
          action: "unlock-wallet",
          title: unlockResult.state && unlockResult.state.title ? unlockResult.state.title : null,
        });
      }
      const preflightPayload = await syncWalletHistory();
      run.steps.push({
        at: new Date().toISOString(),
        action: "preflight-sync",
        visibleCount: preflightPayload.visibleCount || 0,
        cachedHistoryCount: preflightPayload.cachedHistoryCount || 0,
      });
    } catch (error) {
      run.steps.push({
        at: new Date().toISOString(),
        action: "preflight-sync-skipped",
        detail: formatError(error),
      });
    }
    const targets = await buildScanTargets();
    run.steps.push({
      at: new Date().toISOString(),
      action: "discover-targets",
      count: targets.length,
      symbols: targets.map((item) => item.symbol),
    });
    if (!targets.length) {
      throw new Error("No funded wallet links found. Open the NC Wallet Wallets page once, or let the main app cache a few coin pages first.");
    }

    for (const target of targets) {
      if (runtime.stopRequested) {
        return finishRun(run, "stopped", "Gatherer stopped by user.");
      }
      try {
        const schedule = resolveTargetSchedule(target.symbol);
        runtime.schedulePath = schedule.path;
        runtime.currentTargetSymbol = target.symbol;
        runtime.currentRangeLabel = null;
        runtime.statusDetail = `${target.symbol} ${schedule.path} for ${schedule.dayKey}.`;
        run.steps.push({
          at: new Date().toISOString(),
          action: "target-schedule",
          symbol: target.symbol,
          schedulePath: schedule.path,
          dayKey: schedule.dayKey,
          ranges: schedule.labels,
          existingRangesToday: schedule.existingRanges,
        });
        runtime.lastMessage = `Opening ${target.symbol}`;
        await navigateNcwallet(target.url);
        await sleep(1800);

        for (let index = 0; index < schedule.labels.length; index += 1) {
          const label = schedule.labels[index];
          if (runtime.stopRequested) {
            return finishRun(run, "stopped", "Gatherer stopped by user.");
          }
          try {
            if (index > 0) {
              const pauseCompleted = await waitForRangeCooldown(run, target.symbol, schedule.labels[index - 1], label);
              if (!pauseCompleted || runtime.stopRequested) {
                return finishRun(run, "stopped", "Gatherer stopped by user.");
              }
            }
            runtime.lastMessage = `${target.symbol} ${label}`;
            runtime.statusDetail = `Running ${schedule.path} step ${label}.`;
            runtime.currentTargetSymbol = target.symbol;
            runtime.currentRangeLabel = label;
            await unlockNcwalletIfNeeded();
            const rangeResult = await syncWalletRangeWithPersistence(label, target.symbol);
            const rangePayload = rangeResult.payload;
            run.steps.push({
              at: new Date().toISOString(),
              action: "scan-range",
              symbol: target.symbol,
              range: label,
              schedulePath: schedule.path,
              activeRange: rangePayload.activeWalletDetail && rangePayload.activeWalletDetail.activeRangeLabel ? rangePayload.activeWalletDetail.activeRangeLabel : null,
              persistedAt: rangeResult.persisted.lastSeenAt || rangeResult.persisted.syncedAt || rangeResult.persisted.savedAt,
              cachedHistoryCount: rangePayload.cachedHistoryCount || 0,
            });
            await sleep(1400);
          } catch (error) {
            run.errors.push({
              at: new Date().toISOString(),
              symbol: target.symbol,
              range: label,
              message: formatError(error),
            });
            run.steps.push({
              at: new Date().toISOString(),
              action: "scan-range-skipped",
              symbol: target.symbol,
              range: label,
              schedulePath: schedule.path,
              detail: formatError(error),
            });
          }
        }
        runtime.currentRangeLabel = null;
        runtime.statusDetail = null;
      } catch (error) {
        run.errors.push({
          at: new Date().toISOString(),
          symbol: target.symbol,
          message: formatError(error),
        });
        run.steps.push({
          at: new Date().toISOString(),
          action: "target-skipped",
          symbol: target.symbol,
          schedulePath: runtime.schedulePath,
          detail: formatError(error),
        });
      }
    }

    return finishRun(run, "completed", "Funded wallet scan completed.");
  } catch (error) {
    run.errors.push({ at: new Date().toISOString(), message: formatError(error) });
    return finishRun(run, "failed", formatError(error));
  }
}

function getStatusPayload() {
  const state = readState();
  const runs = Array.isArray(state.runs) ? state.runs.slice().reverse() : [];
  const knownTargets = getKnownTargetsSnapshot();
  return {
    ok: true,
    port: PORT,
    runtime,
    latestRun: runs[0] || null,
    recentRuns: runs.slice(0, 12),
    knownTargets,
    manualTargets: getManualTargets(),
  };
}

function renderApp() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NC Wallet Gatherer</title>
<style>
body{margin:0;font-family:Segoe UI,Arial,sans-serif;background:#0f1117;color:#e8eaf6;padding:24px}
.shell{max-width:1080px;margin:0 auto}
.card{background:#181c27;border:1px solid rgba(79,195,247,.12);border-radius:16px;padding:18px 20px;margin-bottom:16px}
h1{margin:0 0 8px;font-size:24px}
p{margin:0 0 12px;color:#90a4ae;line-height:1.5}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:16px 0}
button{border:0;border-radius:10px;padding:10px 14px;font:600 13px inherit;cursor:pointer}
input{border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:10px 12px;background:#20263a;color:#e8eaf6;font:500 13px inherit;min-width:0}
.grow{flex:1 1 360px}
.primary{background:#4fc3f7;color:#07131b}
.warn{background:#ffb74d;color:#2f1b00}
.danger{background:#ef5350;color:#fff}
.ghost{background:#252b42;color:#e8eaf6}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}
.stat{background:#20263a;border-radius:12px;padding:12px}
.stat strong{display:block;margin-bottom:6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7f8fa4}
.stat span{font-size:18px;font-weight:700}
table{width:100%;border-collapse:collapse;font-size:12px}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
th{color:#7f8fa4;font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.mono{font-family:Consolas,monospace}
.ok{color:#69f0ae}
.bad{color:#ef5350}
.muted{color:#90a4ae}
code{font-family:Consolas,monospace}
</style></head>
<body><div class="shell">
<div class="card">
<h1>NC Wallet Gatherer</h1>
<p>Uses the existing NC Wallet browser session on <code>127.0.0.1:9222</code> and the main app sync server on <code>127.0.0.1:4173</code>. Keep NC Wallet logged in. For best target discovery, open the Wallets page once before starting.</p>
<div class="toolbar">
<button class="primary" id="scan">Run funded coin scan</button>
<button class="warn" id="history">Import visible history</button>
<button class="danger" id="stop">Stop</button>
<button class="ghost" id="refresh">Refresh</button>
</div>
<div class="grid">
<div class="stat"><strong>Runtime</strong><span id="runtime">Idle</span></div>
<div class="stat"><strong>Current run</strong><span id="runId">--</span></div>
<div class="stat"><strong>Known targets</strong><span id="targets">0</span></div>
<div class="stat"><strong>Recent runs</strong><span id="runs">0</span></div>
</div>
</div>
<div class="card">
<h2 style="margin:0 0 10px;font-size:14px">Watch a new coin target</h2>
<p>Add a coin page for the gatherer to keep watching even when it is not in the currently discovered funded-wallet list. You can paste the exact NC Wallet coin URL, or pull the page you already have opened.</p>
<div class="toolbar">
<input id="targetSymbol" placeholder="Symbol, e.g. DOGE">
<input id="targetUrl" class="grow mono" placeholder="https://app.ncwallet.net/wallet/...?...">
<button class="ghost" id="useCurrentTarget">Use opened coin page</button>
<button class="primary" id="addTarget">Add watched target</button>
</div>
<p id="targetMessage" class="muted">Saved watched targets join the gatherer scan list on later runs.</p>
</div>
<div class="card">
<h2 style="margin:0 0 10px;font-size:14px">Latest activity</h2>
<p id="headline" class="muted">Waiting for status.</p>
<div style="overflow:auto"><table><thead><tr><th>When</th><th>Action</th><th>Detail</th></tr></thead><tbody id="steps"></tbody></table></div>
</div>
<div class="card">
<h2 style="margin:0 0 10px;font-size:14px">Known watched targets</h2>
<div style="overflow:auto"><table><thead><tr><th>Symbol</th><th>Source</th><th>URL</th></tr></thead><tbody id="targetsTable"></tbody></table></div>
</div>
<script>
async function getJson(url){
  const response=await fetch(url,{headers:{accept:'application/json'}});
  const payload=await response.json();
  if(!response.ok) throw new Error(payload.detail||payload.error||'Request failed');
  return payload;
}
async function postJson(url,body){
  const options={method:'POST',headers:{accept:'application/json'}};
  if(typeof body!=='undefined'){
    options.headers['content-type']='application/json';
    options.body=JSON.stringify(body);
  }
  const response=await fetch(url,options);
  const payload=await response.json();
  if(!response.ok) throw new Error(payload.detail||payload.error||'Request failed');
  return payload;
}
function setTargetMessage(message,tone){
  var node=document.getElementById('targetMessage');
  if(!node) return;
  node.textContent=message;
  node.className=tone||'muted';
}
async function loadStatus(){
  const payload=await getJson('/api/status');
  document.getElementById('runtime').textContent=payload.runtime.running?(payload.runtime.currentRunType+' running'):'Idle';
  document.getElementById('runId').textContent=payload.runtime.currentRunId||'--';
  document.getElementById('targets').textContent=String((payload.knownTargets||[]).length);
  document.getElementById('runs').textContent=String((payload.recentRuns||[]).length);
  document.getElementById('headline').textContent=payload.runtime.statusDetail||payload.runtime.lastMessage||'Idle';
  var latest=payload.latestRun;
  document.getElementById('steps').innerHTML=latest&&Array.isArray(latest.steps)&&latest.steps.length
    ? latest.steps.slice(-20).reverse().map(function(step){
        return '<tr><td>'+(step.at||'--')+'</td><td>'+(step.action||'--')+'</td><td>'+JSON.stringify(step)+'</td></tr>';
      }).join('')
    : '<tr><td colspan="3" class="muted">No run steps yet.</td></tr>';
  document.getElementById('targetsTable').innerHTML=(payload.knownTargets||[]).length
    ? payload.knownTargets.map(function(item){
        return '<tr><td>'+item.symbol+'</td><td>'+(item.source||'known')+'</td><td class="mono">'+item.url+'</td></tr>';
      }).join('')
    : '<tr><td colspan="3" class="muted">No watched target URLs yet.</td></tr>';
}
document.getElementById('scan').addEventListener('click',async function(){try{await postJson('/api/run/funded-wallet-scan');await loadStatus();}catch(error){alert(error.message);}});
document.getElementById('history').addEventListener('click',async function(){try{await postJson('/api/run/history-import');await loadStatus();}catch(error){alert(error.message);}});
document.getElementById('stop').addEventListener('click',async function(){try{await postJson('/api/stop');await loadStatus();}catch(error){alert(error.message);}});
document.getElementById('useCurrentTarget').addEventListener('click',async function(){
  try{
    var payload=await getJson('/api/current-target');
    document.getElementById('targetSymbol').value=payload.target.symbol||'';
    document.getElementById('targetUrl').value=payload.target.url||'';
    setTargetMessage('Loaded the currently opened NC Wallet coin page.','ok');
  }catch(error){
    setTargetMessage(error.message,'bad');
  }
});
document.getElementById('addTarget').addEventListener('click',async function(){
  try{
    var payload=await postJson('/api/targets',{
      symbol:document.getElementById('targetSymbol').value,
      url:document.getElementById('targetUrl').value
    });
    document.getElementById('targetSymbol').value=payload.target.symbol||'';
    document.getElementById('targetUrl').value=payload.target.url||'';
    setTargetMessage('Saved watched target '+payload.target.symbol+'.','ok');
    await loadStatus();
  }catch(error){
    setTargetMessage(error.message,'bad');
  }
});
document.getElementById('refresh').addEventListener('click',loadStatus);
loadStatus();
setInterval(loadStatus,4000);
</script>
</div></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, port: PORT, runtime });
    return;
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    sendJson(res, 200, getStatusPayload());
    return;
  }

  if (url.pathname === "/api/current-target" && req.method === "GET") {
    try {
      const target = await getOpenedCoinTarget();
      sendJson(res, 200, { ok: true, target });
    } catch (error) {
      sendJson(res, 400, { error: "Current target failed", detail: formatError(error) });
    }
    return;
  }

  if (url.pathname === "/api/targets" && req.method === "POST") {
    try {
      const payload = await readJsonBody(req);
      const result = await saveManualTarget(payload || {});
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { error: "Target save failed", detail: formatError(error) });
    }
    return;
  }

  if (url.pathname === "/api/run/history-import" && req.method === "POST") {
    if (runtime.running) {
      sendJson(res, 409, { error: "Gatherer is already running.", runtime });
      return;
    }
    runHistoryImport().catch(() => {});
    sendJson(res, 202, { ok: true, started: true, type: "history-import" });
    return;
  }

  if (url.pathname === "/api/run/funded-wallet-scan" && req.method === "POST") {
    if (runtime.running) {
      sendJson(res, 409, { error: "Gatherer is already running.", runtime });
      return;
    }
    runFundedWalletScan().catch(() => {});
    sendJson(res, 202, { ok: true, started: true, type: "funded-wallet-scan" });
    return;
  }

  if (url.pathname === "/api/stop" && req.method === "POST") {
    runtime.stopRequested = true;
    runtime.lastMessage = "Stop requested.";
    sendJson(res, 200, { ok: true, runtime });
    return;
  }

  if (url.pathname === "/" && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(renderApp());
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`NC Wallet gatherer sidecar listening on http://${HOST}:${PORT}`);
});
