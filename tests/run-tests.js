// Minimal unit tests for parseGitZOutput without external frameworks
const path = require('path');
const assert = require('assert');

const git = require(path.join(process.cwd(), 'out', 'git.js'));

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    console.error(`✗ ${name}`);
    console.error(err && err.stack || err);
    process.exitCode = 1;
  }
}

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

// If any test failed, exit non-zero
if (process.exitCode) {
  process.exit(process.exitCode);
}
