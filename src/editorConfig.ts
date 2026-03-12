import path from "path";
import os from "os";
import { EditorWindow } from "./types.js";

export interface EditorConfig {
  app: EditorWindow["app"];
  appName: string;
  bundleId: string;
  globalStoragePath: string;
  processPattern: RegExp;
}

export const EDITOR_CONFIGS: EditorConfig[] = [
  {
    app: "vscode",
    appName: "Visual Studio Code",
    bundleId: "com.microsoft.VSCode",
    globalStoragePath: process.env.BYAKUGAN_VSCODE_STORAGE_PATH ?? path.join(os.homedir(), "Library/Application Support/Code/User/globalStorage/storage.json"),
    processPattern: /Visual Studio Code\.app\/Contents\/MacOS\//,
  },
  {
    app: "cursor",
    appName: "Cursor",
    bundleId: "com.todesktop.230313mzl4w4u92",
    globalStoragePath: process.env.BYAKUGAN_CURSOR_STORAGE_PATH ?? path.join(os.homedir(), "Library/Application Support/Cursor/User/globalStorage/storage.json"),
    processPattern: /Cursor\.app\/Contents\/MacOS\/Cursor/,
  },
];
