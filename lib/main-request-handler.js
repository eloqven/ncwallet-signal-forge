function createMainRequestHandler(deps) {
  const {
    host,
    port,
    root,
    sendJson,
    safeJoin,
    serveStaticPath,
    handleBinanceProxy,
    handleNcwalletHistory,
    handleNcwalletRange,
    handleDbSummary,
    handleDbExport,
    handleExportListRead,
    handleTodoRead,
    handleModelDeltaAuditRead,
    handleBugRead,
    handleTodoStore,
    handleBugStore,
    handleTodoQueue,
    handleSignalViewStore,
  } = deps;

  return async function mainRequestHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);

    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, service: "ncwallet-main", host, port });
      return;
    }

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

    if (url.pathname === "/api/local-db/exports" && req.method === "GET") {
      handleExportListRead(res);
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
    const filePath = safeJoin(root, pathname);
    if (!filePath) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    serveStaticPath(res, filePath);
  };
}

module.exports = { createMainRequestHandler };
