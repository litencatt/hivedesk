<div align="center"><img src="docs/byakugan.png" alt="byakugan" width="120"></div>

# byakugan

> Real-time dashboard for Claude Code agents — monitor status, token usage, git branches, PRs, and containers

Like the Byakugan — the Hyūga clan's kekkei genkai — byakugan sees through your entire development environment from a single screen.

While active, it monitors all running Claude Code processes in near-360° real-time vision.
From chakra flow (token usage) to each process's inner state (thinking / executing / waiting),
to intelligence from kilometers away (multiple repos, branches, PRs) — all gathered on one screen.
Even tenketsu (Docker container status) never escapes its sight.

Click any row or card to instantly jump to the corresponding VSCode / Cursor window.
**macOS only.**

[日本語版 README はこちら](./README.ja.md)

## Target

- Developers working with **multiple displays**
- Developers who use **VSCode or Cursor** as their primary IDE, with **multiple instances open simultaneously**, each running a Claude Code agent in its own terminal

## Screenshots

**Real usage** — multiple worktrees of the same repository grouped together:

![byakugan screenshot](./docs/screenshot.png)

**Demo mode** — all sensitive info replaced with dummy data (toggle with the Demo button):

![byakugan demo](./docs/demo.png)

## Features

### Table view (default)
Each Claude Code process appears as a sortable row with:
- **Project** + **Dir** + **Branch** + **PR** columns
- **Status**: live Claude state — `thinking` / `tool_use` / `executing` / `waiting`
- **Docker containers** status (`🐳 3/4 api db redis`)
- **CPU / MEM / Uptime** stats
- **Column show/hide**: click any column header to toggle visibility (persisted)
- **Star**: pin important processes to the top
- **Recently opened projects**: editor windows without an active Claude process, collapsible

### Card view
Each Claude Code process appears as a card showing:
- **Repository name** + **git branch** (main title)
- **PR title** + **PR link** with PR number (e.g. `#1234: Fix authentication bug`)
- **Docker containers** status
- **Editor icon** (VSCode / Cursor) in top-right corner
- **Working/idle status** via green border highlight

### Header
- **Token usage**: 5-hour and weekly Claude API usage (e.g. `5h:32% (2h5m)[reset:02:00] wk:35%(2d13h)`)
- **Working/idle counts**: Live count of active and idle agents
- **Demo mode**: Replace all project info with dummy data for screenshots
- **View toggle**: Switch between Table and Card layout

### Other
- **One-click IDE focus**: Click any row or card to instantly activate the corresponding VSCode / Cursor window
- **Selection highlight**: Last clicked row/card retains highlight until another is selected
- **Dark / light theme**: Follows system preference
- **SSE-based live updates**: Refreshes every 2 seconds
- **PR info caching**: `gh pr view` is only called when `FETCH_HEAD` changes (on push/pull/fetch)
- **Hot reload**: Auto-reloads the UI when files in `public/` change during development

## Prerequisites

- **macOS** (uses `ps`, `lsof`, `osascript`)
- **Node.js 18+**
- **GitHub CLI** (`gh`) — for PR link detection
- **Git** — for branch info

## Installation

```bash
git clone https://github.com/litencatt/byakugan.git
cd byakugan
npm install
```

## Usage

### Development mode (auto-reload on file change)

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

To use a custom port:

```bash
PORT=8080 npm run dev
```

### Production mode

```bash
npm run build
npm start
```

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: Vanilla JavaScript (SSE client, no framework)
- **Communication**: Server-Sent Events (real-time push)
- **Process info**: `ps`, `lsof`, `git`, `gh` CLI
- **Window control**: macOS `osascript` + `open -a`

## Scripts

```bash
npm run build      # Compile TypeScript
npm run dev        # Development mode (tsx watch + hot reload)
npm start          # Production mode (after build)
npm test           # Run tests
npm run test:watch # Watch mode tests
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3000` | HTTP server port |
| `BYAKUGAN_POLL_INTERVAL_MS` | `2000` | SSE push interval & process data cache TTL (ms) |
| `BYAKUGAN_OAUTH_FETCH` | `true` | Set `false` to disable OAuth usage API calls (e.g. during persistent 429) |
| `BYAKUGAN_OAUTH_CACHE_TTL_MS` | `300000` | OAuth success response cache duration (ms) |
| `BYAKUGAN_5H_LIMIT` | — | 5-hour output token limit for approximate usage % display |
| `BYAKUGAN_WEEKLY_LIMIT` | — | Weekly output token limit for approximate usage % display |
| `BYAKUGAN_USAGE_CACHE_PATH` | `~/.claude/plugins/byakugan/.usage-cache.json` | Disk cache path for OAuth usage API responses (survives server restarts) |

## API Reference

### `GET /events`

SSE stream — pushes full dashboard data every 2 seconds.

### `GET /api/processes`

Returns a snapshot of all running Claude Code processes.

**Response example:**
```json
{
  "processes": [
    {
      "pid": 12345,
      "projectName": "my-project",
      "projectDir": "/Users/user/projects/my-project",
      "status": "working",
      "claudeStatus": "executing",
      "cpuPercent": 15.2,
      "memPercent": 8.5,
      "currentTask": "Implement new feature for dashboard",
      "gitBranch": "feat/new-feature",
      "gitCommonDir": "/Users/user/projects/my-project/.git",
      "modelName": "claude-sonnet-4-6",
      "prUrl": "https://github.com/user/repo/pull/123",
      "openFiles": ["src/server.ts", "src/types.ts"],
      "editorApp": "vscode",
      "containers": [
        { "service": "api", "name": "api-1", "state": "running", "status": "Up 2 hours" }
      ]
    }
  ],
  "editorWindows": [],
  "totalWorking": 1,
  "totalIdle": 2,
  "usage": {
    "totalInputTokens": 120000,
    "totalOutputTokens": 45000,
    "fiveHourPercent": 32,
    "weeklyPercent": 35,
    "fiveHourResetsAt": "2025-01-15T02:00:00Z",
    "weeklyResetsAt": "2025-01-20T00:00:00Z"
  },
  "collectedAt": "2025-01-15T10:30:45.123Z"
}
```

### `POST /api/focus`

Focus the editor window associated with a Claude process.

```json
{ "pid": 12345 }
```

### `POST /api/focus-editor`

Focus an editor window not associated with a Claude process.

```json
{ "projectDir": "/Users/user/projects/my-project", "app": "vscode" }
```

## Troubleshooting

### "No Claude processes found"

Make sure Claude Code is running:
```bash
ps aux | grep claude
```

### PR link not showing

- Ensure GitHub CLI (`gh`) is installed and authenticated
- The current branch must not be `main` or `master`

### VSCode / Cursor focus not working

- Make sure the editor is running
- Check macOS accessibility permissions in System Settings → Privacy & Security → Accessibility

## License

MIT

## Contributing

Issues and pull requests are welcome!
