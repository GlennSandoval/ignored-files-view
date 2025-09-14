import cp from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkIgnoreVerbose } from "../../src/git";

function hasGit() {
  try {
    cp.execSync("git --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function setupTempDir(prefix = "test-") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

function setupRepoWithIgnore(content: string) {
  const dir = setupTempDir("check-ignore-");
  cp.execSync("git init", { cwd: dir, stdio: "ignore" });
  fs.writeFileSync(path.join(dir, ".gitignore"), content);
  return dir;
}

const itIfGit = hasGit() ? it : it.skip;

describe("checkIgnoreVerbose", () => {
  itIfGit("returns rule source, line, and pattern", async () => {
    const repo = setupRepoWithIgnore(["# comment", "*.log", "tmp/"].join("\n"));
    const res1 = await checkIgnoreVerbose(repo, "foo.log");
    expect(Boolean(res1?.source)).toBe(true);
    expect(res1?.line).toBe(2);
    expect(res1?.pattern.trim()).toBe("*.log");

    const res2 = await checkIgnoreVerbose(repo, "tmp/a.txt");
    expect(res2?.line).toBe(3);
    expect(res2?.pattern.trim()).toBe("tmp/");
  });

  itIfGit("returns null when file is not ignored", async () => {
    const repo = setupRepoWithIgnore("# nothing\n");
    const res = await checkIgnoreVerbose(repo, "a.txt");
    expect(res).toBeNull();
  });
});
