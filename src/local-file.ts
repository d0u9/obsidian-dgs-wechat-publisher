import { FileSystemAdapter } from 'obsidian';

/**
 * Reading the one file that lives outside the vault — the credentials `.env`.
 *
 * Obsidian's own `FileSystemAdapter.readLocalFile` does this, so the plugin imports no Node
 * filesystem module at all. Everything else here is path arithmetic on strings.
 */

/** `~` is the shell's, not the filesystem's, so it has to be expanded before anything else. */
function homeDirectory(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? '';
}

export function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '~') return homeDirectory();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const home = homeDirectory();
    return home ? `${home}/${trimmed.slice(2)}` : trimmed;
  }
  return trimmed;
}

/** A POSIX root, or a Windows drive or UNC path. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

export async function readLocalTextFile(path: string): Promise<string> {
  const bytes = await FileSystemAdapter.readLocalFile(path);
  return new TextDecoder('utf-8').decode(bytes);
}

/** Whatever the platform calls "no such file", without leaning on Node's error typings. */
export function isFileNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return code === 'ENOENT' || (typeof message === 'string' && message.includes('ENOENT'));
}
