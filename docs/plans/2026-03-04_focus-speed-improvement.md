# フォーカス速度改善 開発計画

作成日: 2026-03-04

## 背景

現在の `focusVSCodeWindow` は以下の2コマンドを並列実行している：

```typescript
await Promise.all([
  execFileAsync("osascript", ["-e", `tell application "${appName}" to activate`]),
  execFileAsync("open", ["-a", appName, projectDir]),
]);
```

`open -a appName projectDir` は「既存ウィンドウにフォーカス」ではなく「フォルダを開く」コマンドであり、新規ウィンドウが開く副作用や速度面の問題がある。

## 改善方針

### フェーズ 1: `open -a` を削除（低コスト・即効）

`open -a` を削除し、`osascript activate` のみに絞る。

**期待効果:**
- 不要なプロセス起動をなくし速度向上
- 新規ウィンドウが開く副作用を排除

**変更対象:** `src/vscodeController.ts`

```typescript
export async function focusVSCodeWindow(
  projectDir: string,
  app: "vscode" | "cursor" = "vscode"
): Promise<boolean> {
  const appName = APP_NAMES[app];
  try {
    await execFileAsync("osascript", ["-e", `tell application "${appName}" to activate`]);
    return true;
  } catch {
    return false;
  }
}
```

### フェーズ 2: Swift CLI バイナリ化（中コスト・根本解決）

osascript のサブプロセス起動オーバーヘッドをなくすため、NSWorkspace API を使う小さな Swift CLI を追加する。

**実装方針:**
- `tools/focus-window/` に Swift パッケージを作成
- `NSRunningApplication` で対象アプリを検索し `activate()` を呼ぶ
- `npm run build` 時に Swift バイナリもビルドし `dist/` に配置
- `vscodeController.ts` でコンパイル済みバイナリを呼び出す

**ディレクトリ構成案:**
```
byakugan/
├── tools/
│   └── focus-window/
│       ├── Package.swift
│       └── Sources/
│           └── main.swift
├── src/
│   └── vscodeController.ts  # バイナリを execFile で呼び出す
```

**Swift 実装イメージ:**
```swift
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { exit(1) }

let appName = args[1]
let running = NSWorkspace.shared.runningApplications
if let app = running.first(where: { $0.localizedName == appName }) {
    app.activate(options: .activateIgnoringOtherApps)
    exit(0)
}
exit(1)
```

**vscodeController.ts での利用:**
```typescript
const binaryPath = path.join(import.meta.dirname, "../dist/focus-window");
await execFileAsync(binaryPath, [appName]);
```

### フェーズ 3（検討）: フルネイティブ Mac アプリ

| 項目 | 評価 |
|------|------|
| フォーカス速度 | 最速 |
| 開発コスト | 高（SwiftUI/AppKit 全面移行） |
| 配布 | 署名・公証が必要 |
| 既存 Web UI 資産 | 捨てることになる |

フェーズ 2 で速度が十分なら不要。ユーザー数が増えて配布性が課題になった場合に再検討。

## 優先度

| フェーズ | 優先度 | 工数目安 |
|----------|--------|----------|
| フェーズ 1: `open -a` 削除 | 高 | 30分 |
| フェーズ 2: Swift CLI | 中 | 半日 |
| フェーズ 3: ネイティブアプリ | 低 | 数日〜 |

## 判断基準

フェーズ 1 実施後、クリックからフォーカスまでの体感が十分であればフェーズ 2 は不要。
フォーカスまで 200ms 以上かかると感じる場合はフェーズ 2 へ進む。
