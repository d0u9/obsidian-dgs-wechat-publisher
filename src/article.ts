import { MetadataCache, normalizePath, TFile, Vault } from 'obsidian';
import { assertSelfContained, renderMarkdown } from 'dgs-wechat-publisher/markdown';
import { wechatPublisher } from 'dgs-wechat-publisher/converter';

export interface ArticleMetadata {
  title: string;
  digest: string;
  author: string;
  cover: string;
  lang: 'zh' | 'en';
}

export interface PreparedArticle extends ArticleMetadata {
  html: string;
  imageSources: string[];
}

const scalar = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

export const isRemoteSource = (value: string): boolean => /^https?:\/\//i.test(value.trim());

function cleanObsidianLink(value: string): string {
  let cleaned = value.trim();
  const wiki = /^!?\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/.exec(cleaned);
  if (wiki?.[1]) cleaned = wiki[1].trim();
  try { cleaned = decodeURIComponent(cleaned); } catch { /* Keep the authored value. */ }
  // A trailing #heading or ?query is Obsidian link syntax; a '#' inside a filename is not, so only
  // strip a fragment that cannot itself be part of the extension.
  return cleaned.replace(/[#?][^/#?]*$/, (tail) => /\.[a-z0-9]+$/i.test(cleaned.slice(0, -tail.length)) ? '' : tail).trim();
}

/** Split a leading YAML frontmatter block off, so its own syntax is never rewritten as body text. */
function splitFrontmatter(source: string): { frontmatter: string; body: string } {
  const match = /^(---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$))/.exec(source);
  if (!match?.[1]) return { frontmatter: '', body: source };
  return { frontmatter: match[1], body: source.slice(match[1].length) };
}

const WIKI_EMBED = /!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function rewriteLine(line: string): string {
  // Inline code spans keep their literal text: a tutorial may show `![[photo.png]]` on purpose.
  return line.split(/(`+[^`]*`+)/).map((part, index) => index % 2 === 1 ? part : part.replace(
    WIKI_EMBED,
    (_all, link: string, alias?: string) => {
      const alt = alias && !/^\d+$/.test(alias.trim()) ? alias.trim() : '';
      return `![${alt}](${encodeURI(link.trim())})`;
    },
  )).join('');
}

export function rewriteWikiImageEmbeds(source: string): string {
  const { frontmatter, body } = splitFrontmatter(source);
  let fence: string | null = null;
  const lines = body.split('\n').map((line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return line;
    }
    if (marker) { fence = marker; return line; }
    return rewriteLine(line);
  });
  return frontmatter + lines.join('\n');
}

export function extractImageSources(html: string): string[] {
  const sources = [...html.matchAll(/<img\b[^>]*?\bsrc=(?:"([^"]*)"|'([^']*)')/gi)]
    .map((match) => match[1] ?? match[2] ?? '')
    .filter((source) => source.length > 0);
  return [...new Set(sources)];
}

export interface ArticleContext {
  author: string;
  /** Frontmatter shared by every translation of a bundle; the article's own always wins. */
  shared?: Record<string, unknown>;
  /** Language implied by a bundle translation's filename, which outranks frontmatter. */
  lang?: 'zh' | 'en';
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Swap one <img src> value, whichever quote style the renderer emitted. */
export function replaceImageSource(html: string, source: string, replacement: string): string {
  return html.replace(
    new RegExp(`(<img\\b[^>]*?\\bsrc=)(["'])${escapeRegExp(source)}\\2`, 'gi'),
    (_all, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`,
  );
}

export async function prepareArticle(
  source: string,
  context: ArticleContext,
): Promise<PreparedArticle> {
  const { frontmatter: own, html: renderedHtml } = await renderMarkdown(rewriteWikiImageEmbeds(source));
  const frontmatter = { ...context.shared, ...own };
  const lang = context.lang ?? (scalar(frontmatter.lang) === 'en' ? 'en' : 'zh');
  // `lang` only picks a typography preset (line height, tracking, justification); the Markdown
  // itself renders the same either way, so one render feeds both languages.
  const html = wechatPublisher.toWechatHtml(renderedHtml, { lang });
  assertSelfContained(html);

  // A missing title or digest is not fatal here: the confirmation dialog asks for them, the same
  // way it asks for a missing cover. Only publishing actually requires them.
  const metadata: ArticleMetadata = {
    title: scalar(frontmatter.title),
    digest: scalar(frontmatter.description) || scalar(frontmatter.digest),
    author: scalar(frontmatter.author) || context.author.trim(),
    cover: scalar(frontmatter.cover),
    lang,
  };

  return { ...metadata, html, imageSources: extractImageSources(html) };
}

/**
 * Join a vault-relative reference onto the folder it was written in, resolving `.` and `..`.
 * `normalizePath` collapses slashes but leaves those segments alone, so `./images/01.jpg` would
 * otherwise be looked up literally and never found.
 */
export function joinVaultPath(baseDir: string, target: string): string {
  const fromRoot = target.startsWith('/');
  const segments = (fromRoot ? target : `${baseDir}/${target}`).split('/');
  const parts: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { parts.pop(); continue; }
    parts.push(segment);
  }
  return parts.join('/');
}

/** Every vault path a written reference could plausibly mean, best guess first. */
export function imagePathCandidates(notePath: string, source: string): string[] {
  const decoded = cleanObsidianLink(source);
  if (!decoded) return [];
  const baseDir = notePath.includes('/') ? notePath.slice(0, notePath.lastIndexOf('/')) : '';
  return [...new Set([
    joinVaultPath(baseDir, decoded),  // relative to the note, the usual case
    joinVaultPath('', decoded),       // relative to the vault root
  ])].filter(Boolean);
}

export function resolveVaultImage(vault: Vault, metadataCache: MetadataCache, note: TFile, source: string): TFile {
  const decoded = cleanObsidianLink(source);
  const resolved = metadataCache.getFirstLinkpathDest(decoded, note.path);
  if (resolved instanceof TFile) return resolved;

  for (const candidate of imagePathCandidates(note.path, source)) {
    const file = vault.getAbstractFileByPath(normalizePath(candidate));
    if (file instanceof TFile) return file;
  }

  // `getFirstLinkpathDest` above already resolves a bare filename the way Obsidian's own links do,
  // so there is nothing a scan of every file in the vault would find that it did not.
  throw new Error(`找不到图片“${decoded}”（来自 ${note.path}）。请检查链接或用 ![[图片文件名]] 重新插入。`);
}
