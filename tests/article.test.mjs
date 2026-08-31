import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSrc } from './helpers/load-src.mjs';

const { extractImageSources, prepareArticle, rewriteWikiImageEmbeds } = await loadSrc('article.ts');

test('wiki image embeds become standard Markdown images', () => {
  assert.equal(rewriteWikiImageEmbeds('![[photo.jpg]]'), '![](photo.jpg)');
  assert.equal(rewriteWikiImageEmbeds('![[dir/a b.png|说明]]'), '![说明](dir/a%20b.png)');
  // A numeric alias is Obsidian's display width, not a caption.
  assert.equal(rewriteWikiImageEmbeds('![[photo.jpg|400]]'), '![](photo.jpg)');
});

test('code keeps its literal text', () => {
  const fenced = '```md\n![[photo.jpg]]\n```\n\n![[real.jpg]]\n';
  assert.equal(rewriteWikiImageEmbeds(fenced), '```md\n![[photo.jpg]]\n```\n\n![](real.jpg)\n');
  assert.equal(rewriteWikiImageEmbeds('用 `![[photo.jpg]]` 插入'), '用 `![[photo.jpg]]` 插入');
});

test('frontmatter is left alone', () => {
  const source = '---\ncover: "![[cover.jpg]]"\n---\n\n![[body.jpg]]\n';
  assert.equal(rewriteWikiImageEmbeds(source), '---\ncover: "![[cover.jpg]]"\n---\n\n![](body.jpg)\n');
});

test('image sources are extracted once, under either quote style', () => {
  const html = `<img src="a.jpg"><img src='b.jpg'><img alt="x" src="a.jpg">`;
  assert.deepEqual(extractImageSources(html), ['a.jpg', 'b.jpg']);
});

const article = (body) => `---\ntitle: 标题\ndescription: 摘要\ncover: cover.jpg\n---\n\n${body}\n`;

test('prepareArticle collects metadata and body images', async () => {
  const prepared = await prepareArticle(article('正文。\n\n![[photo.jpg]]'), { author: '默认作者' });
  assert.equal(prepared.title, '标题');
  assert.equal(prepared.digest, '摘要');
  assert.equal(prepared.author, '默认作者');
  assert.equal(prepared.cover, 'cover.jpg');
  assert.equal(prepared.lang, 'zh');
  assert.deepEqual(prepared.imageSources, ['photo.jpg']);
});

test('a missing title or digest is left empty for the confirmation dialog to ask about', async () => {
  const prepared = await prepareArticle('---\ntitle: 只有标题\n---\n\n正文。\n', { author: '' });
  assert.equal(prepared.title, '只有标题');
  assert.equal(prepared.digest, '');
});

test('lang selects the typography preset', async () => {
  const zh = await prepareArticle(article('正文。'), { author: '' });
  const en = await prepareArticle(`---\ntitle: T\ndescription: D\nlang: en\n---\n\nBody.\n`, { author: '' });
  assert.match(zh.html, /text-align:justify/);
  assert.doesNotMatch(en.html, /text-align:justify/);
});

const { imagePathCandidates, joinVaultPath } = await loadSrc('article.ts');

test('relative references resolve against the note folder', () => {
  assert.deepEqual(imagePathCandidates('文章/游记.md', './images/01.jpg'), ['文章/images/01.jpg', 'images/01.jpg']);
  assert.deepEqual(imagePathCandidates('文章/游记.md', '../assets/01.jpg'), ['assets/01.jpg']);
  assert.deepEqual(imagePathCandidates('文章/游记.md', 'images/01.jpg'), ['文章/images/01.jpg', 'images/01.jpg']);
  assert.deepEqual(imagePathCandidates('游记.md', './01.jpg'), ['01.jpg']);
});

test('a leading slash means the vault root', () => {
  assert.deepEqual(imagePathCandidates('文章/游记.md', '/images/01.jpg'), ['images/01.jpg']);
});

test('percent-encoded and wiki references are decoded first', () => {
  assert.deepEqual(imagePathCandidates('a/b.md', './images/my%20photo.jpg'), ['a/images/my photo.jpg', 'images/my photo.jpg']);
  assert.deepEqual(imagePathCandidates('a/b.md', '[[images/01.jpg]]'), ['a/images/01.jpg', 'images/01.jpg']);
});

test('joinVaultPath cannot climb above the vault root', () => {
  assert.equal(joinVaultPath('a', '../../../x.jpg'), 'x.jpg');
});
