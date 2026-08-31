import { App, ButtonComponent, FuzzyMatch, FuzzySuggestModal, Modal, Setting, TFile } from 'obsidian';

export const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp']);

export interface CoverCandidate {
  file: TFile;
  /** Why this image is being offered — shown in the list and searchable. */
  label: string;
}

class CoverSuggestModal extends FuzzySuggestModal<CoverCandidate> {
  private settled = false;

  constructor(app: App, private readonly candidates: CoverCandidate[], private readonly done: (file: TFile | null) => void) {
    super(app);
    this.setPlaceholder('选择公众号封面图片…');
  }

  getItems(): CoverCandidate[] {
    return this.candidates;
  }

  getItemText(candidate: CoverCandidate): string {
    return `${candidate.label} · ${candidate.file.path}`;
  }

  /**
   * A path is not enough to recognise a photograph, so each row carries the picture itself.
   * `getResourcePath` hands back an app:// URL the renderer can show without reading the file.
   */
  renderSuggestion(match: FuzzyMatch<CoverCandidate>, el: HTMLElement): void {
    const { file, label } = match.item;
    el.addClass('dgs-wechat-cover-suggestion');
    const thumbnail = el.createEl('img', { cls: 'dgs-wechat-cover-thumb', attr: { src: this.app.vault.getResourcePath(file), alt: '', width: 72, height: 40 } });
    thumbnail.addEventListener('error', () => thumbnail.addClass('is-missing'));
    const text = el.createDiv({ cls: 'dgs-wechat-cover-text' });
    text.createDiv({ cls: 'dgs-wechat-cover-name', text: file.name });
    text.createDiv({ cls: 'dgs-wechat-cover-meta', text: `${label} · ${file.parent?.path || '/'}` });
  }

  onChooseItem(candidate: CoverCandidate): void {
    this.settle(candidate.file);
  }

  onClose(): void {
    // SuggestModal closes *before* it reports the choice, so onClose always runs first — even when
    // an item was picked. Give onChooseItem its turn before treating the close as a cancellation.
    window.setTimeout(() => this.settle(null), 0);
    super.onClose();
  }

  private settle(file: TFile | null): void {
    if (this.settled) return;
    this.settled = true;
    this.done(file);
  }
}

/**
 * Ask for a cover. The candidates arrive already ordered — the note's own pictures first — so the
 * usual answer is the top row and no typing is needed.
 */
export function chooseCover(app: App, candidates: CoverCandidate[]): Promise<TFile | null> {
  return new Promise((resolve) => new CoverSuggestModal(app, candidates, resolve).open());
}

class TranslationSuggestModal extends FuzzySuggestModal<TFile> {
  private settled = false;

  constructor(app: App, private readonly translations: TFile[], private readonly done: (file: TFile | null) => void) {
    super(app);
    this.setPlaceholder('这个 bundle 有多个译本，选择要发布的一个…');
  }

  getItems(): TFile[] { return this.translations; }

  getItemText(file: TFile): string { return file.basename; }

  onChooseItem(file: TFile): void { this.settle(file); }

  onClose(): void {
    // Same ordering as the cover picker: the close arrives before the choice does.
    window.setTimeout(() => this.settle(null), 0);
    super.onClose();
  }

  private settle(file: TFile | null): void {
    if (this.settled) return;
    this.settled = true;
    this.done(file);
  }
}

export function chooseTranslation(app: App, translations: TFile[]): Promise<TFile | null> {
  return new Promise((resolve) => new TranslationSuggestModal(app, translations, resolve).open());
}

export class PreviewModal extends Modal {
  constructor(app: App, private readonly title: string, private readonly html: string) { super(app); }

  onOpen(): void {
    this.setTitle(`微信预览：${this.title}`);
    this.modalEl.addClass('dgs-wechat-preview-modal');
    const frame = this.contentEl.createEl('iframe', { attr: { title: '微信公众号文章预览' } });
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body>${this.html}</body></html>`;
  }
}

export interface DraftSummary {
  title: string;
  digest: string;
  author: string;
  cover: string;
  /** Displayable URL for the cover, so the last gate shows the picture and not just its path. */
  coverUrl: string;
  imageCount: number;
}

/** What the author confirmed, including anything they typed in to fill a gap. */
export interface DraftDecision {
  title: string;
  digest: string;
  author: string;
}

// WeChat's own limits for a draft.
const TITLE_LIMIT = 64;
const DIGEST_LIMIT = 120;
const AUTHOR_LIMIT = 8;

class ConfirmDraftModal extends Modal {
  private settled = false;
  private title: string;
  private digest: string;
  private author: string;
  private submit: ButtonComponent | null = null;
  private focused = false;

  constructor(app: App, private readonly summary: DraftSummary, private readonly done: (decision: DraftDecision | null) => void) {
    super(app);
    this.title = summary.title;
    this.digest = summary.digest;
    this.author = summary.author;
  }

  private row(parent: HTMLElement, label: string, build: (value: HTMLElement) => void): void {
    parent.createDiv({ cls: 'dgs-wechat-summary-label', text: label });
    build(parent.createDiv({ cls: 'dgs-wechat-summary-value' }));
  }

  /**
   * Frontmatter is the normal place for a title or digest, but a note that lacks one should not
   * have to be edited and re-run: ask for it here, where the author is already confirming.
   */
  private prompt(parent: HTMLElement, label: string, options: { placeholder: string; limit: number; multiline?: boolean; onChange: (value: string) => void }): void {
    this.row(parent, label, (value) => {
      const input = options.multiline
        ? value.createEl('textarea', { cls: 'dgs-wechat-summary-input', attr: { rows: 3, maxlength: options.limit, placeholder: options.placeholder } })
        : value.createEl('input', { cls: 'dgs-wechat-summary-input', attr: { type: 'text', maxlength: options.limit, placeholder: options.placeholder } });
      const counter = value.createDiv({ cls: 'dgs-wechat-summary-path', text: `0/${options.limit}` });
      input.addEventListener('input', () => {
        const text = input.value.trim();
        counter.setText(`${input.value.length}/${options.limit}`);
        options.onChange(text);
        this.refresh();
      });
      if (!options.multiline) {
        input.addEventListener('keydown', (event: KeyboardEvent) => {
          if (event.key === 'Enter' && this.title && this.digest) { event.preventDefault(); this.finish(true); }
        });
      }
      // Only the first gap takes focus; a later one would yank the cursor out of it.
      if (!this.focused) {
        this.focused = true;
        window.setTimeout(() => input.focus(), 0);
      }
    });
  }

  private refresh(): void {
    this.submit?.setDisabled(!this.title || !this.digest);
  }

  onOpen(): void {
    this.setTitle('创建公众号草稿');
    // Everything WeChat will show a reader is repeated here: this is the last chance to catch a
    // wrong title or the wrong photograph before the upload starts.
    const table = this.contentEl.createDiv({ cls: 'dgs-wechat-summary' });

    if (this.summary.title) {
      this.row(table, '标题', (value) => {
        value.addClass('dgs-wechat-summary-title');
        value.setText(this.summary.title);
      });
    } else {
      this.prompt(table, '标题', {
        placeholder: '这篇文章在公众号里的标题',
        limit: TITLE_LIMIT,
        onChange: (value) => { this.title = value; },
      });
    }

    if (this.summary.digest) {
      this.row(table, '摘要', (value) => { value.setText(this.summary.digest); });
    } else {
      this.prompt(table, '摘要', {
        placeholder: '显示在订阅列表里的一段话',
        limit: DIGEST_LIMIT,
        multiline: true,
        onChange: (value) => { this.digest = value; },
      });
    }

    if (this.summary.author) {
      this.row(table, '作者', (value) => { value.setText(this.summary.author); });
    } else {
      // WeChat accepts a draft with no author, so this one is offered but never demanded.
      this.prompt(table, '作者', {
        placeholder: '可留空',
        limit: AUTHOR_LIMIT,
        onChange: (value) => { this.author = value; },
      });
    }
    this.row(table, '封面', (value) => {
      value.addClass('dgs-wechat-summary-cover');
      if (this.summary.coverUrl) {
        value.createEl('img', { attr: { src: this.summary.coverUrl, alt: '', width: 108, height: 60 } });
      }
      value.createDiv({ cls: 'dgs-wechat-summary-path', text: this.summary.cover });
    });
    this.row(table, '正文图片', (value) => { value.setText(`${this.summary.imageCount} 张`); });

    this.contentEl.createEl('p', { cls: 'dgs-wechat-summary-note', text: '将以上内容上传到微信并创建一条草稿。不会群发。' });

    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText('取消').onClick(() => { this.finish(false); }))
      .addButton((button) => {
        this.submit = button;
        button.setCta().setButtonText('创建草稿').onClick(() => { this.finish(true); });
      });
    this.refresh();
  }

  private finish(confirmed: boolean): void {
    if (confirmed && (!this.title || !this.digest)) return;
    if (!this.settled) {
      this.settled = true;
      this.done(confirmed ? { title: this.title, digest: this.digest, author: this.author } : null);
    }
    this.close();
  }

  onClose(): void {
    if (!this.settled) { this.settled = true; this.done(null); }
    this.contentEl.empty();
  }
}

export function confirmDraft(app: App, summary: DraftSummary): Promise<DraftDecision | null> {
  return new Promise((resolve) => new ConfirmDraftModal(app, summary, resolve).open());
}
