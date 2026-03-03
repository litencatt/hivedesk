# hivedesk

**Click any card to instantly focus the corresponding VSCode / Cursor window.** A dashboard for monitoring multiple AI agents (Claude Code) running in parallel across your projects.

Built for developers who juggle multiple projects simultaneously. macOS only.

[日本語版 README はこちら](./README.ja.md)

## Target

- Developers working with **multiple displays**
- Developers who use **VSCode or Cursor** as their primary IDE, with **multiple instances open simultaneously**, each running an AI agent in its own terminal
- **macOS only** (current)

![hivedesk screenshot](./docs/screenshot.png)

## Features

- **One-click IDE focus**: Click a card to instantly activate the corresponding VSCode / Cursor window (instant switching via osascript)
- **Editor window listing**: Shows VSCode / Cursor windows even without an active Claude process — click to focus
- **Real-time process monitoring**: Displays running Claude Code processes as cards in a grid
- **Rich card info**:
  - Project name and directory path
  - Git branch and PR link
  - Active model (Claude Opus, Sonnet, etc.)
  - Current task description
  - Open files list
  - CPU / memory usage (toggleable)
  - Uptime and PID
- **Repository grouping**: Groups worktrees from the same repository together
- **Hot reload**: Auto-reloads the UI when files in `public/` change
- **Dark / light theme**: Follows your system preference
- **SSE-based live updates**: Refreshes data every 2 seconds

## Prerequisites

- **macOS** (uses `ps`, `osascript`, `open -a`)
- **Node.js 18+**
- **GitHub CLI** (`gh`) — for PR link detection
- **Git** — for branch info

## Installation

```bash
git clone https://github.com/litencatt/hivedesk.git
cd hivedesk
npm install
```

## Usage

### Development mode (auto-reload on file change)

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

### Production mode

```bash
npm run build
npm start
```

## API Reference

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
      "cpuPercent": 15.2,
      "memPercent": 8.5,
      "currentTask": "Implement new feature for dashboard",
      "gitBranch": "feat/new-feature",
      "modelName": "claude-opus-4-1",
      "prUrl": "https://github.com/user/repo/pull/123",
      "openFiles": ["src/server.ts", "src/types.ts"],
      "editorApp": "vscode"
    }
  ],
  "editorWindows": [],
  "totalWorking": 1,
  "totalIdle": 2,
  "collectedAt": "2024-01-15T10:30:45.123Z"
}
```

### `POST /api/focus`

Focus the editor window associated with a Claude process.

**Request:**
```json
{ "pid": 12345 }
```

### `POST /api/focus-editor`

Focus an editor window not associated with a Claude process.

**Request:**
```json
{ "projectDir": "/Users/user/projects/my-project", "app": "vscode" }
```

### `GET /events`

SSE stream — delivers process data every 2 seconds.

## Project Structure

```
hivedesk/
├── src/
│   ├── server.ts              # Express server, SSE, REST API
│   ├── processCollector.ts    # Claude process info collection
│   ├── vscodeController.ts    # VSCode/Cursor focus control
│   └── types.ts               # TypeScript types
├── public/
│   ├── index.html             # Dashboard HTML
│   ├── app.js                 # Frontend (SSE client, rendering)
│   ├── style.css              # Dark/light theme styles
│   └── [icons].svg            # Claude, VSCode, Cursor icons
├── package.json
└── tsconfig.json
```

## Tech Stack

- **Backend**: Node.js + TypeScript + Express
- **Frontend**: Vanilla JavaScript (SSE client)
- **Communication**: Server-Sent Events (real-time updates)
- **Process info**: `ps`, `lsof`, `git`, `gh` CLI
- **Window control**: macOS `osascript` + `open -a`

## Scripts

```bash
npm run build      # Compile TypeScript
npm run dev        # Development mode (tsx watch)
npm start          # Production mode (after build)
npm run test       # Run tests
npm run test:watch # Watch mode tests
```

## Troubleshooting

### "No Claude processes found"

Make sure Claude Code is running:
```bash
ps aux | grep claude
```

### PR link not showing

- Ensure GitHub CLI (`gh`) is installed and authenticated
- Ensure the repository is connected to GitHub
- The current branch must not be `main` or `master`

### VSCode / Cursor focus not working

- Make sure the editor application is running
- Check macOS accessibility permissions

## License

MIT

## Contributing

Issues and pull requests are welcome!
