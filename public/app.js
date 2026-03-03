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

  grid.innerHTML = data.processes.map(proc => `
    <div class="card ${proc.status}" data-pid="${proc.pid}" role="button" tabindex="0">
      <div class="card-header">
        <div class="project-name">${escapeHtml(proc.projectName)}</div>
        <div class="status-badge ${proc.status}">${proc.status}</div>
      </div>
      <div class="project-dir">${escapeHtml(shortenPath(proc.projectDir))}</div>
      ${proc.gitBranch ? `<div class="git-branch">⎇ ${escapeHtml(proc.gitBranch)}</div>` : ""}
      <div class="card-meta">
        <div class="meta-item">CPU: <span>${proc.cpuPercent.toFixed(1)}%</span></div>
        <div class="meta-item">MEM: <span>${proc.memPercent.toFixed(1)}%</span></div>
        <div class="meta-item">Uptime: <span>${formatElapsed(proc.elapsedSeconds)}</span></div>
        <div class="meta-item">STAT: <span>${escapeHtml(proc.stat)}</span></div>
      </div>
      ${proc.currentTask ? `<div class="current-task">${escapeHtml(proc.currentTask)}</div>` : ""}
      <div class="pid">PID ${proc.pid}</div>
    </div>
  `).join("");

  grid.querySelectorAll(".card").forEach(card => {
    const pid = parseInt(card.dataset.pid);
    card.addEventListener("click", () => focusWindow(pid, card));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") focusWindow(pid, card);
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
