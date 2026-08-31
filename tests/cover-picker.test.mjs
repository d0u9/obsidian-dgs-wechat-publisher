import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSrc } from './helpers/load-src.mjs';

globalThis.window = globalThis;
const { chooseCover } = await loadSrc('ui.ts');

const openModal = () => {
  globalThis.__openModals = [];
  const chosen = chooseCover({}, [{ file: { path: 'a.jpg' }, label: '正文图片' }]);
  return { chosen, modal: globalThis.__openModals[0] };
};

// Obsidian's SuggestModal closes before it reports the choice, so onClose runs first even when an
// item was picked. Treating that close as a cancellation lost the selection.
test('a picked cover survives onClose running first', async () => {
  const { chosen, modal } = openModal();
  modal.onClose();
  modal.onChooseItem({ file: { path: 'a.jpg' }, label: '正文图片' });
  assert.deepEqual(await chosen, { path: 'a.jpg' });
});

test('a picked cover survives the other order too', async () => {
  const { chosen, modal } = openModal();
  modal.onChooseItem({ file: { path: 'a.jpg' }, label: '正文图片' });
  modal.onClose();
  assert.deepEqual(await chosen, { path: 'a.jpg' });
});

test('closing without choosing still cancels', async () => {
  const { chosen, modal } = openModal();
  modal.onClose();
  assert.equal(await chosen, null);
});
