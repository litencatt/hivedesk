import { describe, it, expect } from "vitest";
import { encodeProjectDir, parseElapsedSeconds, parseStorageFolders } from "./utils/processUtils.js";

describe("encodeProjectDir", () => {
  it("replaces slashes with dashes", () => {
    expect(encodeProjectDir("/Users/foo/bar")).toBe("-Users-foo-bar");
  });

  it("handles path with no leading slash", () => {
    expect(encodeProjectDir("foo/bar")).toBe("foo-bar");
  });

  it("replaces dots with dashes", () => {
    expect(encodeProjectDir("/Users/nakamura.k/.ghq")).toBe("-Users-nakamura-k--ghq");
  });

  it("replaces all non-alphanumeric characters to match ~/.claude/projects encoding", () => {
    expect(encodeProjectDir("/Users/nakamura.k/.ghq/git.pepabo.com/hosting/muu.ws/ws6"))
      .toBe("-Users-nakamura-k--ghq-git-pepabo-com-hosting-muu-ws-ws6");
  });
});

describe("parseElapsedSeconds", () => {
  it("parses MM:SS", () => {
    expect(parseElapsedSeconds("01:30")).toBe(90);
    expect(parseElapsedSeconds("00:05")).toBe(5);
  });

  it("parses HH:MM:SS", () => {
    expect(parseElapsedSeconds("01:30:00")).toBe(5400);
    expect(parseElapsedSeconds("02:00:01")).toBe(7201);
  });

  it("parses DD-HH:MM:SS", () => {
    expect(parseElapsedSeconds("1-02:30:00")).toBe(86400 + 9000);
    expect(parseElapsedSeconds("0-00:00:01")).toBe(1);
  });

  it("returns 0 for unknown format", () => {
    expect(parseElapsedSeconds("")).toBe(0);
  });
});

describe("parseStorageFolders", () => {
  it("extracts file:// folders", () => {
    const storage = {
      backupWorkspaces: {
        folders: [
          { folderUri: "file:///Users/foo/bar" },
          { folderUri: "file:///Users/foo/baz" },
        ],
      },
    };
    const result = parseStorageFolders(storage, "vscode");
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ app: "vscode", projectDir: "/Users/foo/bar", projectName: "bar", gitBranch: null, gitCommonDir: null, prUrl: null, prTitle: null });
    expect(result[1]).toEqual({ app: "vscode", projectDir: "/Users/foo/baz", projectName: "baz", gitBranch: null, gitCommonDir: null, prUrl: null, prTitle: null });
  });

  it("skips non-file:// URIs", () => {
    const storage = {
      backupWorkspaces: {
        folders: [
          { folderUri: "vscode-remote://dev-container/workspace" },
          { folderUri: "file:///Users/foo/local" },
        ],
      },
    };
    const result = parseStorageFolders(storage, "vscode");
    expect(result).toHaveLength(1);
    expect(result[0].projectDir).toBe("/Users/foo/local");
  });

  it("removes trailing slash from projectDir", () => {
    const storage = {
      backupWorkspaces: {
        folders: [{ folderUri: "file:///Users/foo/bar/" }],
      },
    };
    const result = parseStorageFolders(storage, "vscode");
    expect(result[0].projectDir).toBe("/Users/foo/bar");
  });

  it("decodes URL-encoded paths", () => {
    const storage = {
      backupWorkspaces: {
        folders: [{ folderUri: "file:///Users/foo/my%20project" }],
      },
    };
    const result = parseStorageFolders(storage, "cursor");
    expect(result[0]).toEqual({ app: "cursor", projectDir: "/Users/foo/my project", projectName: "my project", gitBranch: null, gitCommonDir: null, prUrl: null, prTitle: null });
  });

  it("returns empty array when backupWorkspaces is missing", () => {
    expect(parseStorageFolders({}, "vscode")).toHaveLength(0);
    expect(parseStorageFolders({ backupWorkspaces: {} }, "vscode")).toHaveLength(0);
  });
});
