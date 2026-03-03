let es = null;

function connect() {
  es = new EventSource("/events");

  es.addEventListener("processes", (e) => {
    const data = JSON.parse(e.data);
    render(data);
  });

  es.addEventListener("reload", () => {
    window.location.reload();
  });

  es.onerror = () => {
    es.close();
    setTimeout(connect, 3000);
  };
}

function formatElapsed(seconds) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function shortenPath(p) {
  if (!p) return "";
  const home = "/Users/";
  if (p.startsWith(home)) {
    const rest = p.slice(home.length);
    const slash = rest.indexOf("/");
    if (slash !== -1) return "~/" + rest.slice(slash + 1);
  }
  return p;
}

function render(data) {
  document.getElementById("stat-working").textContent = `${data.totalWorking} working`;
  document.getElementById("stat-idle").textContent = `${data.totalIdle} idle`;

  const d = new Date(data.collectedAt);
  document.getElementById("last-updated").textContent =
    `Updated ${d.toLocaleTimeString()}`;

  const grid = document.getElementById("process-grid");

  if (data.processes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No Claude processes found</div>';
    return;
  }

  // Group by gitCommonDir, fallback to projectDir
  const groupMap = new Map();
  for (const proc of data.processes) {
    const key = proc.gitCommonDir ?? proc.projectDir ?? String(proc.pid);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(proc);
  }
  const groups = [...groupMap.entries()]
    .map(([key, procs]) => ({
      key,
      repoName: key.replace(/\/\.git$/, "").split("/").pop() ?? key,
      procs: procs.sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? "")),
    }))
    .sort((a, b) => a.repoName.localeCompare(b.repoName));

  const cardHtml = (proc) => `
    <div class="card ${proc.status}" data-pid="${proc.pid}" role="button" tabindex="0">
      <div class="card-header">
        <div class="project-name">${escapeHtml(proc.projectName)}</div>
        <div class="card-header-badges">
          <img src="claude.svg" class="claude-icon" alt="Claude">
          ${proc.editorApp ? `<div class="editor-badge ${proc.editorApp}"><img src="${proc.editorApp}.svg" class="editor-icon" alt="${proc.editorApp}"></div>` : ""}
          <div class="status-badge ${proc.status}">${proc.status}</div>
        </div>
      </div>
      <div class="project-dir">${escapeHtml(shortenPath(proc.projectDir))}</div>
      <div class="card-tags">
        ${proc.gitBranch ? `<div class="git-branch">⎇ ${escapeHtml(proc.gitBranch)}</div>` : ""}
        ${proc.modelName ? `<div class="model-name">${escapeHtml(proc.modelName.replace("claude-", ""))}</div>` : ""}
      </div>
      <div class="card-meta">
        <div class="meta-item">CPU: <span>${proc.cpuPercent.toFixed(1)}%</span></div>
        <div class="meta-item">MEM: <span>${proc.memPercent.toFixed(1)}%</span></div>
        <div class="meta-item">Uptime: <span>${formatElapsed(proc.elapsedSeconds)}</span></div>
        <div class="meta-item">STAT: <span>${escapeHtml(proc.stat)}</span></div>
      </div>
      ${proc.currentTask ? `<div class="current-task">${escapeHtml(proc.currentTask)}</div>` : ""}
      ${proc.openFiles && proc.openFiles.length > 0 ? `
      <div class="open-files">
        ${proc.openFiles.slice(0, 5).map(f => `<div class="open-file">${escapeHtml(f)}</div>`).join("")}
        ${proc.openFiles.length > 5 ? `<div class="open-file open-file-more">+${proc.openFiles.length - 5} more</div>` : ""}
      </div>` : ""}
      <div class="pid">PID ${proc.pid}</div>
    </div>
  `;

  const claudeHtml = groups.map(({ repoName, procs }) => {
    const isGroup = procs.length > 1;
    if (isGroup) {
      return `
        <div class="repo-group">
          <div class="repo-group-header">${escapeHtml(repoName)}</div>
          <div class="repo-group-cards">${procs.map(cardHtml).join("")}</div>
        </div>`;
    }
    return cardHtml(procs[0]);
  }).join("");

  const editorOnlyHtml = (data.editorWindows && data.editorWindows.length > 0)
    ? [...data.editorWindows]
        .sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? ""))
        .map(w => `
          <div class="card editor-card" data-dir="${escapeHtml(w.projectDir)}" data-app="${escapeHtml(w.app)}" role="button" tabindex="0">
            <div class="card-header">
              <div class="project-name">${escapeHtml(w.projectName)}</div>
              <div class="editor-badge ${w.app}"><img src="${w.app}.svg" class="editor-icon" alt="${w.app}"></div>
            </div>
            <div class="project-dir">${escapeHtml(shortenPath(w.projectDir))}</div>
          </div>
        `).join("")
    : "";

  grid.innerHTML = claudeHtml + editorOnlyHtml;

  grid.querySelectorAll(".card[data-pid]").forEach(card => {
    const pid = parseInt(card.dataset.pid);
    card.addEventListener("click", () => focusWindow(pid, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") focusWindow(pid, card);
    });
  });

  grid.querySelectorAll(".editor-card").forEach(card => {
    const dir = card.dataset.dir;
    const app = card.dataset.app;
    card.addEventListener("click", () => focusEditorWindow(dir, app, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") focusEditorWindow(dir, app, card);
    });
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function focusEditorWindow(dir, app, cardEl) {
  if (cardEl) {
    cardEl.style.opacity = "0.5";
    cardEl.style.transform = "scale(0.98)";
    setTimeout(() => {
      cardEl.style.opacity = "";
      cardEl.style.transform = "";
    }, 300);
  }
  fetch("/api/focus-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectDir: dir, app }),
  }).catch(() => {});
}

function focusWindow(pid, cardEl) {
  if (cardEl) {
    cardEl.style.opacity = "0.5";
    cardEl.style.transform = "scale(0.98)";
    setTimeout(() => {
      cardEl.style.opacity = "";
      cardEl.style.transform = "";
    }, 300);
  }
  fetch("/api/focus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid }),
  }).catch(() => {});
}

connect();
