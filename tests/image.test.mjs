import assert from 'node:assert/strict';
import test from 'node:test';
import { loadSrc } from './helpers/load-src.mjs';

const { sniffImageKind } = await loadSrc('image.ts');

const bytes = (...values) => new Uint8Array([...values, ...Array(16).fill(0)]).buffer;

test('image formats are read from the magic bytes, not the filename', () => {
  assert.equal(sniffImageKind(bytes(0xff, 0xd8, 0xff, 0xe0)), 'jpeg');
  assert.equal(sniffImageKind(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), 'png');
  assert.equal(sniffImageKind(bytes(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)), 'gif');
  assert.equal(sniffImageKind(new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  ]).buffer), 'webp');
  assert.equal(sniffImageKind(bytes(0x00, 0x01, 0x02, 0x03)), 'unknown');
});

test('a truncated file does not throw', () => {
  assert.equal(sniffImageKind(new Uint8Array([0xff, 0xd8]).buffer), 'unknown');
});
