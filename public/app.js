let es = null;
let demoMode = false;
let homeDir = null;
let lastData = null;
let lastDataJson = null;
let starredPids = new Set(JSON.parse(localStorage.getItem("starredPids") || "[]"));
let starredDirs = new Set(JSON.parse(localStorage.getItem("starredDirs") || "[]"));
let editorSectionCollapsed = localStorage.getItem("editorSectionCollapsed") === "true";
let hiddenColumns = new Set(JSON.parse(localStorage.getItem("hiddenColumns") || "[]"));
let hiddenRows = new Set(JSON.parse(localStorage.getItem("hiddenRows") || "[]"));
let rowOrder = JSON.parse(localStorage.getItem("rowOrder") || "null");
const _savedSort = JSON.parse(localStorage.getItem("sortState") || "null");
let sortCol = _savedSort?.col ?? null;
let sortDir = _savedSort?.dir ?? "asc";
let selectedKey = null;

const COL_DEFS = [
  { key: "star",       fixed: "22px", label: "",           stat: false, sortable: false },
  { key: "project",    fixed: null,   label: "Project",    stat: false, sortable: true  },
  { key: "branch",     fixed: null,   label: "Branch",     stat: false, sortable: true  },
  { key: "pr",         fixed: null,   label: "PR",         stat: false, sortable: false },
  { key: "containers", fixed: "70px",  label: "Containers", stat: false, sortable: false },
  { key: "status",     fixed: "110px", label: "Status",     stat: false, sortable: false },
  { key: "cpu",        fixed: "64px",  label: "CPU",        stat: true,  sortable: true  },
  { key: "mem",        fixed: "64px",  label: "MEM",        stat: true,  sortable: true  },
  { key: "uptime",     fixed: "82px",  label: "Uptime",     stat: true,  sortable: true  },
  { key: "icons",      fixed: "52px",  label: "",           stat: false, sortable: false },
  { key: "actions",   fixed: "32px",  label: "",           stat: false, sortable: false },
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
      rules.push(`.process-table td:nth-child(${n}) { padding: 0 !important; overflow: hidden; }`);
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
const DEMO_CONTAINERS = ["api", "db", "redis", "worker"];
const DEMO_PR_BASE = 10000;
const DEMO_ORGS = ["demo-org", "my-company"];

function generateDemoData(collectedAt) {
  // Fully synthetic demo data — no real data used
  const processes = [
    { repo: "my-webapp",      org: "demo-org",   branch: "feat/search-feature",  pr: 0, containers: 2, cpu: 22.4, mem: 1.6, elapsed: 3600*7+59*60, status: "working", claudeStatus: "executing", model: "sonnet-4-6" },
    { repo: "api-service",    org: "demo-org",   branch: "chore/deps-update",    pr: 1, containers: 0, cpu: 0.3,  mem: 0.2, elapsed: 3600*7+0*60,  status: "idle",    claudeStatus: "waiting",   model: "sonnet-4-6" },
    { repo: "api-service",    org: "demo-org",   branch: "feat/user-auth",       pr: 2, containers: 0, cpu: 0.0,  mem: 0.5, elapsed: 3600*1+4*60,  status: "idle",    claudeStatus: null,        model: "sonnet-4-6" },
    { repo: "project-alpha",  org: "my-company", branch: "fix/payment-bug",      pr: 3, containers: 4, cpu: 0.4,  mem: 0.2, elapsed: 3600*7+49*60, status: "idle",    claudeStatus: "thinking",  model: "opus-4-6"   },
    { repo: "data-pipeline", org: "my-company", branch: "docs/api-update",      pr: 4, containers: 0, cpu: 0.0,  mem: 0.2, elapsed: 3600*5+13*60, status: "idle",    claudeStatus: null,        model: "sonnet-4-6" },
  ].map((d, i) => ({
    pid: 10000 + i * 111,
    projectName: d.repo,
    projectDir: `/Users/demo/projects/${d.repo}`,
    cpuPercent: d.cpu,
    memPercent: d.mem,
    status: d.status,
    claudeStatus: d.claudeStatus,
    stat: "S",
    elapsedTime: `${Math.floor(d.elapsed/3600)}:${String(Math.floor((d.elapsed%3600)/60)).padStart(2,"0")}:${String(d.elapsed%60).padStart(2,"0")}`,
    elapsedSeconds: d.elapsed,
    currentTask: DEMO_TASKS[i % DEMO_TASKS.length],
    openFiles: DEMO_FILES.slice(0, 3),
    gitBranch: d.branch,
    gitCommonDir: `/Users/demo/projects/${d.repo}/.git`,
    modelName: `claude-${d.model}`,
    prUrl: `https://github.com/${d.org}/${d.repo}/pull/${DEMO_PR_BASE + d.pr * 111}`,
    prTitle: DEMO_TASKS[d.pr % DEMO_TASKS.length],
    editorApp: i % 2 === 0 ? "vscode" : "cursor",
    isMcpBridge: false,
    containers: d.containers > 0
      ? DEMO_CONTAINERS.slice(0, d.containers).map(s => ({ service: s, name: `${s}-1`, state: "running", status: "Up 2 hours" }))
      : [],
  }));

  const editorWindows = [
    { repo: "frontend-app",  org: "demo-org",   branch: "feat/dashboard-v2", pr: true,  app: "vscode" },
    { repo: "data-pipeline", org: "my-company", branch: "refactor/db-layer", pr: false, app: "cursor" },
    { repo: "auth-service",  org: "demo-org",   branch: "fix/login-issue",   pr: true,  app: "vscode" },
  ].map((d, i) => ({
    app: d.app,
    projectDir: `/Users/demo/projects/${d.repo}`,
    projectName: d.repo,
    gitBranch: d.branch,
    gitCommonDir: `/Users/demo/projects/${d.repo}/.git`,
    prUrl: d.pr ? `https://github.com/${d.org}/${d.repo}/pull/${DEMO_PR_BASE + (i + 10) * 77}` : null,
    prTitle: d.pr ? DEMO_TASKS[(i + 2) % DEMO_TASKS.length] : null,
  }));

  return {
    processes,
    editorWindows,
    collectedAt: collectedAt || new Date().toISOString(),
    totalWorking: processes.filter(p => p.status === "working").length,
    totalIdle: processes.filter(p => p.status === "idle").length,
    usage: {
      totalInputTokens: 459000,
      totalOutputTokens: 6200,
      fiveHourTokens: 390000,
      weeklyTokens: 2900000,
      fiveHourPercent: 39,
      weeklyPercent: 29,
      fiveHourResetsAt: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
      weeklyResetsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(),
      authError: false,
    },
  };
}

function connect() {
  es = new EventSource("/events");

  es.addEventListener("processes", (e) => {
    if (e.data === lastDataJson) return;
    lastDataJson = e.data;
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
  if (homeDir && p.startsWith(homeDir + "/")) {
    return "~/" + p.slice(homeDir.length + 1);
  }
  // Fallback: strip /Users/<name>/ prefix
  const m = p.match(/^\/Users\/[^/]+\/(.+)$/);
  if (m) return "~/" + m[1];
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

function cellBranchHtml(gitBranch) {
  return gitBranch
    ? `<span class="tbl-branch-name"><img src="git-branch.svg" class="git-branch-icon" alt="branch"> ${escapeHtml(gitBranch)}</span>`
    : "";
}

function cellPrHtml(prUrl, prTitle) {
  if (!prUrl) return "";
  const num = escapeHtml(prUrl.split("/").pop() ?? "");
  const label = prTitle ? `#${num}: ${escapeHtml(prTitle)}` : `#${num}`;
  return `<a class="pr-link" href="${escapeHtml(prUrl)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${label}</a>`;
}

function persistAndRerender(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
  if (lastData) render(lastData);
}

function statusEmoji(proc) {
  if (proc.status === "working") {
    if (proc.claudeStatus === "thinking") return "💭";
    if (proc.claudeStatus === "tool_use") return "🔧";
    if (proc.claudeStatus === "executing") return "🚀";
    if (proc.claudeStatus === "waiting") return "⏳";
    return "🔵";
  }
  if (proc.claudeStatus === "thinking") return "💭";
  if (proc.claudeStatus === "tool_use") return "🔧";
  if (proc.claudeStatus === "executing") return "⚙️";
  if (proc.claudeStatus === "waiting") return "💤";
  return "⚪";
}

function tableRowHtml(proc, extraProcs = []) {
  const running = (proc.containers ?? []).filter(c => c.state === "running");
  const stopped = (proc.containers ?? []).filter(c => c.state !== "running");
  const containerTooltip = proc.containers && proc.containers.length > 0
    ? [...running.map(c => `▶ ${c.service}`), ...stopped.map(c => `■ ${c.service}`)].join("\n")
    : "";
  const containersSummary = proc.containers && proc.containers.length > 0 && running.length > 0
    ? `<span class="containers-summary">🐳 ${running.length}</span>`
    : `<span class="containers-summary"></span>`;
  const containersHtml = proc.containers && proc.containers.length > 0
    ? `${containersSummary}<span class="containers-full" title="${escapeHtml(containerTooltip)}">🐳 <span class="containers-count">${running.length}/${proc.containers.length}</span></span>`
    : "";
  const rowKey = escapeHtml(proc.projectDir ?? String(proc.pid));
  return `
    <tr class="${proc.status}" data-pid="${proc.pid}" data-row-key="${rowKey}"${proc.editorApp ? ` data-editor-app="${proc.editorApp}"` : ""} tabindex="0" role="button" draggable="true">
      <td class="tbl-star${starredPids.has(proc.pid) ? " starred" : ""}" data-star-pid="${proc.pid}">${starredPids.has(proc.pid) ? "★" : "☆"}</td>
      <td class="tbl-project"><div>${escapeHtml(orgRepo(proc.projectDir, proc.gitCommonDir))}</div><div class="tbl-project-dir">${escapeHtml(shortenPath(proc.projectDir))}</div></td>
      <td class="tbl-branch">${cellBranchHtml(proc.gitBranch)}</td>
      <td class="tbl-pr">${cellPrHtml(proc.prUrl, proc.prTitle)}</td>
      <td class="tbl-containers">${containersHtml}</td>
      <td class="tbl-status"><span class="status-summary" style="display:none">${statusEmoji(proc)}</span><span class="status-full">${proc.claudeStatus ? `<span class="claude-status claude-status-${proc.claudeStatus}">${escapeHtml(proc.claudeStatus)}</span>` : ""}</span></td>
      <td class="tbl-stat">${proc.cpuPercent.toFixed(1)}%</td>
      <td class="tbl-stat">${proc.memPercent.toFixed(1)}%</td>
      <td class="tbl-stat">${formatElapsed(proc.elapsedSeconds)}</td>
      <td class="tbl-icons">
        ${proc.editorApp ? `<img src="${proc.editorApp}.svg" class="editor-icon" alt="${proc.editorApp}">` : ""}
        <img src="claude.svg" class="claude-icon" alt="Claude">
        ${extraProcs.length > 0 ? `<span class="duplicate-badge">×${extraProcs.length + 1}</span>` : ""}
      </td>
      <td class="tbl-actions">
        <button class="row-delete-btn" data-delete-key="${rowKey}" title="非表示">×</button>
      </td>
    </tr>
  `;
}

function editorRowHtml(w) {
  return `
    <tr class="tbl-editor-row" data-dir="${escapeHtml(w.projectDir)}" data-app="${escapeHtml(w.app)}" data-row-key="${escapeHtml(w.projectDir)}" tabindex="0" role="button" draggable="true">
      <td class="tbl-star${starredDirs.has(w.projectDir) ? " starred" : ""}" data-star-dir="${escapeHtml(w.projectDir)}">${starredDirs.has(w.projectDir) ? "★" : "☆"}</td>
      <td class="tbl-project"><div>${escapeHtml(orgRepo(w.projectDir, w.gitCommonDir))}</div><div class="tbl-project-dir">${escapeHtml(shortenPath(w.projectDir))}</div></td>
      <td class="tbl-branch">${cellBranchHtml(w.gitBranch)}</td>
      <td class="tbl-pr">${cellPrHtml(w.prUrl, w.prTitle)}</td>
      <td class="tbl-containers"></td>
      <td class="tbl-status"></td>
      <td class="tbl-stat"></td>
      <td class="tbl-stat"></td>
      <td class="tbl-stat"></td>
      <td class="tbl-icons"><img src="${w.app}.svg" class="editor-icon" alt="${w.app}"></td>
      <td class="tbl-actions"><button class="row-delete-btn" data-delete-key="${escapeHtml(w.projectDir)}" title="非表示">×</button></td>
    </tr>
  `;
}

function renderTable(data, grid) {
  const mergedRows = mergeByDir([...data.processes]);
  const claudeDirs = new Set(data.processes.map(p => p.projectDir).filter(Boolean));

  const claudeVisible = [...mergedRows]
    .filter(({ primary }) => !hiddenRows.has(primary.projectDir ?? String(primary.pid)));
  const editorVisible = (data.editorWindows ?? [])
    .filter(w => !claudeDirs.has(w.projectDir) && !hiddenRows.has(w.projectDir));

  // 全行を統合してスター優先→ソート（rowOrderは全行のD&D順序に使用）
  const orderMap = rowOrder && rowOrder.length > 0
    ? new Map(rowOrder.map((k, i) => [k, i]))
    : null;

  const allItems = [
    ...claudeVisible.map(({ primary, extras }) => {
      const project = orgRepo(primary.projectDir, primary.gitCommonDir);
      return {
        starred: starredPids.has(primary.pid),
        name: project,
        order: orderMap ? (orderMap.get(primary.projectDir ?? String(primary.pid)) ?? Infinity) : Infinity,
        isEditor: false,
        html: tableRowHtml(primary, extras),
        sortValues: { project, branch: primary.gitBranch ?? null, cpu: primary.cpuPercent, mem: primary.memPercent, uptime: primary.elapsedSeconds },
      };
    }),
    ...editorVisible.map(w => {
      const project = orgRepo(w.projectDir, w.gitCommonDir);
      return {
        starred: starredDirs.has(w.projectDir),
        name: project,
        order: orderMap ? (orderMap.get(w.projectDir) ?? Infinity) : Infinity,
        isEditor: true,
        html: editorRowHtml(w),
        sortValues: { project, branch: w.gitBranch ?? null, cpu: null, mem: null, uptime: null },
      };
    }),
  ];

  const tableRows = allItems
    .sort((a, b) => {
      // スター付きを先頭に
      if (a.starred !== b.starred) return a.starred ? -1 : 1;
      // カラムソートが有効な場合
      if (sortCol) {
        const dir = sortDir === "desc" ? -1 : 1;
        const va = a.sortValues[sortCol];
        const vb = b.sortValues[sortCol];
        if (va !== vb) {
          if (va == null) return 1;
          if (vb == null) return -1;
          return (typeof va === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
        }
      } else {
        // D&Dカスタム順（全行に適用）
        if (a.order !== b.order) return a.order - b.order;
        // rowOrderにない場合: Claudeプロセス行を先に
        if (a.isEditor !== b.isEditor) return a.isEditor ? 1 : -1;
      }
      return a.name.localeCompare(b.name);
    })
    .map(item => item.html)
    .join("");

  // Recently Opened Projects: rows dismissed via × button
  const dismissedKeys = new Set();
  const dismissed = [];
  for (const { primary } of mergedRows) {
    const key = primary.projectDir ?? String(primary.pid);
    if (hiddenRows.has(key) && !dismissedKeys.has(key)) {
      dismissedKeys.add(key);
      dismissed.push({ key, projectDir: primary.projectDir, gitCommonDir: primary.gitCommonDir, gitBranch: primary.gitBranch, prUrl: primary.prUrl, prTitle: primary.prTitle, app: primary.editorApp });
    }
  }
  for (const w of (data.editorWindows ?? [])) {
    if (hiddenRows.has(w.projectDir) && !dismissedKeys.has(w.projectDir)) {
      dismissedKeys.add(w.projectDir);
      dismissed.push({ key: w.projectDir, projectDir: w.projectDir, gitCommonDir: w.gitCommonDir, gitBranch: w.gitBranch, prUrl: w.prUrl, prTitle: w.prTitle, app: w.app });
    }
  }

  const recentlyOpenedRows = dismissed.length > 0
    ? `<tr class="tbl-group-row tbl-editor-group tbl-editor-toggle" tabindex="0" role="button">
        <td colspan="11" class="tbl-group-cell">
          <span class="tbl-collapse-icon">${editorSectionCollapsed ? "▶" : "▼"}</span> Recently Opened Projects
        </td>
       </tr>` +
      (editorSectionCollapsed ? "" : dismissed
        .sort((a, b) => orgRepo(a.projectDir, a.gitCommonDir).localeCompare(orgRepo(b.projectDir, b.gitCommonDir)))
        .map(d => `
          <tr class="tbl-editor-row" data-dir="${escapeHtml(d.projectDir)}" data-app="${d.app ? escapeHtml(d.app) : ""}" tabindex="0" role="button">
            <td class="tbl-star${starredDirs.has(d.projectDir) ? " starred" : ""}" data-star-dir="${escapeHtml(d.projectDir)}">${starredDirs.has(d.projectDir) ? "★" : "☆"}</td>
            <td class="tbl-project"><div>${escapeHtml(orgRepo(d.projectDir, d.gitCommonDir))}</div><div class="tbl-project-dir">${escapeHtml(shortenPath(d.projectDir))}</div></td>
            <td class="tbl-branch">${cellBranchHtml(d.gitBranch)}</td>
            <td class="tbl-pr">${cellPrHtml(d.prUrl, d.prTitle)}</td>
            <td class="tbl-containers"></td>
            <td class="tbl-status"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-stat"></td>
            <td class="tbl-icons">${d.app ? `<img src="${escapeHtml(d.app)}.svg" class="editor-icon" alt="${escapeHtml(d.app)}">` : ""}</td>
            <td class="tbl-actions"><button class="row-restore-btn" data-restore-key="${escapeHtml(d.key)}" title="メインに戻す">↩</button></td>
          </tr>
        `).join(""))
    : "";

  const colgroupHtml = `<colgroup>${COL_DEFS.map(c => {
    const hidden = hiddenColumns.has(c.key);
    const w = hidden ? HIDDEN_COL_W : c.fixed;
    return `<col${w ? ` style="width:${w}"` : ""}>`;
  }).join("")}</colgroup>`;

  const theadHtml = `<thead><tr>${COL_DEFS.map(c => {
    const hidden = hiddenColumns.has(c.key);
    const cls = [c.stat && !hidden ? "tbl-stat" : "", hidden ? "col-toggled" : ""].filter(Boolean).join(" ");
    if (c.sortable) {
      const indicator = sortCol === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : "";
      return `<th${cls ? ` class="${cls}"` : ""} data-col-sort="${c.key}" title="${c.label}">${c.label}${indicator}${!hidden ? `<span class="col-hide-btn" data-hide-col="${c.key}" title="列を非表示">×</span>` : ""}</th>`;
    }
    return `<th${cls ? ` class="${cls}"` : ""} data-col-toggle="${c.key}" title="${c.label || c.key}">${c.label}${!hidden ? `<span class="col-hide-btn" title="列を非表示">×</span>` : ""}</th>`;
  }).join("")}</tr></thead>`;

  grid.innerHTML = `
    <table class="process-table">
      ${colgroupHtml}
      ${theadHtml}
      <tbody>${tableRows}${recentlyOpenedRows}</tbody>
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
      persistAndRerender("hiddenColumns", [...hiddenColumns]);
    });
  });

  grid.querySelectorAll("th[data-col-sort]").forEach(th => {
    th.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = th.dataset.colSort;
      if (!key) return;
      if (hiddenColumns.has(key)) {
        hiddenColumns.delete(key);
        persistAndRerender("hiddenColumns", [...hiddenColumns]);
        return;
      }
      if (e.shiftKey || e.target.classList.contains("col-hide-btn")) {
        e.stopPropagation();
        hiddenColumns.add(key);
        persistAndRerender("hiddenColumns", [...hiddenColumns]);
        return;
      }
      if (sortCol === key) {
        if (sortDir === "asc") {
          sortDir = "desc";
        } else {
          sortCol = null;
          sortDir = "asc";
        }
      } else {
        sortCol = key;
        sortDir = "asc";
      }
      persistAndRerender("sortState", { col: sortCol, dir: sortDir });
    });
  });

  grid.querySelectorAll(".tbl-star[data-star-pid]").forEach(cell => {
    const pid = parseInt(cell.dataset.starPid);
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (starredPids.has(pid)) starredPids.delete(pid);
      else starredPids.add(pid);
      persistAndRerender("starredPids", [...starredPids]);
    });
  });

  grid.querySelectorAll(".tbl-star[data-star-dir]").forEach(cell => {
    const dir = cell.dataset.starDir;
    cell.addEventListener("click", (e) => {
      e.stopPropagation();
      if (starredDirs.has(dir)) starredDirs.delete(dir);
      else starredDirs.add(dir);
      persistAndRerender("starredDirs", [...starredDirs]);
    });
  });

  grid.querySelectorAll("tr[data-pid]").forEach(row => {
    const pid = parseInt(row.dataset.pid);
    const hasEditor = !!row.dataset.editorApp;
    row.addEventListener("click", () => { selectedKey = String(pid); applySelectedClass(grid); if (hasEditor) openInVSCode(row.dataset.rowKey); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = String(pid); applySelectedClass(grid); if (hasEditor) openInVSCode(row.dataset.rowKey); }
    });
  });

  grid.querySelectorAll("tr[data-dir]").forEach(row => {
    const dir = row.dataset.dir;
    const app = row.dataset.app;
    row.addEventListener("click", () => { selectedKey = dir; applySelectedClass(grid); openInVSCode(dir); });
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { selectedKey = dir; applySelectedClass(grid); openInVSCode(dir); }
    });
  });

  grid.querySelectorAll(".row-delete-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.deleteKey;
      if (key) {
        hiddenRows.add(key);
        persistAndRerender("hiddenRows", [...hiddenRows]);
      }
    });
  });

  grid.querySelectorAll(".row-restore-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const key = btn.dataset.restoreKey;
      if (key) {
        hiddenRows.delete(key);
        persistAndRerender("hiddenRows", [...hiddenRows]);
      }
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

  setupDragAndDrop(grid);
  applySelectedClass(grid);
}

function setupDragAndDrop(grid) {
  const rows = [...grid.querySelectorAll("tr[data-row-key]")];
  let dragSrcKey = null;
  let lastIndicatorRow = null;

  const clearIndicators = () => {
    if (lastIndicatorRow) {
      lastIndicatorRow.classList.remove("drag-over-above", "drag-over-below");
      lastIndicatorRow = null;
    }
  };

  rows.forEach(row => {
    row.addEventListener("dragstart", (e) => {
      dragSrcKey = row.dataset.rowKey;
      e.dataTransfer.effectAllowed = "move";
      setTimeout(() => row.classList.add("dragging"), 0);
    });

    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      clearIndicators();
      dragSrcKey = null;
    });

    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      clearIndicators();
      const rect = row.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        row.classList.add("drag-over-above");
      } else {
        row.classList.add("drag-over-below");
      }
      lastIndicatorRow = row;
    });

    row.addEventListener("dragleave", () => clearIndicators());

    row.addEventListener("drop", (e) => {
      e.preventDefault();
      if (!dragSrcKey || dragSrcKey === row.dataset.rowKey) return;

      const targetKey = row.dataset.rowKey;
      const rect = row.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;

      const currentOrder = rows.map(r => r.dataset.rowKey);
      const srcIdx = currentOrder.indexOf(dragSrcKey);
      currentOrder.splice(srcIdx, 1);
      const newTgtIdx = currentOrder.indexOf(targetKey);
      currentOrder.splice(insertBefore ? newTgtIdx : newTgtIdx + 1, 0, dragSrcKey);

      rowOrder = currentOrder;
      localStorage.setItem("rowOrder", JSON.stringify(rowOrder));
      clearIndicators();
      if (lastData) render(lastData);
    });
  });
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
  if (u.oauthDisabled === true) {
    parts.push(`<span class="usage-oauth-disabled" title="BYAKUGAN_OAUTH_FETCH=false">OAuth off</span>`);
  }
  usageEl.innerHTML = parts.join("");
}

function updateFavicon(data) {
  const workingCount = (data?.processes ?? []).filter(p => p.status === "working").length;

  const badge = workingCount > 0
    ? `<circle cx="26" cy="6" r="6" fill="#22c55e" stroke="white" stroke-width="2"/>${workingCount > 1 ? `<text x="26" y="10" font-size="8" font-weight="bold" text-anchor="middle" fill="white">${workingCount}</text>` : ""}`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><defs><clipPath id="eye"><circle cx="16" cy="16" r="12.5"/></clipPath><radialGradient id="bg" cx="50%" cy="50%" r="70%"><stop offset="0%" stop-color="#f0e4d0"/><stop offset="100%" stop-color="#d8c4a8"/></radialGradient><radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="white" stop-opacity="0.8"/><stop offset="100%" stop-color="white" stop-opacity="0"/></radialGradient></defs><rect width="32" height="32" rx="7" fill="url(#bg)"/><circle cx="16" cy="16" r="14" fill="url(#glow)" opacity="0.5"/><circle cx="16" cy="16" r="13" fill="white" opacity="0.15"/><g stroke="white" stroke-linecap="square" fill="none" opacity="0.8" clip-path="url(#eye)"><polyline points="16,3 16,8 15,9 15,13" stroke-width="0.42"/><polyline points="14,4 14,7 13,8 13,11" stroke-width="0.28"/><polyline points="18,4 18,7 17,8" stroke-width="0.18"/><polyline points="20,4 20,8 19,9 19,13" stroke-width="0.42"/><polyline points="22,5 22,8 21,9 21,11" stroke-width="0.18"/><polyline points="23,7 23,9 22,10 22,12 21,13" stroke-width="0.28"/><polyline points="27,10 24,10 23,11 21,11 20,12 19,13" stroke-width="0.42"/><polyline points="29,13 26,13 25,14 23,14 21,15" stroke-width="0.28"/><polyline points="29,16 26,16 25,17 23,17 21,17" stroke-width="0.28"/><polyline points="28,12 26,12 25,13" stroke-width="0.18"/><polyline points="28,20 25,20 24,19 22,19 21,18 19,18" stroke-width="0.42"/><polyline points="26,23 24,23 23,22 21,22 20,21 19,20" stroke-width="0.28"/><polyline points="24,25 23,25 22,24 21,24" stroke-width="0.18"/><polyline points="20,28 20,25 19,24 19,21 18,20" stroke-width="0.42"/><polyline points="17,29 17,26 16,25 16,21" stroke-width="0.28"/><polyline points="15,28 15,25 14,24 14,21" stroke-width="0.28"/><polyline points="13,27 13,25 14,24" stroke-width="0.18"/><polyline points="10,28 10,25 11,24 11,22 12,21 13,21" stroke-width="0.42"/><polyline points="8,25 8,23 9,22 9,20 10,19 13,19" stroke-width="0.28"/><polyline points="7,22 7,21 8,20 9,20" stroke-width="0.18"/><polyline points="3,19 6,19 7,18 9,18 10,17 13,17" stroke-width="0.42"/><polyline points="3,16 6,16 7,15 9,15 11,15 13,16" stroke-width="0.28"/><polyline points="4,13 7,13 8,14 10,14 12,15" stroke-width="0.28"/><polyline points="5,11 7,11 8,12" stroke-width="0.18"/><polyline points="6,9 8,9 9,10 11,10 12,11 13,13" stroke-width="0.42"/><polyline points="7,7 9,7 10,8 11,8 12,10 13,12" stroke-width="0.28"/><polyline points="10,5 10,7 11,8" stroke-width="0.18"/><polyline points="12,4 12,7 13,8 14,8 14,12" stroke-width="0.28"/><circle cx="15" cy="9" r="0.35" fill="white"/><circle cx="19" cy="9" r="0.35" fill="white"/><circle cx="23" cy="14" r="0.35" fill="white"/><circle cx="23" cy="19" r="0.35" fill="white"/><circle cx="19" cy="24" r="0.35" fill="white"/><circle cx="13" cy="24" r="0.35" fill="white"/><circle cx="9" cy="19" r="0.35" fill="white"/><circle cx="9" cy="13" r="0.35" fill="white"/></g><circle cx="16" cy="16" r="13" fill="none" stroke="white" stroke-width="1"/><circle cx="16" cy="16" r="8" fill="none" stroke="rgba(200,185,165,0.6)" stroke-width="0.8"/><circle cx="16" cy="16" r="6.5" fill="none" stroke="rgba(210,195,175,0.5)" stroke-width="0.6"/><circle cx="16" cy="16" r="5.5" fill="white" opacity="0.95"/><circle cx="16" cy="16" r="5.5" fill="url(#glow)" opacity="0.3"/>${badge}</svg>`;

  const href = "data:image/svg+xml," + encodeURIComponent(svg);
  document.querySelectorAll('link[rel="icon"]').forEach(el => el.remove());
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/svg+xml";
  link.href = href;
  document.head.appendChild(link);
}

function render(rawData) {
  const data = demoMode ? generateDemoData(rawData?.collectedAt) : rawData;

  document.getElementById("stat-working").textContent = `${data.totalWorking} working`;
  document.getElementById("stat-idle").textContent = `${data.totalIdle} idle`;
  document.getElementById("last-updated").textContent =
    `Updated ${new Date(data.collectedAt).toLocaleTimeString()}`;
  renderUsage(data.usage);
  updateFavicon(data);

  const grid = document.getElementById("process-grid");

  if (data.processes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No Claude processes found</div>';
    return;
  }

  renderTable(data, grid);
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

function openInVSCode(worktreePath, newWindow) {
  fetch("/api/open-worktree", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: worktreePath, newWindow: newWindow ?? false }),
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

document.getElementById("process-grid").classList.add("list");

fetch("/api/config").then(r => r.json()).then(cfg => { homeDir = cfg.homeDir ?? null; }).catch(() => {}).finally(() => connect());
updateHiddenColStyles();

document.getElementById("demo-toggle").addEventListener("click", function () {
  demoMode = !demoMode;
  this.classList.toggle("active", demoMode);
  if (lastData) render(lastData);
});


// Theme toggle
(function () {
  const html = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const saved = localStorage.getItem("byakugan-theme");
  if (saved) html.dataset.theme = saved;

  function effectiveTheme() {
    return html.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }

  function syncIcon() {
    btn.textContent = effectiveTheme() === "dark" ? "◑" : "◐";
  }

  btn.addEventListener("click", function () {
    const next = effectiveTheme() === "dark" ? "light" : "dark";
    html.dataset.theme = next;
    localStorage.setItem("byakugan-theme", next);
    syncIcon();
  });

  syncIcon();
})();
