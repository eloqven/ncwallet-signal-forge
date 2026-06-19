const http = require("http");

const HOST = process.env.TODO_RUNNER_HOST || "127.0.0.1";
const PORT = Number(process.env.TODO_RUNNER_PORT || 4295);
const MAIN_APP_BASE = process.env.TODO_RUNNER_MAIN_APP_BASE || "http://127.0.0.1:4173";
const GATHERER_BASE = process.env.TODO_RUNNER_GATHERER_BASE || "http://127.0.0.1:4290";
const POLL_MS = 3000;

const state = {
  running: false,
  processing: false,
  worker: "todo-runner-sidecar",
  lastMessage: "Idle",
  currentTaskId: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastResult: null,
};

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function loadTodoPayload() {
  return fetchJson(`${MAIN_APP_BASE}/api/local-db/todo`, {
    headers: { accept: "application/json" },
  });
}

async function saveTodoItems(items) {
  return fetchJson(`${MAIN_APP_BASE}/api/local-db/todo`, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ items }),
  });
}

function sortQueue(items) {
  return items.slice().sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return String(a.task || "").localeCompare(String(b.task || ""));
  });
}

async function markTask(items, taskId, patch) {
  const nextItems = items.map((item) => {
    if (item.id !== taskId) return item;
    return {
      ...item,
      agentRequest: {
        ...(item.agentRequest || {}),
        ...patch,
      },
    };
  });
  await saveTodoItems(nextItems);
  return nextItems;
}

async function runGathererTask(task, items) {
  const startedAt = new Date().toISOString();
  state.running = true;
  state.currentTaskId = task.id;
  state.lastStartedAt = startedAt;
  state.lastMessage = `Running ${task.id}`;

  await markTask(items, task.id, {
    status: "running",
    queuedAt: task.agentRequest && task.agentRequest.queuedAt ? task.agentRequest.queuedAt : startedAt,
    startedAt,
    finishedAt: null,
    runner: state.worker,
    note: "Starting funded wallet scan on gatherer sidecar.",
  });

  try {
    let attachedToRunningScan = false;
    try {
      await fetchJson(`${GATHERER_BASE}/api/run/funded-wallet-scan`, {
        method: "POST",
        headers: { accept: "application/json" },
      });
    } catch (error) {
      if (!/already running/i.test(formatError(error))) {
        throw error;
      }
      attachedToRunningScan = true;
      const runningItems = (await loadTodoPayload()).items || [];
      await markTask(runningItems, task.id, {
        status: "running",
        queuedAt: task.agentRequest && task.agentRequest.queuedAt ? task.agentRequest.queuedAt : startedAt,
        startedAt,
        finishedAt: null,
        runner: state.worker,
        note: "Attached to an already running funded wallet scan.",
      });
    }

    let latestStatus = null;
    while (true) {
      await sleep(2500);
      latestStatus = await fetchJson(`${GATHERER_BASE}/api/status`, {
        headers: { accept: "application/json" },
      });
      if (latestStatus.runtime && latestStatus.runtime.running) continue;
      const latestRun = latestStatus.latestRun;
      if (!latestRun) break;
      if (latestRun.type === "funded-wallet-scan" && latestRun.finishedAt) break;
    }

    const finishedAt = new Date().toISOString();
    const latestRun = latestStatus && latestStatus.latestRun ? latestStatus.latestRun : null;
    const completedItems = (await loadTodoPayload()).items || [];
    await markTask(completedItems, task.id, {
      status: latestRun && latestRun.status === "completed" ? "completed" : "failed",
      finishedAt,
      runner: state.worker,
      note: latestRun && latestRun.message
        ? latestRun.message
        : attachedToRunningScan
          ? "Attached gatherer run finished."
          : "Gatherer finished.",
    });
    state.lastFinishedAt = finishedAt;
    state.lastResult = latestRun && latestRun.status ? latestRun.status : "completed";
    state.lastMessage = latestRun && latestRun.message
      ? latestRun.message
      : attachedToRunningScan
        ? "Attached gatherer run finished."
        : "Gatherer finished.";
  } catch (error) {
    const finishedAt = new Date().toISOString();
    const failedItems = (await loadTodoPayload()).items || [];
    await markTask(failedItems, task.id, {
      status: "failed",
      finishedAt,
      runner: state.worker,
      note: formatError(error),
    });
    state.lastFinishedAt = finishedAt;
    state.lastResult = "failed";
    state.lastMessage = formatError(error);
  } finally {
    state.running = false;
    state.currentTaskId = null;
  }
}

async function runUnsupportedTask(task, items) {
  const finishedAt = new Date().toISOString();
  await markTask(items, task.id, {
    status: "failed",
    queuedAt: task.agentRequest && task.agentRequest.queuedAt ? task.agentRequest.queuedAt : finishedAt,
    startedAt: finishedAt,
    finishedAt,
    runner: state.worker,
    note: "No automation handler exists for this task yet.",
  });
  state.lastFinishedAt = finishedAt;
  state.lastResult = "failed";
  state.lastMessage = `No handler for ${task.id}`;
}

async function reviveManualWaitingTasks(items) {
  let changed = false;
  const updatedAt = new Date().toISOString();
  const nextItems = items.map((item) => {
    if (!item || item.status === "done" || !item.agentRequest || item.agentRequest.status !== "waiting_codex") {
      return item;
    }
    const handlerId = item.handlerId ? String(item.handlerId) : "";
    if (handlerId === "gatherer-sidecar:funded-wallet-scan") {
      return item;
    }
    changed = true;
    return {
      ...item,
      agentRequest: {
        ...item.agentRequest,
        status: "queued",
        startedAt: null,
        finishedAt: null,
        queuedAt: item.agentRequest.queuedAt || updatedAt,
        runner: state.worker,
        note: "Queued for Codex/manual pickup.",
      },
    };
  });
  if (!changed) {
    return items;
  }
  await saveTodoItems(nextItems);
  state.lastFinishedAt = updatedAt;
  state.lastResult = "queued";
  state.lastMessage = "Revived queued manual tasks.";
  return nextItems;
}

async function processQueueOnce() {
  if (state.running || state.processing) return;
  state.processing = true;
  try {
    const payload = await loadTodoPayload();
    const items = await reviveManualWaitingTasks(Array.isArray(payload.items) ? payload.items : []);
    const queued = sortQueue(items.filter((item) => item && item.status !== "done" && item.agentRequest && item.agentRequest.status === "queued"));
    if (!queued.length) {
      state.lastMessage = "Idle";
      return;
    }
    const automatedQueued = queued.filter((item) => item && String(item.handlerId || "") === "gatherer-sidecar:funded-wallet-scan");
    if (!automatedQueued.length) {
      state.lastFinishedAt = new Date().toISOString();
      state.lastResult = "queued";
      state.lastMessage = "Manual queued tasks pending.";
      return;
    }
    await runGathererTask(automatedQueued[0], items);
  } catch (error) {
    state.lastMessage = formatError(error);
    state.lastResult = "failed";
  } finally {
    state.processing = false;
  }
}

setInterval(() => {
  processQueueOnce().catch(() => {});
}, POLL_MS);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/health") {
    sendJson(res, 200, { ok: true, port: PORT, state });
    return;
  }

  if (url.pathname === "/api/status") {
    sendJson(res, 200, { ok: true, port: PORT, state });
    return;
  }

  if (url.pathname === "/api/wake" && req.method === "POST") {
    processQueueOnce().catch(() => {});
    sendJson(res, 202, { ok: true, state });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Todo runner sidecar listening on http://${HOST}:${PORT}`);
});
