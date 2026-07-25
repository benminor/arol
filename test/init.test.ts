import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findExistingArolWorkflow,
  runInit,
  shouldSuggestInit,
  WORKFLOW_PATH,
  workflowYaml,
} from "../src/init";
import { renderReport } from "../src/report";
import { mkDep } from "./helpers";
import type { ScanResult } from "../src/types";

/* ------------------------------ fixtures ------------------------------ */

const tmpDirs: string[] = [];
afterEach(() => {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop()!, { recursive: true, force: true });
  }
});

function mkTmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "arol-init-"));
  tmpDirs.push(dir);
  return dir;
}

/** A fake git repo: `.git/` directory, optional config with a remote url. */
function mkRepo(remoteUrl?: string): string {
  const dir = mkTmp();
  fs.mkdirSync(path.join(dir, ".git"));
  if (remoteUrl) {
    fs.writeFileSync(
      path.join(dir, ".git", "config"),
      `[remote "origin"]\n\turl = ${remoteUrl}\n`
    );
  }
  return dir;
}

function workflowAt(repo: string): string {
  return path.join(repo, WORKFLOW_PATH);
}

/* ------------------------------- runInit ------------------------------- */

describe("arol init", () => {
  it("refuses outside a git repository", () => {
    expect(runInit(mkTmp())).toEqual({ kind: "not-git" });
  });

  it("writes the workflow in a fresh repo with no remote", () => {
    const repo = mkRepo();
    const outcome = runInit(repo);
    expect(outcome).toEqual({ kind: "written", file: WORKFLOW_PATH });

    const body = fs.readFileSync(workflowAt(repo), "utf8");
    expect(body).toContain("name: arol deprecation scan");
    expect(body).toContain("npx arol-ai scan");
    expect(body).toContain("schedule:");
    expect(body).toContain("AROL_REPORT_TOKEN: ${{ secrets.AROL_REPORT_TOKEN }}");
  });

  it("writes at the repo root even when run from a subdirectory", () => {
    const repo = mkRepo("https://github.com/acme/api.git");
    const sub = path.join(repo, "packages", "web");
    fs.mkdirSync(sub, { recursive: true });

    expect(runInit(sub).kind).toBe("written");
    expect(fs.existsSync(workflowAt(repo))).toBe(true);
    expect(fs.existsSync(path.join(sub, WORKFLOW_PATH))).toBe(false);
  });

  it("accepts scp-style GitHub remotes", () => {
    const repo = mkRepo("git@github.com:acme/api.git");
    expect(runInit(repo).kind).toBe("written");
  });

  it("bails politely when every remote is clearly not GitHub", () => {
    const repo = mkRepo("https://gitlab.com/acme/api.git");
    const outcome = runInit(repo);
    expect(outcome).toEqual({ kind: "non-github", host: "gitlab.com" });
    expect(fs.existsSync(workflowAt(repo))).toBe(false);
  });

  it("proceeds when any one of several remotes is GitHub", () => {
    const repo = mkRepo();
    fs.writeFileSync(
      path.join(repo, ".git", "config"),
      [
        '[remote "mirror"]',
        "\turl = https://gitlab.com/acme/api.git",
        '[remote "origin"]',
        "\turl = https://github.com/acme/api.git",
        "",
      ].join("\n")
    );
    expect(runInit(repo).kind).toBe("written");
  });

  it("is idempotent: a second run reports 'already' and never clobbers edits", () => {
    const repo = mkRepo();
    runInit(repo);
    fs.writeFileSync(workflowAt(repo), "# user-edited\n");

    const outcome = runInit(repo);
    expect(outcome).toEqual({ kind: "already", file: WORKFLOW_PATH, ours: true });
    expect(fs.readFileSync(workflowAt(repo), "utf8")).toBe("# user-edited\n");
  });

  it("--force overwrites with the canonical template", () => {
    const repo = mkRepo();
    runInit(repo);
    fs.writeFileSync(workflowAt(repo), "# user-edited\n");

    expect(runInit(repo, { force: true }).kind).toBe("written");
    expect(fs.readFileSync(workflowAt(repo), "utf8")).toBe(workflowYaml());
  });

  it("detects a hand-written workflow that already runs arol under another name", () => {
    const repo = mkRepo();
    const ciPath = path.join(repo, ".github", "workflows");
    fs.mkdirSync(ciPath, { recursive: true });
    fs.writeFileSync(
      path.join(ciPath, "ci.yml"),
      "jobs:\n  scan:\n    steps:\n      - run: npx arol-ai scan\n"
    );

    const outcome = runInit(repo);
    expect(outcome).toEqual({
      kind: "already",
      file: path.join(".github", "workflows", "ci.yml"),
      ours: false,
    });
    expect(fs.existsSync(workflowAt(repo))).toBe(false);
  });

  it("ignores unrelated workflows", () => {
    const repo = mkRepo();
    const ciPath = path.join(repo, ".github", "workflows");
    fs.mkdirSync(ciPath, { recursive: true });
    fs.writeFileSync(path.join(ciPath, "release.yml"), "jobs: {}\n");

    expect(findExistingArolWorkflow(repo)).toBeNull();
    expect(runInit(repo).kind).toBe("written");
  });
});

/* -------------------------- shouldSuggestInit -------------------------- */

describe("shouldSuggestInit", () => {
  it("suggests in an interactive run inside a repo with no arol workflow", () => {
    expect(shouldSuggestInit(mkRepo(), {})).toBe(true);
  });

  it("stays quiet in CI", () => {
    expect(shouldSuggestInit(mkRepo(), { CI: "true" })).toBe(false);
  });

  it("stays quiet outside a git repo — init would only fail", () => {
    expect(shouldSuggestInit(mkTmp(), {})).toBe(false);
  });

  it("stays quiet once the workflow exists", () => {
    const repo = mkRepo();
    runInit(repo);
    expect(shouldSuggestInit(repo, {})).toBe(false);
  });
});

/* --------------------------- report rendering --------------------------- */

function resultWith(findings: ScanResult["findings"]): ScanResult {
  return { scannedFiles: 3, manifestsScanned: [], dependencies: [], findings };
}

const oneFinding = () => [
  {
    deprecation: mkDep({ severity: "high", sunset_date: "2099-01-01" }),
    manifestMatches: [],
    patternMatches: [{ file: "src/a.ts", line: 3, text: "x" }],
  },
];

describe("scan report init hint", () => {
  it("appends the init nudge when findings exist and the caller asks", () => {
    const out = renderReport(resultWith(oneFinding()), {
      color: false,
      initHint: true,
    });
    expect(out).toContain("npx arol-ai init");
  });

  it("omits the nudge when the caller says no (CI, workflow present, ...)", () => {
    const out = renderReport(resultWith(oneFinding()), {
      color: false,
      initHint: false,
    });
    expect(out).not.toContain("arol-ai init");
  });

  it("never pitches a CI gate on a clean scan", () => {
    const out = renderReport(resultWith([]), { color: false, initHint: true });
    expect(out).not.toContain("arol-ai init");
  });
});
