import { App, Notice, Plugin, PluginSettingTab, Setting, TextComponent, debounce } from 'obsidian';
import { Credentials, maskAppId } from './credentials';

export interface PublisherSettings {
  /** Absolute path to a .env file holding the WeChat credentials, outside this vault. */
  credentialsPath: string;
  author: string;
  /** Vault path of an image offered first when a note has no cover of its own. */
  defaultCover: string;
  /** Write what was filled in here — cover, title, digest — back into the note's frontmatter. */
  rememberChoices: boolean;
}

export const DEFAULT_SETTINGS: PublisherSettings = { credentialsPath: '', author: '', defaultCover: '', rememberChoices: true };

/**
 * What the settings pane needs from the plugin. Naming it here keeps the pane from importing the
 * plugin class, which would import the pane straight back.
 */
export interface SettingsHost {
  settings: PublisherSettings;
  saveSettings(): Promise<void>;
  credentials(): Promise<Credentials>;
}

export class PublisherSettingTab extends PluginSettingTab {
  // Saving on every keystroke writes half-typed secrets to disk a dozen times per field.
  private readonly save = debounce(() => void this.plugin.saveSettings(), 600, true);

  constructor(app: App, private readonly plugin: Plugin & SettingsHost) { super(app, plugin); }

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
