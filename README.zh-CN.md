# DGS WeChat Publisher for Obsidian

把当前 Obsidian Markdown 笔记转换为微信公众号兼容的内联 HTML，并写入公众号草稿箱。排版层基于 [dgs-wechat-publisher](https://github.com/d0u9/dgs-wechat-publisher)。

插件只创建草稿，不会正式发布或群发。

## 使用

1. 在“设置 → 第三方插件 → DGS WeChat Publisher”中填写 **Credentials file**，指向 Vault 之外的一个 `.env`：

   ```dotenv
   WECHAT_APP_ID=wx…
   WECHAT_APP_SECRET=…
   WECHAT_AUTHOR=作者名   # 可选
   ```

   路径要求是绝对路径，支持 `~` 展开，例如 `~/.config/wechat-publisher/.env`。文件放在 Vault 之外即可，也可以复用你已有的项目 `.env`（键名相同就能共用）。填好后点 **Check** 验证。

   凭证文件是唯一的凭证入口：插件不提供在设置里直接填 AppSecret 的选项，密钥不会写进本 Vault。
2. 在微信公众号后台把当前机器的公网出口 IP 加入白名单，并确认账号拥有素材和草稿接口权限。
3. 给笔记添加 frontmatter：

   ```yaml
   ---
   title: 文章标题 # 可省略；省略时发布前会让你填写
   description: 显示在订阅列表中的摘要 # 可省略；省略时发布前会让你填写
   cover: ./images/cover.jpg # 可省略；省略时发布前会弹出封面选择框
   author: 作者名 # 可省略；省略时发布前可填写，也可留空
   lang: zh
   ---
   ```

4. 先运行命令“预检并预览当前笔记”，再运行“发布当前笔记到公众号草稿箱”。

支持标准 Markdown 图片 `![](./images/photo.jpg)` 和 Obsidian Wiki 图片 `![[photo.jpg]]`。相对路径（`./`、`../`）按笔记所在文件夹解析，以 `/` 开头则按 Vault 根解析，正文图片和 `cover` 用同一套规则。正文和封面都支持 Vault 内的本地图片与远程 HTTP 图片。正文图片保持原格式上传（PNG 保留透明通道），只有超过微信 1 MB 限制时才会缩放并转成 JPEG；微信正文接口不支持 GIF，动图只会上传首帧。封面固定裁成 900×500 的 JPEG。没有填写 `cover` 时，插件会弹出封面选择框，候选按可能性排序：设置里的 **Default cover** → 本文正文里出现过的图片 → 笔记同目录的图片 → 全库最近修改的图片，并且每一行都带缩略图，所以通常直接回车选第一项即可。没有 `title`、`description` 或 `author` 时，创建草稿的确认框里会直接给出输入框，长度上限取微信自己的限制（标题 64、摘要 120、作者 8）。标题和摘要是微信的必填项，填完才能点“创建草稿”；作者可以留空。

若开启 **Remember what you fill in**（默认开启），草稿创建成功后会把你在确认框里补的 `cover`、`title`、`description`、`author` 写回笔记 frontmatter，下次发布同一篇就不再询问。

## Bundle（一篇文章一个文件夹）

一篇文章也可以是一个文件夹，与基础库 `dgs-wechat-publisher` 的 bundle 布局一致，同一个文件夹既能用 CLI 发，也能用本插件发：

```
我的文章/
├── index.md      共享的、与语言无关的 frontmatter —— 尤其是 cover
├── zh.md         title 和 description，天然是逐语言的
├── en.md
└── images/
    └── cover.jpg
```

- 在 `zh.md` 上执行命令，会自动读取同目录的 `index.md` 作为共享 frontmatter；**译本里写的同名字段优先**。
- 在 `index.md` 上执行命令，插件会问你要发布哪个译本（只有一个译本时直接用它）。
- 文件名 `zh.md` / `en.md` 决定排版预设，**优先于** frontmatter 里的 `lang`。其它名字（如 `notes.md`）不视为语言，仍看 `lang`。
- 没有任何地方声明 `cover` 时，插件会自动使用 `images/cover.{jpg,jpeg,png,webp,avif}`，找不到才弹出选择框；选择框里 bundle 的 `images/` 会排在前面。
- 写回 frontmatter 时，**一律写进你刚发布的那个译本**（`zh.md` 或 `en.md`），包括 `cover`。插件不会去改 `index.md`。

单文件笔记的行为完全不变：同目录没有 `index.md` 就不构成 bundle。

## 发版

推一个版本标签即可：

```bash
git tag -a 0.1.0 -m 0.1.0 && git push origin main 0.1.0
```

GitHub Actions 会校验标签与 `manifest.json` / `versions.json` 一致，跑测试和构建，然后创建一个**草稿** release，附带 Obsidian 安装所需的 `main.js`、`manifest.json`、`styles.css`。确认无误后在 GitHub 上手动点发布。

## 设计

- `src/article.ts`：Markdown/frontmatter、Wiki 图片语法和 Vault 路径适配。
- `dgs-wechat-publisher`：Markdown 渲染、微信兼容的内联排版、自包含校验。
- `src/image.ts`：使用 Electron 的 Canvas 在本地压缩图片，不依赖原生 `sharp` 模块。
- `src/wechat-api.ts`：获取 token、上传正文图/封面、调用 `draft/add`。
- `src/bundle.ts`：bundle 布局的解析——译本、共享 frontmatter、约定俗成的封面。
- `src/credentials.ts`：从 Vault 之外的 `.env` 读取凭证。
- `src/frontmatter.ts`：把回写 frontmatter 做成纯文本合并。
- `src/settings.ts`：设置项与设置面板。
- `src/main.ts`：Obsidian 命令、发布流程的编排。

密钥只存在于 Vault 之外的那个 `.env` 里，插件每次发布时读取，不写入 `data.json`。这样做的理由：`data.json` 会被 Vault 的同步链路（iCloud、Obsidian Sync 等）带走，而 Obsidian 没有插件沙箱，任何已安装的社区插件都能读它。AppSecret 是公众号的主凭证，可用于群发、改菜单、拉取粉丝列表，权限远超本插件所需。

请确认你的 `.env` 本身没有被提交到 git，并在公众号后台配置 IP 白名单——它是凭证万一泄露时的最后一道防线。

Access token 只缓存在当前运行的内存里，按微信返回的有效期过期。

## 开发

```sh
npm install
npm test
npm run build
```

插件为桌面端专用。构建产物是 `main.js`、`manifest.json` 和 `styles.css`。

## License

MIT。基础排版和发布库版权归其原作者所有，详见该项目许可证。
