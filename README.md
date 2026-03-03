# claudes-watch

Claude Code プロセスをリアルタイムで監視するダッシュボード。macOS 上で実行している複数の Claude Code インスタンスの状態を一目で確認できます。

## 機能

- **リアルタイムプロセス監視**: 実行中の Claude Code プロセスをカード形式で表示
- **詳細情報表示**: 各カードに以下の情報を表示
  - プロジェクト名とディレクトリパス
  - Git ブランチ名と PR リンク
  - 使用中のモデル（Claude Opus、Sonnet など）
  - 現在処理中のタスク
  - 開いているファイル一覧
  - CPU / メモリ使用率（トグル可能）
  - 実行時間と PID
- **ワンクリックフォーカス**: カードをクリックして対応する VSCode / Cursor ウィンドウにフォーカス
- **リポジトリごとのグループ化**: git worktree を認識し、同じリポジトリのプロセスをグループ化表示
- **エディタウィンドウ表示**: Claude プロセスがない VSCode / Cursor ウィンドウも表示
- **ホットリロード**: `public/` ディレクトリ内のファイル変更を自動検出して画面をリロード
- **ダーク/ライトテーマ**: システム設定に応じて自動切り替え
- **SSE ベースのリアルタイム更新**: 2 秒ごとにデータを更新

## 前提条件

- **macOS** （`ps`、`osascript`、`open -a` コマンドを使用）
- **Node.js 18+**
- **GitHub CLI** (`gh`) - PR リンク取得用
- **Git** - ブランチ情報取得用

## インストール

```bash
git clone <repository-url>
cd claudes-watch
npm install
```

## 使用方法

### 開発モード（ファイル変更で自動リロード）

```bash
npm run dev
```

ブラウザで http://localhost:3000 を開きます。

### 本番モード

```bash
npm run build
npm start
```

## API リファレンス

### `GET /api/processes`

実行中のプロセスデータのスナップショットを取得します。

**レスポンス例:**
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

Claude プロセスに対応するエディタウィンドウにフォーカスします。

**リクエスト:**
```json
{
  "pid": 12345
}
```

### `POST /api/focus-editor`

Claude プロセスがないエディタウィンドウにフォーカスします。

**リクエスト:**
```json
{
  "projectDir": "/Users/user/projects/my-project",
  "app": "vscode"
}
```

### `GET /events`

Server-Sent Events (SSE) ストリーム。2 秒ごとにプロセスデータを配信します。

## プロジェクト構成

```
claudes-watch/
├── src/
│   ├── server.ts              # Express サーバー、SSE、REST API
│   ├── processCollector.ts    # Claude プロセス情報の収集
│   ├── vscodeController.ts    # VSCode/Cursor フォーカス制御
│   └── types.ts               # TypeScript 型定義
├── public/
│   ├── index.html             # ダッシュボード HTML
│   ├── app.js                 # フロントエンド（SSE クライアント、レンダリング）
│   ├── style.css              # ダーク/ライトテーマ対応スタイル
│   └── [icons].svg            # Claude、VSCode、Cursor のアイコン
├── package.json
└── tsconfig.json
```

## 技術スタック

- **バックエンド**: Node.js + TypeScript + Express
- **フロントエンド**: Vanilla JavaScript (SSE クライアント)
- **通信**: Server-Sent Events (リアルタイム更新)
- **プロセス情報取得**: `ps`、`lsof`、`git`、`gh` CLI
- **ウィンドウ制御**: macOS `osascript` + `open -a`

## 開発スクリプト

```bash
npm run build      # TypeScript をコンパイル
npm run dev        # 開発モード（tsx watch）
npm start          # 本番モード（コンパイル後）
npm run test       # テスト実行
npm run test:watch # テスト監視モード
```

## トラブルシューティング

### "No Claude processes found" と表示される

Claude Code が起動していることを確認してください。

```bash
ps aux | grep claude
```

### PR リンクが表示されない

- GitHub CLI (`gh`) がインストールされていることを確認してください
- リポジトリが GitHub に接続されていることを確認してください
- 現在のブランチが `main` または `master` 以外であることを確認してください

### VSCode / Cursor のフォーカスが効かない

- エディタアプリケーションが起動していることを確認してください
- macOS の権限設定を確認してください（アクセシビリティ）

## ライセンス

MIT

## 貢献

Issue や Pull Request は大歓迎です。
