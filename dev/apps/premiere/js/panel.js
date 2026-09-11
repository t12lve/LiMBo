/* global CSInterface */
(function () {
  "use strict";

  var WS_URL = "ws://127.0.0.1:4567";
  var TOKEN_KEY = "limbo_premiere_token";
  var AUTO_KEY = "limbo_premiere_auto_import";
  var RECONNECT_MS = 2500;

  var cs = new CSInterface();
  var socket = null;
  var authenticated = false;
  var reconnectTimer = null;
  var jobs = {};
  var importedIds = {};

  var el = {
    statusDot: document.getElementById("status-dot"),
    statusText: document.getElementById("status-text"),
    autoImport: document.getElementById("auto-import"),
    jobsEmpty: document.getElementById("jobs-empty"),
    jobsList: document.getElementById("jobs-list"),
    log: document.getElementById("log"),
  };

  el.autoImport.checked = localStorage.getItem(AUTO_KEY) === "1";
  el.autoImport.addEventListener("change", function () {
    localStorage.setItem(AUTO_KEY, el.autoImport.checked ? "1" : "0");
  });

  function setStatus(online, text) {
    el.statusDot.className = "dot " + (online ? "on" : "off");
    el.statusText.textContent = text;
  }

  function log(msg) {
    el.log.textContent = msg || "";
  }

  function escJs(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n");
  }

  function phaseLabel(phase) {
    var map = {
      queued: "en file",
      fetching_meta: "métadonnées",
      downloading: "téléchargement",
      merging: "fusion",
      trimming: "trim",
      done: "terminé",
      error: "erreur",
    };
    return map[phase] || phase;
  }

  function modeBase(mode) {
    return String(mode || "combo").replace(/_trimmed$/, "");
  }

  function isActivePhase(phase) {
    return (
      phase === "queued" ||
      phase === "fetching_meta" ||
      phase === "downloading" ||
      phase === "merging" ||
      phase === "trimming"
    );
  }

  function upsertJob(job) {
    if (!job || !job.id) return;
    var prev = jobs[job.id] || {};
    jobs[job.id] = {
      id: job.id,
      url: job.url != null ? job.url : prev.url || "",
      title: job.title != null ? job.title : prev.title || "",
      phase: job.phase != null ? job.phase : prev.phase || "queued",
      percent: job.percent != null ? job.percent : prev.percent || 0,
      speed: job.speed != null ? job.speed : prev.speed || "",
      eta: job.eta != null ? job.eta : prev.eta || "",
      error: job.error,
      outputPath: job.outputPath != null ? job.outputPath : prev.outputPath,
      mode: job.mode != null ? job.mode : prev.mode,
    };
    renderJobs();
    var merged = jobs[job.id];
    if (
      merged.phase === "done" &&
      merged.outputPath &&
      el.autoImport.checked &&
      !importedIds[merged.id]
    ) {
      importJob(merged);
    }
  }

  function applyProgress(msg) {
    var prev = jobs[msg.id] || {
      id: msg.id,
      url: "",
      title: "",
      phase: "downloading",
      percent: 0,
      speed: "",
      eta: "",
    };
    upsertJob({
      id: msg.id,
      url: prev.url,
      title: prev.title,
      phase: msg.phase || prev.phase,
      percent: msg.percent,
      speed: msg.speed || "",
      eta: msg.eta || "",
      error: prev.error,
      outputPath: prev.outputPath,
      mode: prev.mode,
    });
  }

  function renderJobs() {
    var list = Object.keys(jobs)
      .map(function (id) {
        return jobs[id];
      })
      .sort(function (a, b) {
        var aActive = isActivePhase(a.phase) ? 0 : 1;
        var bActive = isActivePhase(b.phase) ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return (a.title || a.url || "").localeCompare(b.title || b.url || "");
      });

    el.jobsList.innerHTML = "";
    if (!list.length) {
      el.jobsEmpty.hidden = false;
      el.jobsList.hidden = true;
      return;
    }

    el.jobsEmpty.hidden = true;
    el.jobsList.hidden = false;

    list.forEach(function (job) {
      var li = document.createElement("li");
      li.className = "job";

      var title = document.createElement("div");
      title.className = "job-title";
      title.textContent = job.title || job.url || job.id;
      li.appendChild(title);

      var bar = document.createElement("div");
      bar.className = "job-bar";
      var fill = document.createElement("div");
      fill.className =
        "job-bar-fill" +
        (job.phase === "error" ? " err" : "") +
        (job.phase === "done" ? " done" : "");
      var pct = Math.min(100, Math.max(0, Number(job.percent) || 0));
      if (job.phase === "done") pct = 100;
      fill.style.width = pct + "%";
      bar.appendChild(fill);
      li.appendChild(bar);

      var meta = document.createElement("div");
      meta.className = "job-meta";
      var left = phaseLabel(job.phase);
      if (job.mode) left += " · " + modeBase(job.mode);
      if (job.error) left += " — " + job.error;
      if (importedIds[job.id]) left += " · importé";

      var rightParts = [];
      rightParts.push(Math.round(pct) + "%");
      if (job.speed) rightParts.push(job.speed);
      if (job.eta) rightParts.push("ETA " + job.eta);

      var row = document.createElement("div");
      row.className = "job-meta-row";
      var leftEl = document.createElement("span");
      leftEl.className = "job-meta-left";
      leftEl.textContent = left;
      var rightEl = document.createElement("span");
      rightEl.className = "job-meta-right";
      rightEl.textContent = rightParts.join(" · ");
      row.appendChild(leftEl);
      row.appendChild(rightEl);
      li.appendChild(row);

      if (job.phase === "done" && job.outputPath) {
        var actions = document.createElement("div");
        actions.className = "job-actions";
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "primary";
        btn.textContent = importedIds[job.id] ? "Réimporter" : "Importer";
        btn.addEventListener("click", function () {
          importJob(job);
        });
        actions.appendChild(btn);
        li.appendChild(actions);
      }

      el.jobsList.appendChild(li);
    });
  }

  function importJob(job) {
    if (!job || !job.outputPath) {
      log("Pas de fichier à importer.");
      return;
    }
    var mode = job.mode || "combo";
    var script =
      'limboImport("' + escJs(job.outputPath) + '","' + escJs(mode) + '")';
    log("Import…");
    cs.evalScript(script, function (raw) {
      var result;
      try {
        result = JSON.parse(raw);
      } catch (e) {
        result = { ok: false, error: String(raw || e) };
      }
      if (result && result.ok) {
        importedIds[job.id] = true;
        var note = result.createdSequence
          ? "Importé + séquence créée · "
          : "Importé · ";
        log(note + (job.title || job.outputPath));
        renderJobs();
      } else {
        log("Import échoué · " + ((result && result.error) || "inconnu"));
      }
    });
  }

  function send(obj) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(obj));
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function () {
      reconnectTimer = null;
      connect();
    }, RECONNECT_MS);
  }

  function connect() {
    if (
      socket &&
      (socket.readyState === WebSocket.OPEN ||
        socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    authenticated = false;
    setStatus(false, "Connexion au Desktop…");

    var ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      setStatus(false, "LiMBo Desktop hors ligne — lance l’app");
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = function () {
      send({ type: "hello" });
    };

    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (!msg || !msg.type) return;

      if (msg.type === "hello.ok") {
        var token = msg.token || localStorage.getItem(TOKEN_KEY) || "";
        if (msg.token) localStorage.setItem(TOKEN_KEY, msg.token);
        send({ type: "auth", token: token });
        return;
      }

      if (msg.type === "auth.ok") {
        authenticated = true;
        setStatus(true, "Desktop connecté");
        log("");
        return;
      }

      if (msg.type === "auth.fail") {
        authenticated = false;
        localStorage.removeItem(TOKEN_KEY);
        setStatus(false, "Auth refusée — redémarre LiMBo Desktop");
        log("Connexion refusée. Redémarre l’app LiMBo Desktop, puis réessaie.");
        try {
          ws.close();
        } catch (e) {}
        return;
      }

      if (msg.type === "jobs.snapshot" && Array.isArray(msg.jobs)) {
        jobs = {};
        msg.jobs.forEach(upsertJob);
        return;
      }

      if (msg.type === "job.progress") {
        applyProgress(msg);
        return;
      }

      if (
        (msg.type === "job.created" ||
          msg.type === "job.done" ||
          msg.type === "job.error") &&
        msg.job
      ) {
        upsertJob(msg.job);
      }
    };

    ws.onclose = function () {
      if (socket === ws) socket = null;
      authenticated = false;
      setStatus(false, "LiMBo Desktop hors ligne — lance l’app");
      scheduleReconnect();
    };

    ws.onerror = function () {
      setStatus(false, "LiMBo Desktop hors ligne — lance l’app");
    };
  }

  connect();
})();
