// Minimal unit tests for parseGitZOutput and listIgnoredFiles without external frameworks
const path = require('path');
const fs = require('fs');
const os = require('os');
const cp = require('child_process');
const assert = require('assert');

const git = require(path.join(process.cwd(), 'dist', 'git.js'));

// Simple test runner that supports sync and async tests
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

async function run() {
  for (const t of tests) {
    try {
      await Promise.resolve(t.fn());
      console.log(`✓ ${t.name}`);
    } catch (err) {
      console.error(`✗ ${t.name}`);
      console.error((err && err.stack) || err);
      process.exitCode = 1;
    }
  }
  if (process.exitCode) process.exit(process.exitCode);
}

// Helpers
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

// parseGitZOutput tests
test('splits zero-delimited and filters empties', () => {
  const out = git.parseGitZOutput('a\u0000b\u0000\u0000c');
  assert.deepStrictEqual(out, ['a', 'b', 'c']);
});

test('handles trailing delimiter', () => {
  const out = git.parseGitZOutput('foo\u0000bar\u0000');
  assert.deepStrictEqual(out, ['bar', 'foo']);
});

test('sorts case-insensitively', () => {
  const out = git.parseGitZOutput('B\u0000a\u0000A\u0000b');
  // Validate grouping ignoring case; intra-equal order is locale-dependent
  assert.deepStrictEqual(out.map((s) => s.toLowerCase()), ['a', 'a', 'b', 'b']);
});

test('keeps relative paths intact', () => {
  const out = git.parseGitZOutput('dir/file.txt\u0000.other\u0000nested/dir/.gitkeep');
  assert.deepStrictEqual(out, ['.other', 'dir/file.txt', 'nested/dir/.gitkeep']);
});

// listIgnoredFiles behavior tests (best-effort; skipped if git not available)
test('listIgnoredFiles: non-git directory rejects with helpful error', async () => {
  if (!hasGit()) { console.log('↷ skip: git not available'); return; }
  const dir = setupTempDir('non-git-');
  try {
    await git.listIgnoredFiles(dir, 10);
    throw new Error('Expected rejection');
  } catch (err) {
    assert(/Not a Git repository|unavailable/.test(String(err.message)), 'should map to helpful message');
  }
});

test('listIgnoredFiles: truncates to maxItems and sets flag', async () => {
  if (!hasGit()) { console.log('↷ skip: git not available'); return; }
  const dir = setupRepoWithIgnoredFiles(5);
  const res = await git.listIgnoredFiles(dir, 3);
  assert(Array.isArray(res.files), 'files is array');
  assert(res.files.length === 3, 'respects maxItems');
  assert.strictEqual(res.truncated, true, 'truncated flag true when capped');
});

test('listIgnoredFiles: supports AbortSignal (pre-aborted)', async () => {
  if (!hasGit()) { console.log('↷ skip: git not available'); return; }
  const dir = setupRepoWithIgnoredFiles(2);
  const ctrl = new AbortController();
  ctrl.abort();
  try {
    await git.listIgnoredFiles(dir, 10, ctrl.signal);
    throw new Error('Expected rejection');
  } catch (err) {
    assert(/cancelled|canceled/i.test(String(err.message)), 'cancellation error surfaced');
  }
});

test('listIgnoredFiles: caches results for ttl window', async () => {
  if (!hasGit()) { console.log('↷ skip: git not available'); return; }
  const dir = setupRepoWithIgnoredFiles(2);
  git.clearIgnoredListCache(dir);
  const a = await git.listIgnoredFiles(dir, 10);
  const b = await git.listIgnoredFiles(dir, 10);
  assert.strictEqual(a, b, 'returns same cached object within ttl');
  git.clearIgnoredListCache(dir);
});

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
