/**
 * Every Node API this plugin touches, behind explicit signatures.
 *
 * Reading the credentials file is the one thing the vault API cannot do — the file lives outside
 * the vault on purpose — so `node:fs` is unavoidable. Keeping it to this module means the rest of
 * the plugin stays ordinary typed TypeScript, and a reader auditing what the plugin does to the
 * filesystem has exactly one short file to read. The signatures these imports rely on are declared
 * in types.d.ts, so this stays typed with or without @types/node installed.
 */

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export function homeDirectory(): string {
  return homedir();
}

export function resolvePath(...segments: string[]): string {
  return resolve(...segments);
}

export function isAbsolutePath(path: string): boolean {
  return isAbsolute(path);
}

export async function readTextFile(path: string): Promise<string> {
  return readFile(path, 'utf8');
}

/** `error.code === 'ENOENT'`, without leaning on Node's error typings. */
export function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === 'ENOENT';
}
