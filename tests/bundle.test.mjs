import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSrc } from './helpers/load-src.mjs';

const { bundleLang, conventionalCoverPaths, mergeFrontmatter } = await loadSrc('bundle.ts');
const { prepareArticle } = await loadSrc('article.ts');

test('a translation is recognised only by a language it knows', () => {
  assert.equal(bundleLang('zh'), 'zh');
  assert.equal(bundleLang('EN'), 'en');
  assert.equal(bundleLang('notes'), undefined);
  assert.equal(bundleLang('index'), undefined);
});

test('the translation always outranks the shared index', () => {
  assert.deepEqual(
    mergeFrontmatter({ cover: './images/cover.jpg', author: '共享作者' }, { title: '中文标题', author: '中文作者' }),
    { cover: './images/cover.jpg', author: '中文作者', title: '中文标题' },
  );
});

test('a bundle keeps its cover under images/', () => {
  assert.deepEqual(conventionalCoverPaths('文章/游记'), [
    '文章/游记/images/cover.jpg',
    '文章/游记/images/cover.jpeg',
    '文章/游记/images/cover.png',
    '文章/游记/images/cover.webp',
    '文章/游记/images/cover.avif',
  ]);
  assert.deepEqual(conventionalCoverPaths('')[0], 'images/cover.jpg');
});

test('shared frontmatter fills the gaps in a translation', async () => {
  const zh = '---\ntitle: 一篇双语文章\ndescription: 演示 bundle 形态。\n---\n\n这是中文版本。\n';
  const prepared = await prepareArticle(zh, {
    author: '设置里的作者',
    shared: { cover: './images/cover.jpg', author: '共享作者' },
    lang: 'zh',
  });
  assert.equal(prepared.title, '一篇双语文章');
  assert.equal(prepared.cover, './images/cover.jpg');
  assert.equal(prepared.author, '共享作者');
  assert.equal(prepared.lang, 'zh');
});

test('the filename outranks a stale lang in frontmatter', async () => {
  const en = '---\ntitle: A bilingual article\ndescription: Demo.\nlang: zh\n---\n\nEnglish body.\n';
  const prepared = await prepareArticle(en, { author: '', shared: {}, lang: 'en' });
  assert.equal(prepared.lang, 'en');
  assert.doesNotMatch(prepared.html, /text-align:justify/);
});
