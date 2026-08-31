/**
 * Frontmatter editing as a text transformation.
 *
 * Obsidian's `processFrontMatter` locates the existing block through the metadata cache, and when
 * that cache does not yet know the file it prepends a second block instead of editing the first —
 * corrupting the note. Doing the merge on the file's own text has no such dependency, and it is
 * ordinary string handling that can be tested directly.
 */

const DELIMITER = /^(---\r?\n)([\s\S]*?)(\r?\n)(---|\.\.\.)([ \t]*)(\r?\n|$)/;

/** YAML plain scalars cannot start with an indicator or contain ': ', so quote when in doubt. */
function yamlValue(value: string): string {
  const safe = /^[^\s"'#&*!|>%@`{}[\],:?-][^:#]*$/.test(value) && !/\s$/.test(value);
  return safe ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const keyPattern = (key: string): RegExp =>
  new RegExp(`^(${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[ \\t]*:)([ \\t]*)(.*)$`, 'm');

/**
 * Add or replace top-level keys in a note's frontmatter, creating the block when there is none.
 * Keys already present keep their position; new ones are appended just inside the block.
 */
export function upsertFrontmatter(source: string, additions: Record<string, string>): string {
  const entries = Object.entries(additions).filter(([, value]) => value !== '');
  if (entries.length === 0) return source;

  const match = DELIMITER.exec(source);
  if (!match) {
    const block = entries.map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
    return `---\n${block}\n---\n\n${source.replace(/^\s*\n/, '')}`;
  }

  const [, open, body, beforeClose, close, closePadding, afterClose] = match;
  let updated = body ?? '';
  const appended: string[] = [];
  for (const [key, value] of entries) {
    const line = `${key}: ${yamlValue(value)}`;
    const existing = keyPattern(key);
    if (existing.test(updated)) updated = updated.replace(existing, line);
    else appended.push(line);
  }
  if (appended.length) updated = updated ? `${updated}\n${appended.join('\n')}` : appended.join('\n');

  return `${open}${updated}${beforeClose}${close}${closePadding}${afterClose}${source.slice(match[0].length)}`;
}
