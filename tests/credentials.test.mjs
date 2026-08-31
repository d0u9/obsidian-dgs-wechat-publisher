import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSrc } from './helpers/load-src.mjs';

const { loadCredentials, maskAppId, parseEnv } = await loadSrc('credentials.ts');

const write = (contents) => {
  const file = join(mkdtempSync(join(tmpdir(), 'dgs-env-')), '.env');
  writeFileSync(file, contents);
  return file;
};

test('parseEnv reads the shapes a credentials file actually uses', () => {
  assert.deepEqual(parseEnv([
    '# comment',
    '',
    'WECHAT_APP_ID=wx1234',
    "export WECHAT_APP_SECRET='se cret'",
    'WECHAT_AUTHOR="苏道格"',
    'TRAILING=value # note',
    'not a key',
  ].join('\n')), {
    WECHAT_APP_ID: 'wx1234',
    WECHAT_APP_SECRET: 'se cret',
    WECHAT_AUTHOR: '苏道格',
    TRAILING: 'value',
  });
});

test('a # inside a quoted value is kept', () => {
  assert.deepEqual(parseEnv('WECHAT_APP_SECRET="a#b"'), { WECHAT_APP_SECRET: 'a#b' });
});

test('loadCredentials returns the three fields', async () => {
  const file = write('WECHAT_APP_ID=wx1\nWECHAT_APP_SECRET=s1\nWECHAT_AUTHOR=作者\n');
  assert.deepEqual(await loadCredentials(file), { appId: 'wx1', appSecret: 's1', author: '作者' });
});

test('an incomplete or missing file explains itself', async () => {
  const partial = write('WECHAT_APP_ID=wx1\n');
  await assert.rejects(loadCredentials(partial), /WECHAT_APP_SECRET/);
  await assert.rejects(loadCredentials(join(tmpdir(), 'dgs-nope', '.env')), /文件不存在/);
  await assert.rejects(loadCredentials('relative/.env'), /绝对路径/);
  await assert.rejects(loadCredentials('~/Git/x/.env'), /不支持 ~/);
});

test('maskAppId never shows the whole value', () => {
  assert.equal(maskAppId('wx1234567890'), 'wx12…7890');
  assert.equal(maskAppId('short'), 'short');
});
