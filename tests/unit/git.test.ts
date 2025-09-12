import { describe, it, expect } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';
import { parseGitZOutput, listIgnoredFiles, clearIgnoredListCache } from '../../src/git';

function hasGit() {
  try {
    cp.execSync('git --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function setupTempDir(prefix = 'test-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

function setupRepoWithIgnoredFiles(count = 5) {
  const dir = setupTempDir('ignored-repo-');
  cp.execSync('git init', { cwd: dir, stdio: 'ignore' });
  fs.writeFileSync(path.join(dir, '.gitignore'), '*.tmp\n');
  for (let i = 0; i < count; i++) {
    fs.writeFileSync(path.join(dir, `file-${i}.tmp`), 'x');
  }
  return dir;
}

const itIfGit = hasGit() ? it : it.skip;

describe('parseGitZOutput', () => {
  it('splits zero-delimited and filters empties', () => {
    const out = parseGitZOutput('a\u0000b\u0000\u0000c');
    expect(out).toEqual(['a', 'b', 'c']);
  });

  it('handles trailing delimiter', () => {
    const out = parseGitZOutput('foo\u0000bar\u0000');
    expect(out).toEqual(['bar', 'foo']);
  });

  it('sorts case-insensitively', () => {
    const out = parseGitZOutput('B\u0000a\u0000A\u0000b');
    expect(out.map((s) => s.toLowerCase())).toEqual(['a', 'a', 'b', 'b']);
  });

  it('keeps relative paths intact', () => {
    const out = parseGitZOutput('dir/file.txt\u0000.other\u0000nested/dir/.gitkeep');
    expect(out).toEqual(['.other', 'dir/file.txt', 'nested/dir/.gitkeep']);
  });
});

describe('listIgnoredFiles', () => {
  itIfGit('non-git directory rejects with helpful error', async () => {
    const dir = setupTempDir('non-git-');
    await expect(listIgnoredFiles(dir, 10)).rejects.toThrow(/Not a Git repository|unavailable/);
  });

  itIfGit('truncates to maxItems and sets flag', async () => {
    const dir = setupRepoWithIgnoredFiles(5);
    const res = await listIgnoredFiles(dir, 3);
    expect(Array.isArray(res.files)).toBe(true);
    expect(res.files.length).toBe(3);
    expect(res.truncated).toBe(true);
  });

  itIfGit('supports AbortSignal (pre-aborted)', async () => {
    const dir = setupRepoWithIgnoredFiles(2);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(listIgnoredFiles(dir, 10, ctrl.signal)).rejects.toThrow(/cancelled|canceled/i);
  });

  itIfGit('caches results for ttl window', async () => {
    const dir = setupRepoWithIgnoredFiles(2);
    clearIgnoredListCache(dir);
    const a = await listIgnoredFiles(dir, 10);
    const b = await listIgnoredFiles(dir, 10);
    expect(a).toBe(b);
    clearIgnoredListCache(dir);
  });
});

