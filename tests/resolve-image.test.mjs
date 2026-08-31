import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSrc } from './helpers/load-src.mjs';

const { resolveVaultImage } = await loadSrc('article.ts');
const { TFile } = globalThis.__obsidian;

/** A vault holding exactly the given paths, resolving them the way Obsidian does. */
function fakeVault(paths) {
  const files = new Map(paths.map((path) => {
    const file = Object.assign(Object.create(TFile.prototype), {
      path,
      name: path.split('/').pop(),
      extension: path.split('.').pop(),
      basename: path.split('/').pop().replace(/\.[^.]*$/, ''),
    });
    return [path, file];
  }));
  const vault = { getAbstractFileByPath: (path) => files.get(path) ?? null };
  // getFirstLinkpathDest resolves a bare name anywhere in the vault, as Obsidian's links do.
  const metadataCache = {
    getFirstLinkpathDest: (link) => files.get(link)
      ?? [...files.values()].find((file) => file.name === link || file.basename === link)
      ?? null,
  };
  return { vault, metadataCache, files };
}

const noteIn = (path) => ({ path, parent: { path: path.slice(0, path.lastIndexOf('/')) } });

test('a wiki embed resolves by name from anywhere in the vault', () => {
  const { vault, metadataCache, files } = fakeVault(['assets/photo.jpg']);
  const note = noteIn('文章/游记.md');
  assert.equal(resolveVaultImage(vault, metadataCache, note, 'photo.jpg'), files.get('assets/photo.jpg'));
  assert.equal(resolveVaultImage(vault, metadataCache, note, '[[photo.jpg]]'), files.get('assets/photo.jpg'));
});

test('a relative reference resolves against the note folder before the vault root', () => {
  const { vault, metadataCache, files } = fakeVault(['文章/images/01.jpg', 'images/01.jpg']);
  const note = noteIn('文章/游记.md');
  assert.equal(resolveVaultImage(vault, metadataCache, note, './images/01.jpg'), files.get('文章/images/01.jpg'));
});

test('a vault-root reference resolves there even when the note folder has the same name', () => {
  const { vault, metadataCache, files } = fakeVault(['文章/images/01.jpg', 'images/01.jpg']);
  const note = noteIn('文章/游记.md');
  assert.equal(resolveVaultImage(vault, metadataCache, note, '/images/01.jpg'), files.get('images/01.jpg'));
});

test('.. climbs out of the note folder', () => {
  const { vault, metadataCache, files } = fakeVault(['assets/01.jpg']);
  const note = noteIn('文章/游记.md');
  assert.equal(resolveVaultImage(vault, metadataCache, note, '../assets/01.jpg'), files.get('assets/01.jpg'));
});

test('a percent-encoded name is decoded before lookup', () => {
  const { vault, metadataCache, files } = fakeVault(['文章/my photo.jpg']);
  const note = noteIn('文章/游记.md');
  assert.equal(resolveVaultImage(vault, metadataCache, note, './my%20photo.jpg'), files.get('文章/my photo.jpg'));
});

test('an image that is nowhere gives an error naming the note', () => {
  const { vault, metadataCache } = fakeVault(['文章/images/01.jpg']);
  const note = noteIn('文章/游记.md');
  assert.throws(
    () => resolveVaultImage(vault, metadataCache, note, './images/missing.jpg'),
    /找不到图片.*missing\.jpg.*文章\/游记\.md/s,
  );
});
