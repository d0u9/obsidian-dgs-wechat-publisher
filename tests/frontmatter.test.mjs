import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrontmatter } from 'dgs-wechat-publisher/markdown';
import { loadSrc } from './helpers/load-src.mjs';

const { upsertFrontmatter } = await loadSrc('frontmatter.ts');

// The note that got corrupted: a real bundle translation with several keys.
const NOTE = `---
title: 杨梅随笔
description: 杨梅主产于中国东南，成熟于盛夏，果实呈褐红色圆形。
date: none
createdAt: none
provenance: original
link: none
---

杨梅正文。
`;

test('a new key joins the existing block instead of starting a second one', () => {
  const result = upsertFrontmatter(NOTE, { author: 'tester' });
  assert.equal(result, NOTE.replace('link: none\n---', 'link: none\nauthor: tester\n---'));
  assert.equal(result.match(/^---$/gm).length, 2);
});

test('an existing key is replaced in place', () => {
  const result = upsertFrontmatter(NOTE, { title: '杨梅随笔（修订）' });
  assert.match(result, /^title: 杨梅随笔（修订）$/m);
  assert.doesNotMatch(result, /杨梅随笔\n/);
  assert.equal(result.match(/^---$/gm).length, 2);
});

test('a note without frontmatter gets one', () => {
  assert.equal(upsertFrontmatter('正文。\n', { title: '标题' }), '---\ntitle: 标题\n---\n\n正文。\n');
});

// The real requirement is not a particular quoting style but that YAML reads back what we wrote.
test('awkward values survive a round trip through the YAML parser', () => {
  const nasty = {
    title: '标题: 副标题',
    description: '#1 的故事，含 "引号" 与 \\ 反斜杠',
    author: 'a "b"',
    cover: 'images/cover.jpg',
  };
  const { frontmatter } = parseFrontmatter(upsertFrontmatter(NOTE, nasty));
  for (const [key, value] of Object.entries(nasty)) assert.equal(frontmatter[key], value, key);
  assert.equal(frontmatter.link, 'none');
});

test('a plain path is left unquoted', () => {
  assert.match(upsertFrontmatter(NOTE, { cover: 'images/cover.jpg' }), /^cover: images\/cover\.jpg$/m);
});

test('empty values are ignored, and so is an empty addition set', () => {
  assert.equal(upsertFrontmatter(NOTE, { author: '' }), NOTE);
  assert.equal(upsertFrontmatter(NOTE, {}), NOTE);
});

test('CRLF notes keep their line endings', () => {
  const crlf = '---\r\ntitle: T\r\n---\r\n\r\n正文。\r\n';
  assert.equal(upsertFrontmatter(crlf, { author: 'a' }), '---\r\ntitle: T\nauthor: a\r\n---\r\n\r\n正文。\r\n');
});

test('a byte-order mark does not hide the frontmatter', () => {
  const result = upsertFrontmatter('\ufeff---\ntitle: T\n---\n\n正文。\n', { author: 'tester' });
  assert.equal(result, '\ufeff---\ntitle: T\nauthor: tester\n---\n\n正文。\n');
});

// A title is text even when it reads like something else. YAML would otherwise turn `no` into
// false, `2024-01-01` into a date and `007` into a number.
test('values YAML would reinterpret stay strings', () => {
  const values = { title: 'no', description: '2024-01-01', author: '007', cover: 'true' };
  const { frontmatter } = parseFrontmatter(upsertFrontmatter(NOTE, values));
  for (const [key, value] of Object.entries(values)) assert.strictEqual(frontmatter[key], value, key);
});

// The merge is checked against the parser that decides what gets published; anything that would
// not read back as intended is refused rather than written to the note.
test('a merge that would not read back is refused', () => {
  assert.throws(() => upsertFrontmatter(NOTE, { 'a: b': 'x' }));
});

test('the body is never touched, even when it contains a --- rule', () => {
  const withRule = `${NOTE}\n---\n\n后记。\n`;
  const result = upsertFrontmatter(withRule, { author: 'tester' });
  assert.ok(result.endsWith('\n---\n\n后记。\n'));
  assert.match(result, /^author: tester$/m);
});
