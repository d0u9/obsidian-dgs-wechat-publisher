import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSrc } from './helpers/load-src.mjs';

const { expandHome, isAbsolutePath, isFileNotFound, readLocalTextFile } = await loadSrc('local-file.ts');

test('~ is expanded, and nothing else is touched', () => {
  const home = process.env.HOME;
  assert.equal(expandHome('~'), home);
  assert.equal(expandHome('~/Git/x/.env'), `${home}/Git/x/.env`);
  assert.equal(expandHome('  ~/x  '), `${home}/x`);
  assert.equal(expandHome('/etc/hosts'), '/etc/hosts');
  // A leading ~ that is not a home reference stays as typed.
  assert.equal(expandHome('~user/x'), '~user/x');
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
