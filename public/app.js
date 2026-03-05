let es = null;
let demoMode = false;
let lastData = null;

const DEMO_REPOS = ["project-alpha", "my-webapp", "api-service", "data-pipeline", "frontend-app", "auth-service"];
const DEMO_BRANCHES = ["feat/user-auth", "fix/payment-bug", "docs/api-update", "refactor/db-layer", "feat/search-feature", "fix/login-issue", "feat/dashboard-v2", "chore/deps-update"];
const DEMO_TASKS = [
  "Implementing user authentication flow",
  "Writing unit tests for payment module",
  "Fixing database connection timeout",
  "Refactoring API response layer",
  null,
];
const DEMO_FILES = ["src/index.ts", "src/auth/handler.ts", "tests/payment.test.ts", "README.md", "src/utils/logger.ts"];
const DEMO_CONTAINERS = ["api", "db", "redis", "worker", "nginx", "cache", "queue"];
const DEMO_PR_BASE = 10000;

function demoify(data) {
  const processes = data.processes.map((proc, i) => {
    const repo = DEMO_REPOS[i % DEMO_REPOS.length];
    const gcDir = proc.gitCommonDir
      ? `/Users/demo/projects/${DEMO_REPOS[Math.floor(i / 3) % DEMO_REPOS.length]}/.git`
      : null;
    const demoContainers = proc.containers.slice(0, proc.containers.length).map((c, j) => ({
      ...c,
      service: DEMO_CONTAINERS[j % DEMO_CONTAINERS.length],
      name: `${DEMO_CONTAINERS[j % DEMO_CONTAINERS.length]}-1`,
    }));
    return {
      ...proc,
      projectName: repo,
      projectDir: `/Users/demo/projects/${gcDir ? DEMO_REPOS[Math.floor(i / 2) % DEMO_REPOS.length] : repo}`,
      gitBranch: proc.gitBranch ? DEMO_BRANCHES[i % DEMO_BRANCHES.length] : null,
      gitCommonDir: gcDir,
      prUrl: proc.prUrl ? `https://github.com/demo-org/${repo}/pull/${DEMO_PR_BASE + i * 111}` : null,
      prTitle: proc.prUrl ? DEMO_TASKS[i % DEMO_TASKS.length] : null,
      currentTask: proc.currentTask ? DEMO_TASKS[i % DEMO_TASKS.length] : null,
      openFiles: proc.openFiles.map((_, j) => DEMO_FILES[j % DEMO_FILES.length]),
      modelName: proc.modelName,
      containers: demoContainers,
    };
  });

  const editorWindows = data.editorWindows.map((w, i) => {
    const repo = DEMO_REPOS[(i + 3) % DEMO_REPOS.length];
    return { ...w, projectName: repo, projectDir: `/Users/demo/projects/${repo}` };
  });

  return { ...data, processes, editorWindows };
}

function connect() {
  es = new EventSource("/events");

  es.addEventListener("processes", (e) => {
    lastData = JSON.parse(e.data);
    render(lastData);
  });

  es.addEventListener("reload", () => {
    window.location.reload();
  });

  es.onerror = () => {
    es.close();
    setTimeout(connect, 3000);
  };
}

function formatTimeUntil(isoString) {
  if (!isoString) return null;
  const diffMs = new Date(isoString).getTime() - Date.now();
  if (diffMs <= 0) return "now";
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;
  const h = Math.floor(diffMins / 60);
  const m = diffMins % 60;
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return rh > 0 ? `${d}d${rh}h` : `${d}d`;
  }
  return m > 0 ? `${h}h${m}m` : `${h}h`;
}

function formatJST(isoString) {
  if (!isoString) return null;
  return new Date(isoString).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatTokens(n) {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(0)}k`;
  return String(n);
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

function render(rawData) {
  const data = demoMode ? demoify(rawData) : rawData;
  document.getElementById("stat-working").textContent = `${data.totalWorking} working`;
  document.getElementById("stat-idle").textContent = `${data.totalIdle} idle`;

  const d = new Date(data.collectedAt);
  document.getElementById("last-updated").textContent =
    `Updated ${d.toLocaleTimeString()}`;

  const usageEl = document.getElementById("usage-stats");
  if (usageEl && data.usage) {
    const u = data.usage;
    const parts = [];
    if (u.totalInputTokens > 0 || u.totalOutputTokens > 0) {
      parts.push(`<span class="usage-tokens">↑${formatTokens(u.totalInputTokens)} ↓${formatTokens(u.totalOutputTokens)}</span>`);
    }
    if (u.fiveHourPercent !== null) {
      const t = formatTimeUntil(u.fiveHourResetsAt);
      const jst = formatJST(u.fiveHourResetsAt);
      const cls = u.fiveHourPercent >= 90 ? "usage-critical" : u.fiveHourPercent >= 70 ? "usage-warning" : "";
      parts.push(`<span class="usage-limit usage-5h ${cls}">5h:${u.fiveHourPercent}%${t ? ` (${t})` : ""}${jst ? ` reset ${jst}` : ""}</span>`);
    }
    if (u.weeklyPercent !== null) {
      const t = formatTimeUntil(u.weeklyResetsAt);
      const cls = u.weeklyPercent >= 90 ? "usage-critical" : u.weeklyPercent >= 70 ? "usage-warning" : "";
      parts.push(`<span class="usage-limit usage-wk ${cls}">7d:${u.weeklyPercent}%${t ? ` (${t})` : ""}</span>`);
    }
    if (u.authError === true) {
      parts.push(`<span class="usage-reauth" title="claude logout &amp;&amp; claude login">🔒 要再認証</span>`);
    }
    usageEl.innerHTML = parts.join("");
  }

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

  const cardHtml = (proc, extraProcs = []) => `
    <div class="card ${proc.status}" data-pid="${proc.pid}" role="button" tabindex="0">
      <div class="card-header">
        <div class="card-header-left">
          <div class="project-repo-name">${escapeHtml(proc.projectName)}</div>
          <div class="project-name-row">
            ${proc.gitBranch ? `<img src="git-branch.svg" class="git-branch-icon" alt="branch">` : ""}
            <div class="project-name">${escapeHtml(proc.gitBranch ?? proc.projectName)}</div>
          </div>
        </div>
        <div class="card-header-icons">
          ${proc.editorApp ? `<div class="editor-badge ${proc.editorApp}"><img src="${proc.editorApp}.svg" class="editor-icon" alt="${proc.editorApp}"></div>` : ""}
          <img src="claude.svg" class="claude-icon" alt="Claude">
          ${extraProcs.length > 0 ? `<span class="duplicate-badge">×${extraProcs.length + 1}</span>` : ""}
        </div>
      </div>
      ${proc.prUrl ? `<a class="pr-link" href="${escapeHtml(proc.prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">PR#${escapeHtml(proc.prUrl.split("/").pop() ?? "")}${proc.prTitle ? ` ${escapeHtml(proc.prTitle)}` : ""}</a>` : `<div class="project-dir">${escapeHtml(shortenPath(proc.projectDir))}</div>`}
      ${proc.modelName ? `<div class="card-tags"><div class="model-name">${escapeHtml(proc.modelName.replace("claude-", ""))}</div></div>` : ""}
      ${proc.currentTask ? `<div class="current-task">${escapeHtml(proc.currentTask)}</div>` : ""}
      ${proc.openFiles && proc.openFiles.length > 0 ? `
      <div class="open-files">
        ${proc.openFiles.slice(0, 5).map(f => `<div class="open-file">${escapeHtml(f)}</div>`).join("")}
        ${proc.openFiles.length > 5 ? `<div class="open-file open-file-more">+${proc.openFiles.length - 5} more</div>` : ""}
      </div>` : ""}
      ${proc.containers && proc.containers.length > 0 ? (() => {
        const running = proc.containers.filter(c => c.state === "running");
        const stopped = proc.containers.filter(c => c.state !== "running");
        const names = [
          ...running.map(c => `<span class="container-running">${escapeHtml(c.service)}</span>`),
          ...stopped.map(c => `<span class="container-stopped">${escapeHtml(c.service)}</span>`),
        ].join(" ");
        return `<div class="card-containers">🐳 <span class="containers-count">${running.length}/${proc.containers.length}</span> ${names}</div>`;
      })() : ""}
      <div class="card-meta">
        <div class="meta-item${extraProcs.length > 0 ? " meta-pid-dup" : ""}">PID: <span>${[proc, ...extraProcs].map(p => p.pid).join(", ")}</span></div>
        <div class="meta-item">CPU: <span>${proc.cpuPercent.toFixed(1)}%</span></div>
        <div class="meta-item">MEM: <span>${proc.memPercent.toFixed(1)}%</span></div>
        <div class="meta-item">Uptime: <span>${formatElapsed(proc.elapsedSeconds)}</span></div>
      </div>
    </div>
  `;

  // Merge duplicate processes sharing the same projectDir into one card
  const mergeByDir = (procs) => {
    const byDir = new Map();
    for (const proc of procs) {
      const key = proc.projectDir ?? String(proc.pid);
      if (!byDir.has(key)) byDir.set(key, []);
      byDir.get(key).push(proc);
    }
    return [...byDir.values()].map(dirProcs => {
      if (dirProcs.length === 1) return { primary: dirProcs[0], extras: [] };
      const sorted = [...dirProcs].sort((a, b) => {
        if (a.status === "working" && b.status !== "working") return -1;
        if (b.status === "working" && a.status !== "working") return 1;
        return b.pid - a.pid;
      });
      return { primary: sorted[0], extras: sorted.slice(1) };
    });
  };

  const singles = groups.filter(g => g.procs.length === 1);
  const multiGroups = groups
    .filter(g => g.procs.length > 1)
    .sort((a, b) => b.procs.length - a.procs.length);

  const claudeHtml = [
    ...multiGroups.map(({ repoName, procs }) => `
      <div class="repo-group">
        <div class="repo-group-header">${escapeHtml(repoName)}</div>
        <div class="repo-group-cards">${mergeByDir(procs).map(({ primary, extras }) => cardHtml(primary, extras)).join("")}</div>
      </div>`),
    ...singles.map(({ procs }) => cardHtml(procs[0])),
  ].join("");

  const editorOnlyHtml = (data.editorWindows && data.editorWindows.length > 0)
    ? `<div class="repo-group">
        <div class="repo-group-header editor-only-header">最近開いたプロジェクト</div>
        <div class="repo-group-cards">
          ${[...data.editorWindows]
            .sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? ""))
            .map(w => `
              <div class="card editor-card" data-dir="${escapeHtml(w.projectDir)}" data-app="${escapeHtml(w.app)}" role="button" tabindex="0">
                <div class="card-header">
                  <div class="project-name">${escapeHtml(w.projectName)}</div>
                  <div class="card-header-icons">
                    <div class="editor-badge ${w.app}"><img src="${w.app}.svg" class="editor-icon" alt="${w.app}"></div>
                  </div>
                </div>
                <div class="project-dir">${escapeHtml(shortenPath(w.projectDir))}</div>
              </div>
            `).join("")}
        </div>
      </div>`
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

function applyFocusAnimation(cardEl) {
  if (cardEl) {
    cardEl.style.opacity = "0.5";
    cardEl.style.transform = "scale(0.98)";
    setTimeout(() => {
      cardEl.style.opacity = "";
      cardEl.style.transform = "";
    }, 100);
  }
}

function focusEditorWindow(dir, app, cardEl) {
  applyFocusAnimation(cardEl);
  fetch("/api/focus-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectDir: dir, app }),
  }).catch(() => {});
}

function focusWindow(pid, cardEl) {
  applyFocusAnimation(cardEl);
  fetch("/api/focus", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pid }),
  }).catch(() => {});
}

connect();

document.getElementById("demo-toggle").addEventListener("click", function () {
  demoMode = !demoMode;
  this.classList.toggle("active", demoMode);
  if (lastData) render(lastData);
});
