# AGENTS.md

## 这个仓库在哪

仓库本身就是**本地 Vault 的插件目录**：

```
~/Documents/Obsidian/Douglas.S Local/.obsidian/plugins/obsidian-dgs-wechat-publisher
```

所以 `npm run build` 是就地构建，本地 Vault 立刻拿到新版本，不需要额外复制。

## 发布

改完代码后跑：

```bash
npm run release
```

等价于 `npm run build && npm run deploy`。部署目标写在 [scripts/deploy.mjs](scripts/deploy.mjs) 的 `VAULTS` 里，目前两个：

| Vault | 路径 |
|---|---|
| local | `~/Documents/Obsidian/Douglas.S Local` |
| iCloud | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Douglas.S` |

**两个 Vault 都要发**，别只发本地。新增 Vault 时改 `VAULTS` 数组即可。

部署只复制 `main.js`、`manifest.json`、`styles.css`。**不要复制 `data.json`**——它是每个 Vault 自己的设置，在没有配置凭证文件的 Vault 里还存着明文 AppSecret。

部署后需要在 Obsidian 里 `Cmd+P → Reload app without saving` 才生效。

## 发版

版本号只写在三处：`manifest.json`、`package.json`、`versions.json`（外加 lockfile 里的两处）。改完提交，然后打一个**与 manifest 版本逐字相同、不带 `v` 前缀**的标签：

```bash
git tag -a 0.2.0 -m 0.2.0 && git push origin main 0.2.0
```

推标签会触发 [.github/workflows/release.yml](.github/workflows/release.yml)：它校验标签与 `manifest.json`、`versions.json` 一致，跑测试、构建，然后创建一个**草稿** release，附上 `main.js`、`manifest.json`、`styles.css`。草稿要人工确认后才发布——不要在工作流里改成自动发布。

插件 id 是 `dgs-wechat-publisher`（社区规范不允许 id 带 `obsidian-` 前缀），但这两个 Vault 里的安装文件夹仍叫 `obsidian-dgs-wechat-publisher`。Obsidian 按文件夹加载，两者可以不同——不要"顺手"去改文件夹名，那只会把 `data.json` 挪来挪去。

## 凭证

密钥不放在这个仓库、也不放在 Vault 里。设置里的 **Credentials file** 指向 Vault 之外的一个 `.env`，键名 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / `WECHAT_AUTHOR`。这是唯一的凭证入口——设置里没有直接填 AppSecret 的字段，不要再加回来。

这台机器上用的是 `~/Git/Doug Su Photography/.env`（与该站点共用），但**任何面向用户的文本里都不要出现这个路径**：插件是给别人用的，README 和设置项的示例一律用 `~/.config/wechat-publisher/.env` 这类通用路径。

不要把任何真实凭证写进代码、测试、README 或提交信息。调试时用 `maskAppId()`，永远不要打印 secret。

## 开发约定

- `npm run lint` 跑的是插件目录评审用的同一套规则（`eslint-plugin-obsidianmd` + typescript-eslint）。提交社区之前必须过——它的 error 会直接卡住发布。
- **不要引入 `node:fs`**。Vault 之外的那一个文件用 Obsidian 的 `FileSystemAdapter.readLocalFile` 读，production 构建会检查产物里是否出现 `require("node:fs")` 和 `Buffer.from`，出现就直接失败。所有本地文件相关的代码只放在 `src/local-file.ts`。
- 仓库**不依赖 `@types/node`**——评审环境没有它，装了只会让本地 lint 看不到他们看到的问题。
- 不要用 `vault.getFiles()` 等全量枚举：封面候选只从文章已经指向的文件夹里取。
- 插件自己的设置存在 `plugin.config`，**不要叫 `settings`**：Obsidian 1.13 给 `Plugin` 加了同名属性，会互相遮蔽，评审也会报 `no-unsupported-api`。
- `npm test` 跑 `node --test`。`src/*.ts` 里的纯函数通过 [tests/helpers/load-src.mjs](tests/helpers/load-src.mjs) 现场用 esbuild 编译并把 `obsidian` 换成桩模块来测——不要为了可测性把代码拆成"无 obsidian 依赖"的文件。
- 排版层来自 pinned 的 `dgs-wechat-publisher`（`github:d0u9/dgs-wechat-publisher#<commit>`）。它只负责 Markdown→微信 HTML，不碰文件、凭证和 HTTP。要改排版应该改上游并更新 pin，不要在插件里后处理 HTML。
- frontmatter 的 `lang` 只切换排版预设（zh 两端对齐/大行距，en 左对齐），与翻译无关。在 bundle 里，文件名（`zh.md` / `en.md`）优先于 `lang`。
- bundle 布局（`index.md` + `zh.md`/`en.md` + `images/`）要与上游 `src/bundle.mjs` 保持一致：同一个文件夹既要能用 CLI 发，也要能用插件发。改这块前先读上游那个文件。
- 插件是 `isDesktopOnly: true`，可以用 Electron 的 Canvas 和 `node:*`（esbuild 已 external）。
- 只创建草稿，永远不要调用群发/发布接口。
- README.md 必须是英文（插件目录的硬性要求），中文版在 README.zh-CN.md。
- 不要用 `fileManager.processFrontMatter` 写笔记：元数据缓存不是最新时它会在开头插入第二个 frontmatter 块，损坏笔记（已经发生过一次）。用 `vault.process` + `src/frontmatter.ts` 的 `upsertFrontmatter`，它是纯文本合并，有测试覆盖。
- 设置页（`PublisherSettingTab`）的文案用**英文**，面向社区用户；运行时的 Notice 和报错目前是中文，面向写公众号的作者。改动时别把两者混在一起。
