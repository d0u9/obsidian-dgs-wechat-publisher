import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSrc } from './helpers/load-src.mjs';

const { isAbsolutePath, isFileNotFound, readLocalTextFile, usesHomeShorthand } = await loadSrc('local-file.ts');

// Expanding a ~ means reading the home directory out of the environment, which reads as machine
// fingerprinting. The path is asked for in full instead, and a ~ is reported rather than guessed at.
test('a ~ path is recognised so it can be reported, never expanded', () => {
  assert.equal(usesHomeShorthand('~/Git/x/.env'), true);
  assert.equal(usesHomeShorthand('  ~  '), true);
  assert.equal(usesHomeShorthand('/Users/doug/x/.env'), false);
  assert.equal(usesHomeShorthand('relative/.env'), false);
});

test('absolute paths are recognised on every desktop platform', () => {
  for (const path of ['/a/b', 'C:\\x', 'c:/x', '\\\\server\\share']) {
    assert.equal(isAbsolutePath(path), true, path);
  }
  for (const path of ['rel/x', './x', '~/x', '']) {
    assert.equal(isAbsolutePath(path), false, path);
  }
});

// The error shape depends on who reports it, so both the code and the message are accepted.
test('a missing file is recognised however it is reported', () => {
  assert.equal(isFileNotFound({ code: 'ENOENT' }), true);
  assert.equal(isFileNotFound(new Error('ENOENT: no such file or directory')), true);
  assert.equal(isFileNotFound(new Error('EACCES: permission denied')), false);
  assert.equal(isFileNotFound(null), false);
  assert.equal(isFileNotFound('ENOENT'), false);
});

test('a local file is read as UTF-8 text', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'dgs-local-')), 'note.txt');
  writeFileSync(file, '中文 content\n');
  assert.equal(await readLocalTextFile(file), '中文 content\n');
});
