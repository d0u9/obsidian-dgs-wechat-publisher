import { App, TFile, TFolder } from 'obsidian';
import { joinVaultPath } from './article';

/**
 * An article can live as a folder rather than a single note:
 *
 *   my-article/
 *   ├── index.md      shared, language-independent frontmatter — the cover in particular
 *   ├── zh.md         title and description, which are per-language by nature
 *   ├── en.md
 *   └── images/
 *       └── cover.jpg
 *
 * The layout mirrors the base library's bundles, so the same folder publishes from either the CLI
 * or this plugin. Nothing here is required: a lone note declaring its own cover works as before.
 */
export const BUNDLE_INDEX = 'index.md';

const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'avif'];
const KNOWN_LANGS = new Set(['zh', 'en']);

export const isBundleIndex = (file: TFile): boolean => file.name.toLocaleLowerCase() === BUNDLE_INDEX;

/** A translation names itself after its language, but `notes.md` in a folder is just a filename. */
export function bundleLang(basename: string): 'zh' | 'en' | undefined {
  const name = basename.toLocaleLowerCase();
  return KNOWN_LANGS.has(name) ? name as 'zh' | 'en' : undefined;
}

/** The shared frontmatter never wins: a translation may override anything it names itself. */
export function mergeFrontmatter(
  shared: Record<string, unknown>,
  own: Record<string, unknown>,
): Record<string, unknown> {
  return { ...shared, ...own };
}

/** Where a bundle keeps its cover when no frontmatter names one. */
export function conventionalCoverPaths(baseDir: string): string[] {
  return COVER_EXTENSIONS.map((extension) => joinVaultPath(baseDir, `images/cover.${extension}`));
}

/** Every `*.md` in the folder except the shared index, in a stable order. */
export function listTranslations(folder: TFolder): TFile[] {
  return folder.children
    .filter((child): child is TFile => child instanceof TFile && child.extension.toLocaleLowerCase() === 'md')
    .filter((file) => !isBundleIndex(file))
    .sort((a, b) => a.basename.localeCompare(b.basename));
}

export interface ResolvedBundle {
  /** The note that actually carries the article body. */
  file: TFile;
  /** Folder the article's relative references resolve against. */
  baseDir: string;
  /** Frontmatter shared by every translation, from `index.md`. */
  shared: Record<string, unknown>;
  /** Language implied by the translation's filename, if any. */
  lang?: 'zh' | 'en';
  isBundle: boolean;
}

function readFrontmatter(app: App, file: TFile | null): Record<string, unknown> {
  if (!file) return {};
  return { ...app.metadataCache.getFileCache(file)?.frontmatter } as Record<string, unknown>;
}

function indexOf(folder: TFolder | null): TFile | null {
  const child = folder?.children.find((entry) => entry instanceof TFile && isBundleIndex(entry));
  return child instanceof TFile ? child : null;
}

/**
 * Work out which note to publish and what it shares with its siblings. Running the command on a
 * translation picks up the `index.md` beside it; running it on the index itself has to ask which
 * translation is meant, which is what `chooseTranslation` is for.
 */
export async function resolveBundle(
  app: App,
  note: TFile,
  chooseTranslation: (translations: TFile[]) => Promise<TFile | null>,
): Promise<ResolvedBundle | null> {
  const folder = note.parent;
  const baseDir = folder?.path === '/' ? '' : folder?.path ?? '';

  if (!isBundleIndex(note)) {
    const index = indexOf(folder);
    return {
      file: note,
      baseDir,
      shared: readFrontmatter(app, index),
      lang: index ? bundleLang(note.basename) : undefined,
      isBundle: Boolean(index),
    };
  }

  // The index carries no body worth publishing, so it stands for the bundle as a whole.
  const translations = folder ? listTranslations(folder) : [];
  if (translations.length === 0) throw new Error(`${note.path} 是 bundle 的 index.md，但同目录下没有可发布的译本。`);
  const chosen = translations.length === 1 ? translations[0]! : await chooseTranslation(translations);
  if (!chosen) return null;
  return {
    file: chosen,
    baseDir,
    shared: readFrontmatter(app, note),
    lang: bundleLang(chosen.basename),
    isBundle: true,
  };
}
