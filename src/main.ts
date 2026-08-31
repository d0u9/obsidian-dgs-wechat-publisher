import {
  App,
  MarkdownView,
  Notice,
  Plugin,
  PluginSettingTab,
  debounce,
  requestUrl,
  Setting,
  TextComponent,
  TFile,
} from 'obsidian';
import { extractImageSources, isRemoteSource, prepareArticle, PreparedArticle, resolveVaultImage } from './article';
import { PreparedImage, prepareBodyImage, prepareCover } from './image';
import { chooseCover, confirmDraft, CoverCandidate, DraftDecision, IMAGE_EXTENSIONS, PreviewModal } from './ui';
import { createDraft, deleteMaterial, forgetAccessToken, getAccessToken, uploadBodyImage, uploadCover } from './wechat-api';
import { Credentials, loadCredentials, maskAppId } from './credentials';

interface PublisherSettings {
  /** Absolute path to a .env file holding the WeChat credentials, outside this vault. */
  credentialsPath: string;
  author: string;
  /** Vault path of an image offered first when a note has no cover of its own. */
  defaultCover: string;
  /** Write what was filled in here — cover, title, digest — back into the note's frontmatter. */
  rememberChoices: boolean;
}

const DEFAULT_SETTINGS: PublisherSettings = { credentialsPath: '', author: '', defaultCover: '', rememberChoices: true };

/** Every picture of an article, fetched and sized, ready to upload. */
interface PreparedMedia {
  cover: PreparedImage;
  images: Map<string, PreparedImage>;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Swap one <img src> value, whichever quote style the renderer emitted. */
function replaceImageSource(html: string, source: string, replacement: string): string {
  return html.replace(
    new RegExp(`(<img\\b[^>]*?\\bsrc=)(["'])${escapeRegExp(source)}\\2`, 'gi'),
    (_all, prefix: string, quote: string) => `${prefix}${quote}${replacement}${quote}`,
  );
}

export default class WechatPublisherPlugin extends Plugin {
  settings: PublisherSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.addSettingTab(new PublisherSettingTab(this.app, this));
    this.addRibbonIcon('send', '发布到微信公众号草稿箱', () => void this.run('publish'));
    this.addCommand({
      id: 'preview-current-note',
      name: '预检并预览当前笔记',
      editorCheckCallback: (checking) => checking || (void this.run('preview'), true),
    });
    this.addCommand({
      id: 'publish-current-note-to-drafts',
      name: '发布当前笔记到公众号草稿箱',
      editorCheckCallback: (checking) => checking || (void this.run('publish'), true),
    });
  }

  /**
   * Credentials come from an external .env when one is configured, so the secret never has to sit
   * in this vault's data.json. They are read per run: the file is the source of truth.
   */
  async credentials(): Promise<Credentials> {
    const path = this.settings.credentialsPath.trim();
    if (!path) throw new Error('请先在插件设置中填写凭证文件路径（一个含 WECHAT_APP_ID / WECHAT_APP_SECRET 的 .env）。');
    const loaded = await loadCredentials(path);
    return { ...loaded, author: loaded.author || this.settings.author.trim() };
  }

  /**
   * Order the images a cover could plausibly be, best guess first: a note's own pictures are the
   * likeliest cover, so the answer is usually the top row of the picker.
   */
  private coverCandidates(note: TFile, article: PreparedArticle): CoverCandidate[] {
    const candidates: CoverCandidate[] = [];
    const seen = new Set<string>();
    const add = (file: TFile | null, label: string) => {
      if (!file || seen.has(file.path) || !IMAGE_EXTENSIONS.has(file.extension.toLocaleLowerCase())) return;
      seen.add(file.path);
      candidates.push({ file, label });
    };
    const resolve = (source: string): TFile | null => {
      try {
        return resolveVaultImage(this.app.vault, this.app.metadataCache, note, source);
      } catch {
        return null;
      }
    };

    if (this.settings.defaultCover.trim()) add(resolve(this.settings.defaultCover), '默认封面');
    for (const source of article.imageSources) {
      if (!isRemoteSource(source)) add(resolve(source), '正文图片');
    }
    const folder = note.parent?.path;
    const images = this.app.vault.getFiles()
      .filter((file) => IMAGE_EXTENSIONS.has(file.extension.toLocaleLowerCase()))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    for (const file of images) {
      if (folder !== undefined && file.parent?.path === folder) add(file, '同一文件夹');
    }
    for (const file of images) add(file, '最近修改');
    return candidates;
  }

  /** A URL the renderer can show for a cover, or '' when it cannot be resolved. */
  private displayUrl(note: TFile, source: string): string {
    if (isRemoteSource(source)) return source;
    try {
      return this.app.vault.getResourcePath(resolveVaultImage(this.app.vault, this.app.metadataCache, note, source));
    } catch {
      return '';
    }
  }

  private currentNote(): TFile {
    const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
    if (!file) throw new Error('请先打开一篇 Markdown 笔记。');
    return file;
  }

  private async readImage(note: TFile, source: string): Promise<ArrayBuffer> {
    if (isRemoteSource(source)) {
      const response = await requestUrl({ url: source });
      return response.arrayBuffer;
    }
    return this.app.vault.readBinary(resolveVaultImage(this.app.vault, this.app.metadataCache, note, source));
  }

  private async validate(note: TFile, article: PreparedArticle, notice?: Notice): Promise<PreparedMedia> {
    const cover = await prepareCover(await this.readImage(note, article.cover));
    const images = new Map<string, PreparedImage>();
    for (const [index, source] of article.imageSources.entries()) {
      notice?.setMessage(`正在处理第 ${index + 1}/${article.imageSources.length} 张正文图片…`);
      images.set(source, await prepareBodyImage(await this.readImage(note, source), source));
    }
    return { cover, images };
  }

  private async run(mode: 'preview' | 'publish'): Promise<void> {
    try {
      const note = this.currentNote();
      const credentials = await this.credentials();
      const article = await prepareArticle(await this.app.vault.read(note), credentials);

      let chosenCover: TFile | null = null;
      if (!article.cover) {
        chosenCover = await chooseCover(this.app, this.coverCandidates(note, article));
        if (!chosenCover) {
          new Notice('已取消：没有选择封面。');
          return;
        }
        article.cover = chosenCover.path;
      }

      // Both modes need every picture fetched, sized and checked; only publishing uploads them.
      const preparing = new Notice('正在校验封面与正文图片…', 0);
      let prepared: PreparedMedia;
      try {
        prepared = await this.validate(note, article, preparing);
      } finally {
        preparing.hide();
      }

      if (mode === 'preview') this.showPreview(note, article, prepared);
      else await this.publish(note, article, prepared, credentials, chosenCover);
    } catch (error) {
      console.error('DGS WeChat Publisher:', error);
      new Notice(error instanceof Error ? error.message : String(error), 10000);
    }
  }

  private showPreview(note: TFile, article: PreparedArticle, prepared: PreparedMedia): void {
    let html = article.html;
    for (const [source, image] of prepared.images) {
      const base64 = Buffer.from(image.bytes).toString('base64');
      html = replaceImageSource(html, source, `data:${image.contentType};base64,${base64}`);
    }
    new PreviewModal(this.app, article.title || note.basename, html).open();

    const summary = `预检通过：${article.imageSources.length} 张正文图片，封面已验证。`;
    const gaps = ([['title', '标题'], ['digest', '摘要']] as const).filter(([key]) => !article[key]).map(([, name]) => name);
    new Notice(gaps.length ? `${summary}frontmatter 缺少${gaps.join('、')}，发布时会让你填写。` : summary);
  }

  private async publish(
    note: TFile,
    article: PreparedArticle,
    prepared: PreparedMedia,
    credentials: Credentials,
    chosenCover: TFile | null,
  ): Promise<void> {
    if (!credentials.appId || !credentials.appSecret) throw new Error('凭证文件里没有可用的 AppID 或 AppSecret。');
    const decision = await confirmDraft(this.app, {
      title: article.title,
      digest: article.digest,
      author: article.author,
      cover: article.cover,
      coverUrl: this.displayUrl(note, article.cover),
      imageCount: article.imageSources.length,
    });
    if (!decision) return;

    const notice = new Notice('正在上传图片并创建公众号草稿…', 0);
    try {
      const token = await getAccessToken(credentials.appId, credentials.appSecret);
      const html = await this.uploadImages(token, article.html, prepared.images, notice);

      notice.setMessage('正在上传封面…');
      const thumbMediaId = await uploadCover(token, prepared.cover);
      const mediaId = await this.createDraftOrReclaim(token, thumbMediaId, html, decision, notice);

      notice.hide();
      await this.rememberDialogAnswers(note, article, decision, chosenCover);
      new Notice(`草稿创建成功：${mediaId}`, 8000);
    } catch (error) {
      notice.hide();
      // A rejected token is worth dropping, so the next run fetches a fresh one.
      if (error instanceof Error && error.message.includes('access_token')) forgetAccessToken(credentials.appId);
      throw error;
    }
  }

  /** Upload every body image and point the HTML at the URLs WeChat hands back. */
  private async uploadImages(token: string, html: string, images: Map<string, PreparedImage>, notice: Notice): Promise<string> {
    let uploaded = 0;
    const hosted = new Set<string>();
    for (const [source, image] of images) {
      notice.setMessage(`正在上传第 ${++uploaded}/${images.size} 张正文图片…`);
      const url = await uploadBodyImage(token, image);
      hosted.add(url);
      html = replaceImageSource(html, source, url);
    }
    // Every reference must now be one of the URLs WeChat just handed back. A silent miss would
    // publish a draft whose pictures only load inside this vault, and WeChat never warns.
    const leftover = extractImageSources(html).filter((source) => !hosted.has(source));
    if (leftover.length) throw new Error(`正文图片替换失败，未上传的引用：${leftover.join('、')}`);
    return html;
  }

  private async createDraftOrReclaim(token: string, thumbMediaId: string, html: string, decision: DraftDecision, notice: Notice): Promise<string> {
    try {
      notice.setMessage('正在创建草稿…');
      return await createDraft(token, {
        article_type: 'news',
        title: decision.title,
        author: decision.author,
        digest: decision.digest,
        content: html,
        content_source_url: '',
        thumb_media_id: thumbMediaId,
        need_open_comment: 0,
        only_fans_can_comment: 0,
      });
    } catch (error) {
      // The cover already occupies a permanent-material slot. Hand it back rather than leave an
      // orphan the author would have to hunt down in the WeChat console.
      await deleteMaterial(token, thumbMediaId)
        .catch((cleanupError) => console.error('DGS WeChat Publisher: 回收封面素材失败', cleanupError));
      throw error;
    }
  }

  /** Write what the dialog asked for back into the note, so the next publish needs no dialog. */
  private async rememberDialogAnswers(note: TFile, article: PreparedArticle, decision: DraftDecision, chosenCover: TFile | null): Promise<void> {
    if (!this.settings.rememberChoices) return;
    const additions: Record<string, string> = {};
    if (chosenCover) additions.cover = chosenCover.path;
    if (!article.title && decision.title) additions.title = decision.title;
    if (!article.digest && decision.digest) additions.description = decision.digest;
    if (!article.author && decision.author) additions.author = decision.author;
    if (!Object.keys(additions).length) return;
    await this.app.fileManager.processFrontMatter(note, (frontmatter) => Object.assign(frontmatter, additions))
      .catch((error) => console.error('DGS WeChat Publisher: 写回 frontmatter 失败', error));
  }
}

class PublisherSettingTab extends PluginSettingTab {
  // Saving on every keystroke writes half-typed secrets to disk a dozen times per field.
  private readonly save = debounce(() => void this.plugin.saveData(this.plugin.settings), 600, true);

  constructor(app: App, private readonly plugin: WechatPublisherPlugin) { super(app, plugin); }

  private field(name: string, description: string, apply: (value: string) => void, configure?: (text: TextComponent) => void): Setting {
    return new Setting(this.containerEl).setName(name).setDesc(description).addText((text) => {
      configure?.(text);
      text.onChange((value) => { apply(value); this.save(); });
    });
  }

  display(): void {
    this.containerEl.empty();

    new Setting(this.containerEl).setName('Credentials').setHeading();
    this.field(
      'Credentials file',
      'Absolute path to a .env file outside this vault, holding WECHAT_APP_ID, WECHAT_APP_SECRET and optionally WECHAT_AUTHOR. '
        + 'The file is read on each publish, so no secret is ever stored in this vault.',
      (value) => { this.plugin.settings.credentialsPath = value.trim(); },
      (text) => text.setPlaceholder('~/.config/wechat-publisher/.env').setValue(this.plugin.settings.credentialsPath),
    ).addButton((button) => button.setButtonText('Check').onClick(async () => {
      this.save.run();
      try {
        const credentials = await this.plugin.credentials();
        new Notice(`Credentials OK — AppID ${maskAppId(credentials.appId)}${credentials.author ? `, author ${credentials.author}` : ''}`);
      } catch (error) {
        new Notice(error instanceof Error ? error.message : String(error), 10000);
      }
    }));

    new Setting(this.containerEl).setName('Article').setHeading();
    this.field(
      'Default author',
      'Used when neither the note frontmatter nor WECHAT_AUTHOR names one.',
      (value) => { this.plugin.settings.author = value; },
      (text) => text.setValue(this.plugin.settings.author),
    );
    this.field(
      'Default cover',
      'Vault path of a fallback cover image. It is offered first when a note has no cover of its own; it is never used without asking.',
      (value) => { this.plugin.settings.defaultCover = value.trim(); },
      (text) => text.setPlaceholder('assets/cover.jpg').setValue(this.plugin.settings.defaultCover),
    );
    new Setting(this.containerEl)
      .setName('Remember what you fill in')
      .setDesc('After a draft is created, write the cover, title and digest you supplied in the confirmation dialog back into the note frontmatter, so the next publish does not ask again.')
      .addToggle((toggle) => toggle.setValue(this.plugin.settings.rememberChoices).onChange((value) => {
        this.plugin.settings.rememberChoices = value;
        this.save();
      }));

    this.containerEl.createEl('p', { text: 'Publishing only creates a draft. It never sends a mass message.' });
  }

  hide(): void {
    // A debounced write must not be lost when the settings pane closes.
    this.save.run();
  }
}
