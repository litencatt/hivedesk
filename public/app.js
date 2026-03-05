let es = null;
let demoMode = false;
let lastData = null;
let starredPids = new Set(JSON.parse(localStorage.getItem("starredPids") || "[]"));
let editorSectionCollapsed = localStorage.getItem("editorSectionCollapsed") === "true";
let hiddenColumns = new Set(JSON.parse(localStorage.getItem("hiddenColumns") || "[]"));
let selectedKey = null;

const COL_DEFS = [
  { key: "star",       fixed: "22px", label: "",           stat: false },
  { key: "project",    fixed: null,   label: "Project",    stat: false },
  { key: "dir",        fixed: null,   label: "Dir",        stat: false },
  { key: "branch",     fixed: null,   label: "Branch",     stat: false },
  { key: "pr",         fixed: null,   label: "PR",         stat: false },
  { key: "containers", fixed: null,   label: "Containers", stat: false },
  { key: "cpu",        fixed: null,   label: "CPU",        stat: true  },
  { key: "mem",        fixed: null,   label: "MEM",        stat: true  },
  { key: "uptime",     fixed: null,   label: "Uptime",     stat: true  },
  { key: "icons",      fixed: null,   label: "",           stat: false },
];

const HIDDEN_COL_W = "14px";

function updateHiddenColStyles() {
  let styleEl = document.getElementById("col-hide-style");
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "col-hide-style";
    document.head.appendChild(styleEl);
  }
  const rules = [];
  COL_DEFS.forEach((c, i) => {
    if (hiddenColumns.has(c.key)) {
      const n = i + 1;
      rules.push(`.process-table td:nth-child(${n}) { width: 0 !important; max-width: 0 !important; min-width: 0 !important; padding: 0 !important; overflow: hidden; font-size: 0 !important; color: transparent !important; }`);
      rules.push(`.process-table td:nth-child(${n}) > * { display: none !important; }`);
    }
  });
  styleEl.textContent = rules.join("\n");
}

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
  if (diffMins === 0) return "< 1m";
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
  if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${String(s).padStart(2, "0")}s`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function orgRepo(projectDir, gitCommonDir) {
  const base = gitCommonDir
    ? gitCommonDir.replace(/\/\.git$/, "")
    : projectDir;
  if (!base) return "";
  const parts = base.replace(/\/$/, "").split("/");
  if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  return parts[parts.length - 1] ?? "";
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

// Merge duplicate processes sharing the same projectDir into one entry
function mergeByDir(procs) {
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
}

function cardHtml(proc, extraProcs = []) {
  const running = (proc.containers ?? []).filter(c => c.state === "running");
  const stopped = (proc.containers ?? []).filter(c => c.state !== "running");
  const containersHtml = proc.containers && proc.containers.length > 0
    ? `<div class="card-containers">🐳 <span class="containers-count">${running.length}/${proc.containers.length}</span> ${[
        ...running.map(c => `<span class="container-running">${escapeHtml(c.service)}</span>`),
        ...stopped.map(c => `<span class="container-stopped">${escapeHtml(c.service)}</span>`),
      ].join(" ")}</div>`
    : "";
  return `
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
      ${proc.prUrl ? `<a class="pr-link" href="${escapeHtml(proc.prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${proc.prTitle ? `#${escapeHtml(proc.prUrl.split("/").pop() ?? "")}: ${escapeHtml(proc.prTitle)}` : `#${escapeHtml(proc.prUrl.split("/").pop() ?? "")}`}</a>` : `<div class="project-dir">${escapeHtml(shortenPath(proc.projectDir))}</div>`}
      <div class="card-tags">
        ${proc.modelName ? `<div class="model-name">${escapeHtml(proc.modelName.replace("claude-", ""))}</div>` : ""}
        ${proc.claudeStatus ? `<div class="claude-status claude-status-${proc.claudeStatus}">${escapeHtml(proc.claudeStatus)}</div>` : ""}
      </div>
      ${proc.currentTask ? `<div class="current-task">${escapeHtml(proc.currentTask)}</div>` : ""}
      ${proc.openFiles && proc.openFiles.length > 0 ? `
      <div class="open-files">
        ${proc.openFiles.slice(0, 5).map(f => `<div class="open-file">${escapeHtml(f)}</div>`).join("")}
        ${proc.openFiles.length > 5 ? `<div class="open-file open-file-more">+${proc.openFiles.length - 5} more</div>` : ""}
      </div>` : ""}
      ${containersHtml}
      <div class="card-meta">
        <div class="meta-item${extraProcs.length > 0 ? " meta-pid-dup" : ""}">PID: <span>${[proc, ...extraProcs].map(p => p.pid).join(", ")}</span></div>
        <div class="meta-item">CPU: <span>${proc.cpuPercent.toFixed(1)}%</span></div>
        <div class="meta-item">MEM: <span>${proc.memPercent.toFixed(1)}%</span></div>
        <div class="meta-item">Uptime: <span>${formatElapsed(proc.elapsedSeconds)}</span></div>
      </div>
    </div>
  `;
}

function tableRowHtml(proc, extraProcs = []) {
  const running = (proc.containers ?? []).filter(c => c.state === "running");
  const stopped = (proc.containers ?? []).filter(c => c.state !== "running");
  const containersHtml = proc.containers && proc.containers.length > 0
    ? `🐳 <span class="containers-count">${running.length}/${proc.containers.length}</span> ${[
        ...running.map(c => `<span class="container-running">${escapeHtml(c.service)}</span>`),
        ...stopped.map(c => `<span class="container-stopped">${escapeHtml(c.service)}</span>`),
      ].join(" ")}`
    : "";
  return `
    <tr class="${proc.status}" data-pid="${proc.pid}" tabindex="0" role="button">
      <td class="tbl-star${starredPids.has(proc.pid) ? " starred" : ""}" data-star-pid="${proc.pid}">${starredPids.has(proc.pid) ? "★" : "☆"}</td>
      <td class="tbl-project">${escapeHtml(orgRepo(proc.projectDir, proc.gitCommonDir))}</td>
      <td class="tbl-dir">${escapeHtml(shortenPath(proc.projectDir))}</td>
      <td class="tbl-branch">${proc.gitBranch ? `<span class="tbl-branch-name"><img src="git-branch.svg" class="git-branch-icon" alt="branch"> ${escapeHtml(proc.gitBranch)}</span>` : ""}</td>
      <td class="tbl-pr">${proc.prUrl ? `<a class="pr-link" href="${escapeHtml(proc.prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${proc.prTitle ? `#${escapeHtml(proc.prUrl.split("/").pop() ?? "")}: ${escapeHtml(proc.prTitle)}` : `#${escapeHtml(proc.prUrl.split("/").pop() ?? "")}`}</a>` : ""}</td>
      <td class="tbl-containers">${containersHtml}</td>
      <td class="tbl-stat">${proc.cpuPercent.toFixed(1)}%</td>
      <td class="tbl-stat">${proc.memPercent.toFixed(1)}%</td>
      <td class="tbl-stat">${formatElapsed(proc.elapsedSeconds)}</td>
      <td class="tbl-icons">
        ${proc.claudeStatus ? `<span class="claude-status claude-status-${proc.claudeStatus}">${escapeHtml(proc.claudeStatus)}</span>` : ""}
        ${proc.editorApp ? `<img src="${proc.editorApp}.svg" class="editor-icon" alt="${proc.editorApp}">` : ""}
        <img src="claude.svg" class="claude-icon" alt="Claude">
        ${extraProcs.length > 0 ? `<span class="duplicate-badge">×${extraProcs.length + 1}</span>` : ""}
      </td>
    </tr>
  `;
}

function renderTable(data, grid) {
  const tableRows = mergeByDir([...data.processes])
    .sort((a, b) => {
      const aStarred = starredPids.has(a.primary.pid) ? 0 : 1;
      const bStarred = starredPids.has(b.primary.pid) ? 0 : 1;
      if (aStarred !== bStarred) return aStarred - bStarred;
      return orgRepo(a.primary.projectDir, a.primary.gitCommonDir)
        .localeCompare(orgRepo(b.primary.projectDir, b.primary.gitCommonDir));
    })
    .map(({ primary, extras }) => tableRowHtml(primary, extras)).join("");

  const editorRows = (data.editorWindows && data.editorWindows.length > 0)
    ? `<tr class="tbl-group-row tbl-editor-group tbl-editor-toggle" tabindex="0" role="button">
        <td colspan="10" class="tbl-group-cell">
          <span class="tbl-collapse-icon">${editorSectionCollapsed ? "▶" : "▼"}</span> 最近開いたプロジェクト
        </td>
       </tr>` +
      (editorSectionCollapsed ? "" : [...data.editorWindows]
        .sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? ""))
        .map(w => `
          <tr class="tbl-editor-row" data-dir="${escapeHtml(w.projectDir)}" data-app="${escapeHtml(w.app)}" tabindex="0" role="button">
            <td></td>
            <td class="tbl-project">${escapeHtml(orgRepo(w.projectDir, w.gitCommonDir))}</td>
            <td class="tbl-dir">${escapeHtml(shortenPath(w.projectDir))}</td>
            <td class="tbl-branch">${w.gitBranch ? `<span class="tbl-branch-name"><img src="git-branch.svg" class="git-branch-icon" alt="branch"> ${escapeHtml(w.gitBranch)}</span>` : ""}</td>
            <td class="tbl-pr">${w.prUrl ? `<a class="pr-link" href="${escapeHtml(w.prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${w.prTitle ? `#${escapeHtml(w.prUrl.split("/").pop() ?? "")}: ${escapeHtml(w.prTitle)}` : `#${escapeHtml(w.prUrl.split("/").pop() ?? "")}`}</a>` : ""}</td>
            <td class="tbl-containers"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-icons"><img src="${w.app}.svg" class="editor-icon" alt="${w.app}"></td>
          </tr>
        `).join(""))
    : "";

  const colgroupHtml = `<colgroup>${COL_DEFS.map(c => {
    const hidden = hiddenColumns.has(c.key);
    const w = hidden ? null : c.fixed;
    return `<col${w ? ` style="width:${w}"` : ""}>`;
  }).join("")}</colgroup>`;

  const theadHtml = `<thead><tr>${COL_DEFS.map(c => {
    const hidden = hiddenColumns.has(c.key);
    const cls = [c.stat && !hidden ? "tbl-stat" : "", hidden ? "col-toggled" : ""].filter(Boolean).join(" ");
    return `<th${cls ? ` class="${cls}"` : ""} data-col-toggle="${c.key}" title="${c.label || c.key}">${c.label}</th>`;
  }).join("")}</tr></thead>`;

  grid.innerHTML = `
    <table class="process-table">
      ${colgroupHtml}
      ${theadHtml}
      <tbody>${tableRows}${editorRows}</tbody>
    </table>
  `;

  updateHiddenColStyles();

  grid.querySelectorAll("th[data-col-toggle]").forEach(th => {
    th.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = th.dataset.colToggle;
      if (!key) return;
      if (hiddenColumns.has(key)) hiddenColumns.delete(key);
      else hiddenColumns.add(key);
      localStorage.setItem("hiddenColumns", JSON.stringify([...hiddenColumns]));
      if (lastData) render(lastData);
    });
  });

  grid.querySelectorAll(".tbl-star[data-star-pid]").forEach(cell => {
    const pid = parseInt(cell.dataset.starPid);
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (starredPids.has(pid)) starredPids.delete(pid);
      else starredPids.add(pid);
      localStorage.setItem("starredPids", JSON.stringify([...starredPids]));
      if (lastData) render(lastData);
    });
  });

  grid.querySelectorAll("tr[data-pid]").forEach(row => {
    const pid = parseInt(row.dataset.pid);
    row.addEventListener("click", () => { selectedKey = String(pid); applySelectedClass(grid); focusWindow(pid, row); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = String(pid); applySelectedClass(grid); focusWindow(pid, row); }
    });
  });

  const toggleRow = grid.querySelector(".tbl-editor-toggle");
  if (toggleRow) {
    const toggle = () => {
      editorSectionCollapsed = !editorSectionCollapsed;
      localStorage.setItem("editorSectionCollapsed", String(editorSectionCollapsed));
      if (lastData) render(lastData);
    };
    toggleRow.addEventListener("click", toggle);
    toggleRow.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") toggle();
    });
  }

  grid.querySelectorAll("tr[data-dir]").forEach(row => {
    const dir = row.dataset.dir;
    const app = row.dataset.app;
    row.addEventListener("click", () => { selectedKey = dir; applySelectedClass(grid); focusEditorWindow(dir, app, row); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = dir; applySelectedClass(grid); focusEditorWindow(dir, app, row); }
    });
  });

  applySelectedClass(grid);
}

function renderCards(data, grid) {
  const groupMap = new Map();
  for (const proc of data.processes) {
    const key = proc.gitCommonDir ?? proc.projectDir ?? String(proc.pid);
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key).push(proc);
  }
  const groups = [...groupMap.entries()]
    .map(([key, procs]) => {
      const keyBase = key.replace(/\/\.git$/, "");
      const parts = keyBase.split("/");
      const repoName = parts[parts.length - 1] ?? key;
      return {
        key,
        repoName,
        procs: procs.sort((a, b) => (a.projectName ?? "").localeCompare(b.projectName ?? "")),
      };
    })
    .sort((a, b) => a.repoName.localeCompare(b.repoName));

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
    card.addEventListener("click", () => { selectedKey = String(pid); applySelectedClass(grid); focusWindow(pid, card); });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = String(pid); applySelectedClass(grid); focusWindow(pid, card); }
    });
  });

  grid.querySelectorAll(".editor-card").forEach(card => {
    const dir = card.dataset.dir;
    const app = card.dataset.app;
    card.addEventListener("click", () => { selectedKey = dir; applySelectedClass(grid); focusEditorWindow(dir, app, card); });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = dir; applySelectedClass(grid); focusEditorWindow(dir, app, card); }
    });
  });

  applySelectedClass(grid);
}

function renderUsage(usage) {
  const usageEl = document.getElementById("usage-stats");
  if (!usageEl || !usage) return;
  const u = usage;
  const parts = [];
  if (u.totalInputTokens > 0 || u.totalOutputTokens > 0) {
    parts.push(`<span class="usage-tokens">↑${formatTokens(u.totalInputTokens)} ↓${formatTokens(u.totalOutputTokens)}</span>`);
  }
  if (u.fiveHourPercent !== null) {
    const t = formatTimeUntil(u.fiveHourResetsAt);
    const jst = t && t !== "now" ? formatJST(u.fiveHourResetsAt) : null;
    const cls = u.fiveHourPercent >= 90 ? "usage-critical" : u.fiveHourPercent >= 70 ? "usage-warning" : "";
    parts.push(`<span class="usage-limit usage-5h ${cls}">5h:${u.fiveHourPercent}%${t && t !== "now" ? ` (${t})` : ""}${jst ? ` reset ${jst}` : ""}</span>`);
  } else if (u.fiveHourTokens > 0) {
    parts.push(`<span class="usage-limit usage-5h">5h:${formatTokens(u.fiveHourTokens)}</span>`);
  }
  if (u.weeklyPercent !== null) {
    const t = formatTimeUntil(u.weeklyResetsAt);
    const cls = u.weeklyPercent >= 90 ? "usage-critical" : u.weeklyPercent >= 70 ? "usage-warning" : "";
    parts.push(`<span class="usage-limit usage-wk ${cls}">7d:${u.weeklyPercent}%${t ? ` (${t})` : ""}</span>`);
  } else if (u.weeklyTokens > 0) {
    parts.push(`<span class="usage-limit usage-wk">7d:${formatTokens(u.weeklyTokens)}</span>`);
  }
  if (u.authError === true) {
    parts.push(`<span class="usage-reauth" title="claude logout &amp;&amp; claude login">🔒 要再認証</span>`);
  }
  usageEl.innerHTML = parts.join("");
}

function render(rawData) {
  const data = demoMode ? demoify(rawData) : rawData;

  document.getElementById("stat-working").textContent = `${data.totalWorking} working`;
  document.getElementById("stat-idle").textContent = `${data.totalIdle} idle`;
  document.getElementById("last-updated").textContent =
    `Updated ${new Date(data.collectedAt).toLocaleTimeString()}`;
  renderUsage(data.usage);

  const grid = document.getElementById("process-grid");

  if (data.processes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No Claude processes found</div>';
    return;
  }

  if (viewMode === "list") {
    renderTable(data, grid);
  } else {
    renderCards(data, grid);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function applySelectedClass(grid) {
  grid.querySelectorAll(".item-selected").forEach(el => el.classList.remove("item-selected"));
  if (!selectedKey) return;
  const el = grid.querySelector(`[data-pid="${selectedKey}"]`) ||
             grid.querySelector(`[data-dir="${CSS.escape(selectedKey)}"]`);
  if (el) el.classList.add("item-selected");
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

let viewMode = localStorage.getItem("viewMode") || "grid";

function applyViewMode() {
  const grid = document.getElementById("process-grid");
  const btn = document.getElementById("view-toggle");
  if (viewMode === "list") {
    grid.classList.add("list");
    btn.classList.add("active");
    btn.textContent = "Card";
  } else {
    grid.classList.remove("list");
    btn.classList.remove("active");
    btn.textContent = "Table";
  }
}

connect();
applyViewMode();
updateHiddenColStyles();

document.getElementById("view-toggle").addEventListener("click", function () {
  viewMode = viewMode === "grid" ? "list" : "grid";
  localStorage.setItem("viewMode", viewMode);
  applyViewMode();
  if (lastData) render(lastData);
});

document.getElementById("demo-toggle").addEventListener("click", function () {
  demoMode = !demoMode;
  this.classList.toggle("active", demoMode);
  if (lastData) render(lastData);
});
