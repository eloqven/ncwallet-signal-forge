(function () {
  var DEFAULT_DB_URL = "../data/surf-db.json";
  var RECENT_LIMIT = 8;

  var elements = {
    statusPanel: document.getElementById("statusPanel"),
    metaStamp: document.getElementById("metaStamp"),
    metricsGrid: document.getElementById("metricsGrid"),
    walletSyncMeta: document.getElementById("walletSyncMeta"),
    walletSyncSummary: document.getElementById("walletSyncSummary"),
    walletHoldingsBody: document.getElementById("walletHoldingsBody"),
    txMeta: document.getElementById("txMeta"),
    txAssetBars: document.getElementById("txAssetBars"),
    txRowsBody: document.getElementById("txRowsBody"),
    walletPageMeta: document.getElementById("walletPageMeta"),
    walletPageBody: document.getElementById("walletPageBody"),
    signalMeta: document.getElementById("signalMeta"),
    signalCoverage: document.getElementById("signalCoverage"),
    signalRowsBody: document.getElementById("signalRowsBody"),
    reloadButton: document.getElementById("reloadButton"),
    fileInput: document.getElementById("fileInput")
  };

  function safeArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatNumber(value, digits) {
    if (typeof value !== "number" || !isFinite(value)) {
      return "--";
    }
    return value.toLocaleString(undefined, {
      maximumFractionDigits: digits,
      minimumFractionDigits: digits
    });
  }

  function formatMaybeUsd(value) {
    if (typeof value !== "number" || !isFinite(value)) {
      return "--";
    }
    return "$" + formatNumber(value, value >= 100 ? 2 : 4);
  }

  function formatDateTime(value) {
    if (!value) {
      return "--";
    }
    var date = new Date(value);
    if (isNaN(date.getTime())) {
      return String(value);
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function statusClass(type) {
    if (type === "success") {
      return "status-panel status-success";
    }
    if (type === "error") {
      return "status-panel status-error";
    }
    return "status-panel status-neutral";
  }

  function setStatus(type, html) {
    elements.statusPanel.className = statusClass(type);
    elements.statusPanel.innerHTML = html;
  }

  function byTimeDesc(array, keys) {
    return safeArray(array).slice().sort(function (left, right) {
      var rightTime = resolveTime(right, keys);
      var leftTime = resolveTime(left, keys);
      return rightTime - leftTime;
    });
  }

  function resolveTime(item, keys) {
    for (var index = 0; index < keys.length; index += 1) {
      var raw = item && item[keys[index]];
      if (!raw) {
        continue;
      }
      var stamp = new Date(raw).getTime();
      if (!isNaN(stamp)) {
        return stamp;
      }
    }
    return 0;
  }

  function normalizeDb(raw) {
    var walletPageViews = safeArray(raw.walletPageViews && raw.walletPageViews.length ? raw.walletPageViews : raw.walletPageSnapshots);
    return {
      meta: raw && raw.meta ? raw.meta : {},
      signalViews: safeArray(raw && raw.signalViews),
      walletSyncs: safeArray(raw && raw.walletSyncs),
      walletPageViews: walletPageViews,
      walletHistoryRows: safeArray(raw && raw.walletHistoryRows)
    };
  }

  function latestOf(array, keys) {
    return byTimeDesc(array, keys)[0] || null;
  }

  function renderMetrics(db) {
    var latestSignal = latestOf(db.signalViews, ["savedAt", "capturedAt"]);
    var latestSync = latestOf(db.walletSyncs, ["savedAt", "syncedAt"]);
    var latestPage = latestOf(db.walletPageViews, ["savedAt", "syncedAt", "lastSeenAt"]);
    var latestTx = latestOf(db.walletHistoryRows, ["savedAt", "lastSeenAt", "syncedAt"]);
    var uniquePairs = {};
    var txAssets = {};
    var signalTimeframes = {};

    db.signalViews.forEach(function (item) {
      if (item && item.pairLabel) {
        uniquePairs[item.pairLabel] = true;
      }
      if (item && item.timeframe) {
        signalTimeframes[item.timeframe] = true;
      }
    });

    db.walletHistoryRows.forEach(function (item) {
      var symbol = item && (item.symbol || item.assetName || "Unknown");
      txAssets[symbol] = true;
    });

    var metrics = [
      { title: "Wallet syncs", value: db.walletSyncs.length, note: latestSync ? "Latest " + formatDateTime(latestSync.savedAt || latestSync.syncedAt) : "No sync records yet." },
      { title: "Cached tx rows", value: db.walletHistoryRows.length, note: latestTx ? "Latest " + formatDateTime(latestTx.savedAt || latestTx.lastSeenAt) : "No cached history yet." },
      { title: "Signal snapshots", value: db.signalViews.length, note: latestSignal ? "Latest " + formatDateTime(latestSignal.savedAt || latestSignal.capturedAt) : "No surf records yet." },
      { title: "Wallet page views", value: db.walletPageViews.length, note: latestPage ? "Latest " + formatDateTime(latestPage.savedAt || latestPage.lastSeenAt) : "No mirrored coin pages yet." },
      { title: "Tracked pairs", value: Object.keys(uniquePairs).length, note: Object.keys(signalTimeframes).length + " timeframes represented." },
      { title: "Tx assets", value: Object.keys(txAssets).length, note: "Distinct assets in cached history." }
    ];

    elements.metricsGrid.innerHTML = metrics.map(function (metric) {
      return (
        '<article class="metric-card">' +
          '<div class="metric-copy">' +
            "<h3>" + escapeHtml(metric.title) + "</h3>" +
            "<strong>" + escapeHtml(String(metric.value)) + "</strong>" +
            "<p>" + escapeHtml(metric.note) + "</p>" +
          "</div>" +
        "</article>"
      );
    }).join("");

    elements.metaStamp.textContent = "DB updated " + formatDateTime(db.meta.updatedAt || db.meta.createdAt);
  }

  function renderWalletSync(db) {
    var latest = latestOf(db.walletSyncs, ["savedAt", "syncedAt"]);
    if (!latest) {
      elements.walletSyncMeta.textContent = "No wallet sync loaded.";
      elements.walletSyncSummary.innerHTML = "";
      elements.walletHoldingsBody.innerHTML = '<tr><td colspan="4" class="empty-cell">No wallet data yet.</td></tr>';
      return;
    }

    elements.walletSyncMeta.textContent =
      "Saved " + formatDateTime(latest.savedAt || latest.syncedAt) +
      " | visible rows " + escapeHtml(String(latest.visibleCount || 0));

    var summaryCards = [
      { label: "Wallet total", value: formatMaybeUsd(latest.walletTotalUsd), note: "Scraped total balance snapshot." },
      { label: "Funded wallets", value: latest.fundedWalletCount || safeArray(latest.wallets).length || 0, note: "Wallets with funds at sync time." },
      { label: "Last transaction", value: latest.lastTransaction && latest.lastTransaction.amountText ? latest.lastTransaction.amountText : "--", note: latest.lastTransaction && latest.lastTransaction.datetimeLabel ? latest.lastTransaction.datetimeLabel : "No last transaction label." },
      { label: "Status mix", value: Object.keys(latest.statusCounts || {}).length || 0, note: Object.keys(latest.statusCounts || {}).join(", ") || "No statuses yet." }
    ];

    elements.walletSyncSummary.innerHTML = summaryCards.map(function (card) {
      return (
        '<article class="summary-card">' +
          "<p>" + escapeHtml(card.label) + "</p>" +
          "<strong>" + escapeHtml(String(card.value)) + "</strong>" +
          "<p>" + escapeHtml(card.note) + "</p>" +
        "</article>"
      );
    }).join("");

    var wallets = byTimeDesc(safeArray(latest.wallets), ["totalUsd"]).sort(function (left, right) {
      return (right.totalUsd || 0) - (left.totalUsd || 0);
    });

    elements.walletHoldingsBody.innerHTML = wallets.length ? wallets.map(function (wallet) {
      return (
        "<tr>" +
          "<td><strong>" + escapeHtml((wallet.assetName || wallet.symbol || "--") + (wallet.symbol ? " (" + wallet.symbol + ")" : "")) + "</strong></td>" +
          '<td class="mono">' + escapeHtml(wallet.balanceText || "--") + "</td>" +
          '<td class="mono">' + escapeHtml(wallet.totalUsdText || formatMaybeUsd(wallet.totalUsd)) + "</td>" +
          '<td class="' + changeClass(wallet.changeText) + ' mono">' + escapeHtml(wallet.changeText || "--") + "</td>" +
        "</tr>"
      );
    }).join("") : '<tr><td colspan="4" class="empty-cell">No wallets in latest sync.</td></tr>';
  }

  function changeClass(value) {
    var text = String(value || "");
    if (text.indexOf("-") !== -1) {
      return "bad";
    }
    if (text.indexOf("+") !== -1) {
      return "good";
    }
    return "";
  }

  function renderTxRows(db) {
    var rows = byTimeDesc(db.walletHistoryRows, ["datetimeIso", "savedAt", "lastSeenAt"]);
    elements.txMeta.textContent = rows.length ? rows.length + " cached rows." : "No rows loaded.";

    var countsByAsset = {};
    rows.forEach(function (row) {
      var key = row.symbol || row.assetName || "Unknown";
      countsByAsset[key] = (countsByAsset[key] || 0) + 1;
    });

    var assetBars = Object.keys(countsByAsset).sort(function (left, right) {
      return countsByAsset[right] - countsByAsset[left];
    }).slice(0, 6);

    var maxCount = assetBars.reduce(function (acc, key) {
      return Math.max(acc, countsByAsset[key]);
    }, 0);

    elements.txAssetBars.innerHTML = assetBars.length ? assetBars.map(function (key) {
      var count = countsByAsset[key];
      var width = maxCount ? Math.max(10, Math.round((count / maxCount) * 100)) : 0;
      return (
        '<div class="bar-row">' +
          '<div class="bar-label">' + escapeHtml(key) + "</div>" +
          '<div class="bar-track"><div class="bar-fill" style="width:' + width + '%"></div></div>' +
          '<div class="bar-label">' + escapeHtml(String(count)) + "</div>" +
        "</div>"
      );
    }).join("") : "";

    elements.txRowsBody.innerHTML = rows.length ? rows.slice(0, 12).map(function (row, index) {
      return (
        "<tr>" +
          "<td>" + escapeHtml(String(index + 1)) + "</td>" +
          "<td>" + escapeHtml(row.datetimeLabel || formatDateTime(row.datetimeIso)) + "</td>" +
          "<td>" + escapeHtml((row.assetName || "--") + (row.symbol ? " (" + row.symbol + ")" : "")) + "</td>" +
          '<td class="mono">' + escapeHtml(row.amountText || "--") + "</td>" +
          '<td class="' + (row.status === "Completed" ? "good" : "warn") + '">' + escapeHtml(row.status || "--") + "</td>" +
        "</tr>"
      );
    }).join("") : '<tr><td colspan="5" class="empty-cell">No cached transaction rows yet.</td></tr>';
  }

  function renderWalletPages(db) {
    var rows = byTimeDesc(db.walletPageViews, ["savedAt", "syncedAt", "lastSeenAt"]);
    elements.walletPageMeta.textContent = rows.length ? rows.length + " saved mirrored coin pages." : "No page snapshots loaded.";
    elements.walletPageBody.innerHTML = rows.length ? rows.slice(0, RECENT_LIMIT).map(function (row) {
      return (
        "<tr>" +
          "<td><strong>" + escapeHtml(row.symbol || row.titleLine || "--") + "</strong></td>" +
          "<td>" + escapeHtml(row.rangeLabel || "--") + "</td>" +
          '<td class="mono">' + escapeHtml(row.priceUsdText || "--") + "</td>" +
          '<td class="' + changeClass(row.changeText) + ' mono">' + escapeHtml(row.changeText || "--") + "</td>" +
          "<td>" + escapeHtml(formatDateTime(row.savedAt || row.lastSeenAt || row.syncedAt)) + "</td>" +
        "</tr>"
      );
    }).join("") : '<tr><td colspan="5" class="empty-cell">No wallet page snapshots yet.</td></tr>';
  }

  function renderSignals(db) {
    var rows = byTimeDesc(db.signalViews, ["savedAt", "capturedAt"]);
    elements.signalMeta.textContent = rows.length ? rows.length + " saved signal views." : "No signal snapshots loaded.";

    var coverage = {};
    rows.forEach(function (row) {
      var key = (row.timeframe || "--") + " day";
      coverage[key] = (coverage[key] || 0) + 1;
    });

    var coverageKeys = Object.keys(coverage).sort(function (left, right) {
      return coverage[right] - coverage[left];
    });

    elements.signalCoverage.innerHTML = coverageKeys.length ? coverageKeys.map(function (key) {
      return '<span class="chip"><strong>' + escapeHtml(String(coverage[key])) + "</strong> " + escapeHtml(key) + "</span>";
    }).join("") : '<span class="chip">No timeframe coverage yet.</span>';

    elements.signalRowsBody.innerHTML = rows.length ? rows.slice(0, 12).map(function (row) {
      var forecast = row.forecast && row.forecast.summary ? row.forecast.summary : "No forecast saved";
      return (
        "<tr>" +
          "<td><strong>" + escapeHtml(row.pairLabel || "--") + "</strong></td>" +
          "<td>" + escapeHtml((row.timeframe || "--") + " day") + "</td>" +
          "<td>" + escapeHtml((row.maMode || "--").toUpperCase()) + "</td>" +
          "<td>" + escapeHtml(forecast) + "</td>" +
          "<td>" + escapeHtml(formatDateTime(row.savedAt || row.capturedAt)) + "</td>" +
        "</tr>"
      );
    }).join("") : '<tr><td colspan="5" class="empty-cell">No signal snapshots yet.</td></tr>';
  }

  function renderDb(raw, sourceLabel) {
    var db = normalizeDb(raw || {});
    renderMetrics(db);
    renderWalletSync(db);
    renderTxRows(db);
    renderWalletPages(db);
    renderSignals(db);
    setStatus(
      "success",
      "Loaded <code>" + escapeHtml(sourceLabel) + "</code> with " +
      "<strong>" + escapeHtml(String(db.walletSyncs.length)) + "</strong> wallet syncs, " +
      "<strong>" + escapeHtml(String(db.walletHistoryRows.length)) + "</strong> cached tx rows, " +
      "<strong>" + escapeHtml(String(db.signalViews.length)) + "</strong> signal snapshots."
    );
  }

  async function loadFromUrl() {
    setStatus("neutral", "Loading <code>" + escapeHtml(DEFAULT_DB_URL) + "</code>...");
    try {
      var response = await fetch(DEFAULT_DB_URL + "?t=" + Date.now(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }
      var data = await response.json();
      renderDb(data, DEFAULT_DB_URL);
    } catch (error) {
      setStatus(
        "error",
        "Could not load <code>" + escapeHtml(DEFAULT_DB_URL) + "</code>. " +
        "If this page was opened from <code>file://</code>, serve the folder or use <strong>Open local JSON</strong>."
      );
    }
  }

  function readLocalFile(file) {
    if (!file) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function (event) {
      try {
        var raw = JSON.parse(String(event.target.result || "{}"));
        renderDb(raw, file.name);
      } catch (error) {
        setStatus("error", "Selected file is not valid JSON.");
      }
    };
    reader.onerror = function () {
      setStatus("error", "Could not read the selected file.");
    };
    reader.readAsText(file);
  }

  elements.reloadButton.addEventListener("click", loadFromUrl);
  elements.fileInput.addEventListener("change", function (event) {
    readLocalFile(event.target.files && event.target.files[0]);
  });

  loadFromUrl();
}());
