import { arrayBufferToBase64, MarkdownView, Notice, Plugin, requestUrl, TFile, TFolder } from 'obsidian';
import { extractImageSources, isRemoteSource, joinVaultPath, prepareArticle, PreparedArticle, replaceImageSource, resolveVaultImage } from './article';
import { PreparedImage, prepareBodyImage, prepareCover } from './image';
import { chooseCover, chooseTranslation, confirmDraft, CoverCandidate, DraftDecision, IMAGE_EXTENSIONS, PreviewModal } from './ui';
import { conventionalCoverPaths, ResolvedBundle, resolveBundle } from './bundle';
import { upsertFrontmatter } from './frontmatter';
import { createDraft, deleteMaterial, forgetAccessToken, getAccessToken, uploadBodyImage, uploadCover } from './wechat-api';
import { Credentials, loadCredentials } from './credentials';
import { DEFAULT_SETTINGS, PublisherSettings, PublisherSettingTab, SettingsHost } from './settings';

/** Every picture of an article, fetched and sized, ready to upload. */
interface PreparedMedia {
  cover: PreparedImage;
  images: Map<string, PreparedImage>;
}

export default class WechatPublisherPlugin extends Plugin implements SettingsHost {
  config: PublisherSettings = DEFAULT_SETTINGS;

  async saveSettings(): Promise<void> {
    await this.saveData(this.config);
  }

  async onload(): Promise<void> {
    const stored: unknown = await this.loadData();
    this.config = { ...DEFAULT_SETTINGS, ...(stored as Partial<PublisherSettings> | null) };
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
    const path = this.config.credentialsPath.trim();
    if (!path) throw new Error('请先在插件设置中填写凭证文件路径（一个含 WECHAT_APP_ID / WECHAT_APP_SECRET 的 .env）。');
    const loaded = await loadCredentials(path);
    return { ...loaded, author: loaded.author || this.config.author.trim() };
  }

  /**
   * Order the images a cover could plausibly be, best guess first: a note's own pictures are the
   * likeliest cover, so the answer is usually the top row of the picker.
   */
  private coverCandidates(bundle: ResolvedBundle, article: PreparedArticle): CoverCandidate[] {
    const note = bundle.file;
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

    if (this.config.defaultCover.trim()) add(resolve(this.config.defaultCover), '默认封面');
    for (const source of article.imageSources) {
      if (!isRemoteSource(source)) add(resolve(source), '正文图片');
    }
    // A bundle keeps its pictures in images/, one level below the translation being published.
    const bundleImages = this.app.vault.getAbstractFileByPath(joinVaultPath(bundle.baseDir, 'images'));
    if (bundleImages instanceof TFolder) {
      for (const child of bundleImages.children) {
        if (child instanceof TFile) add(child, 'bundle 图片');
      }
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
      const credentials = await this.credentials();
      const bundle = await resolveBundle(this.app, this.currentNote(), (translations) => chooseTranslation(this.app, translations));
      if (!bundle) {
        new Notice('已取消：没有选择要发布的译本。');
        return;
      }
      const note = bundle.file;
      const article = await prepareArticle(await this.app.vault.read(note), {
        author: credentials.author,
        shared: bundle.shared,
        lang: bundle.lang,
      });

      let chosenCover: TFile | null = null;
      if (!article.cover) {
        // A bundle keeps its cover at images/cover.*; take that before bothering the author.
        const conventional = conventionalCoverPaths(bundle.baseDir)
          .map((path) => this.app.vault.getAbstractFileByPath(path))
          .find((file): file is TFile => file instanceof TFile);
        chosenCover = conventional ?? await chooseCover(this.app, this.coverCandidates(bundle, article));
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

      if (mode === 'preview') this.showPreview(bundle, article, prepared);
      else await this.publish(bundle, article, prepared, credentials, chosenCover);
    } catch (error) {
      console.error('DGS WeChat Publisher:', error);
      new Notice(error instanceof Error ? error.message : String(error), 10000);
    }
  }

  private showPreview(bundle: ResolvedBundle, article: PreparedArticle, prepared: PreparedMedia): void {
    let html = article.html;
    for (const [source, image] of prepared.images) {
      const base64 = arrayBufferToBase64(image.bytes);
      html = replaceImageSource(html, source, `data:${image.contentType};base64,${base64}`);
    }
    new PreviewModal(this.app, article.title || this.fallbackTitle(bundle), html).open();

    const summary = `预检通过：${article.imageSources.length} 张正文图片，封面已验证。`;
    const gaps = ([['title', '标题'], ['digest', '摘要']] as const).filter(([key]) => !article[key]).map(([, name]) => name);
    new Notice(gaps.length ? `${summary}frontmatter 缺少${gaps.join('、')}，发布时会让你填写。` : summary);
  }

  private async publish(
    bundle: ResolvedBundle,
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
      coverUrl: this.displayUrl(bundle.file, article.cover),
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
      await this.rememberDialogAnswers(bundle, article, decision, chosenCover);
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

  /** A bundle translation is named after its language, so the folder is the recognisable name. */
  private fallbackTitle(bundle: ResolvedBundle): string {
    return bundle.isBundle ? bundle.file.parent?.name ?? bundle.file.basename : bundle.file.basename;
  }

  /**
   * Write what the dialog asked for back into the note that was published — in a bundle, the
   * translation itself, cover included. The cover is shared in principle, but a translation that
   * names its own is the one being looked at, and editing a file the author did not open is worse
   * than repeating a line.
   */
  private async rememberDialogAnswers(bundle: ResolvedBundle, article: PreparedArticle, decision: DraftDecision, chosenCover: TFile | null): Promise<void> {
    if (!this.config.rememberChoices) return;

    const additions: Record<string, string> = {};
    if (chosenCover) additions.cover = chosenCover.path;
    if (!article.title && decision.title) additions.title = decision.title;
    if (!article.digest && decision.digest) additions.description = decision.digest;
    if (!article.author && decision.author) additions.author = decision.author;
    await this.writeFrontMatter(bundle.file, additions);
  }

  private async writeFrontMatter(file: TFile, additions: Record<string, string>): Promise<void> {
    if (!Object.keys(additions).length) return;
    try {
      await this.app.vault.process(file, (data) => upsertFrontmatter(data, additions));
    } catch (error) {
      console.error(`DGS WeChat Publisher: 写回 ${file.path} 的 frontmatter 失败`, error);
    }
  }
}
