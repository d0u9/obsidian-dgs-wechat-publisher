/**
 * Frontmatter editing as a text transformation.
 *
 * Obsidian's `processFrontMatter` locates the existing block through the metadata cache, and when
 * that cache does not yet know the file it prepends a second block instead of editing the first —
 * corrupting the note. Doing the merge on the file's own text has no such dependency, and it is
 * ordinary string handling that can be tested directly.
 */
import { parseFrontmatter } from 'dgs-wechat-publisher/markdown';

// Deliberately the same shape as the base library's own frontmatter regex, including the optional
// BOM: whatever it treats as frontmatter is what gets published, so an edit must not disagree with
// it. `---\n---` is not frontmatter to either of us — it has no newline before the closing marker.
const DELIMITER = /^(\ufeff?---\r?\n)([\s\S]*?)(\r?\n)(---)([ \t]*)(\r?\n|$)/;

// Words and shapes YAML reads as something other than text: `no` is false, `2024-01-01` is a date,
// `007` is a number. A title is always a string, so these have to be quoted to stay one.
const YAML_KEYWORD = /^(y|n|yes|no|true|false|on|off|null|~)$/i;
const YAML_NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?([eE][-+]?\d+)?|\.\d+|0[xob][\da-fA-F_]+)$/;
const YAML_DATE = /^\d{4}-\d{1,2}-\d{1,2}([T ].*)?$/;

/** YAML plain scalars cannot start with an indicator or contain ': ', so quote when in doubt. */
function yamlValue(value: string): string {
  const plain = /^[^\s"'#&*!|>%@`{}[\],:?-][^:#]*$/.test(value) && !/\s$/.test(value);
  const reinterpreted = YAML_KEYWORD.test(value) || YAML_NUMBER.test(value) || YAML_DATE.test(value);
  return plain && !reinterpreted ? value : `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

const keyPattern = (key: string): RegExp =>
  new RegExp(`^(${key.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}[ \\t]*:)([ \\t]*)(.*)$`, 'm');

/**
 * Add or replace top-level keys in a note's frontmatter, creating the block when there is none.
 * Keys already present keep their position; new ones are appended just inside the block.
 */
/**
 * Refuse to hand back anything that does not read as intended. Writing a note is destructive, and a
 * merge that went wrong must not reach the file — better to skip the write and say so.
 */
function verified(result: string, source: string, additions: Record<string, string>): string {
  const { frontmatter, content } = parseFrontmatter(result);
  for (const [key, value] of Object.entries(additions)) {
    if (value !== '' && frontmatter[key] !== value) throw new Error(`frontmatter 合并结果不含 ${key}，已放弃写入。`);
  }
  if (content !== parseFrontmatter(source).content) throw new Error('frontmatter 合并会改动正文，已放弃写入。');
  return result;
}

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
  // An empty block has nothing before its closing marker; added lines need that newline back.
  let separator = beforeClose ?? '';
  const appended: string[] = [];
  for (const [key, value] of entries) {
    const line = `${key}: ${yamlValue(value)}`;
    const existing = keyPattern(key);
    if (existing.test(updated)) updated = updated.replace(existing, line);
    else appended.push(line);
  }
  if (appended.length) updated = updated ? `${updated}\n${appended.join('\n')}` : appended.join('\n');
  if (updated && !separator) separator = '\n';

  const result = `${open}${updated}${separator}${close}${closePadding}${afterClose}${source.slice(match[0].length)}`;
  return verified(result, source, additions);
}
