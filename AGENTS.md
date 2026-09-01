# AGENTS.md

写给以后改这个插件的人（和 agent）。

**下面每一条约束都是踩过的坑，不是风格偏好。** 每条都写了代价，因为不知道代价的规则最容易被"顺手修好"。改动前先读相关那一节。

---

## 1. 这个仓库在哪

仓库本身就是**本地 Vault 的插件目录**：

```
~/Documents/Obsidian/Douglas.S Local/.obsidian/plugins/obsidian-dgs-wechat-publisher
```

`npm run build` 是就地构建，本地 Vault 立刻拿到新版本。

| 命令 | 作用 |
|---|---|
| `npm test` | `node --test`，纯逻辑单元测试 |
| `npm run lint` | 插件目录评审用的同一套规则 |
| `npm run build` | 类型检查 + 打包，含产物断言 |
| `npm run deploy` | 复制到所有 Vault |
| `npm run release` | build + deploy |

提交前至少跑 `npm run lint && npm test && npm run build`。

---

## 2. 插件目录评审会卡住的事

社区提交要过一套自动检查。**它的 Error 直接阻塞发布**，Warning 不阻塞但审核员会看。`npm run lint` 跑的就是同一套规则，本地必须 0 error。

### 2.1 不要把插件字段命名为 `settings`

用 `plugin.config`。Obsidian 1.13 给 `Plugin` 加了 `settings` 属性，同名字段会遮蔽它，评审报 `no-unsupported-api` **Error**（0.1.1 就是卡在这里）。

### 2.2 不要引入 `node:fs`，也不要引入任何 Node 模块

Vault 之外的那唯一一个文件（凭证 `.env`）用 Obsidian 自己的 `FileSystemAdapter.readLocalFile()` 读。所有本地文件相关代码只放在 [src/local-file.ts](src/local-file.ts)。

基础库里有个我们从不调用的 `readMarkdownFile`，tree-shaking 会留下 `require("node:fs/promises")`——[esbuild.config.mjs](esbuild.config.mjs) 把该模块换成会抛错的桩，产物里因此没有 fs。

### 2.3 不要读 `process.env`

会被判定为"读取用户身份信息用于机器指纹"。凭证路径因此**必须写完整路径，不支持 `~`**——展开 `~` 就得读 `HOME`，不值得为省几个字符换这个能力。

### 2.4 不要用 `Buffer`

用 Obsidian 的 `arrayBufferToBase64()`。

### 2.5 不要全量枚举 Vault

`vault.getFiles()` / `getMarkdownFiles()` 会被标记为"能拿到 Vault 里每个文件路径"。封面候选只从**文章已经指向的地方**取：bundle 的 `images/`、正文图片、笔记同目录、旁边的 `attachments/`。

按文件名找图交给 `metadataCache.getFirstLinkpathDest()`，它本来就能像 Obsidian 的链接那样全库解析，自己扫一遍是多余的。

> 2.2–2.5 由 production 构建断言把关：产物里出现 `require("node:fs")`、`Buffer.from`、`process.env` 就构建失败。加新的禁用项就加进那个数组。

### 2.6 仓库不依赖 `@types/node`

评审环境没装它，那里所有 Node 内置都是 `any`，会冒出一堆 `no-unsafe-*`。本地装了就看不到他们看到的问题——**装上等于把自己的眼睛蒙上**。

### 2.7 其它硬性要求

- `document.createElement` → 用 `createEl()`
- 声明为 `=> void` 的回调里不要返回组件对象（链式 `setValue()` 的返回值），会报 `no-misused-promises`
- 不要用 `builtin-modules` 这个包，用 `node:module` 的 `builtinModules`
- 插件 id 不能带 `obsidian-` 前缀 → `dgs-wechat-publisher`
- 必须有 LICENSE（MIT，与上游库一致）
- **README.md 必须是英文**，中文版放 README.zh-CN.md

### 2.8 已知且接受的 Warning

`getSettingDefinitions()` 未实现——那是 1.13 的声明式设置 API，而 `minAppVersion` 是 1.5.0。实现它会立刻触发 2.1 那个 Error。要消掉只能把 `minAppVersion` 提到 1.13，代价是挡住老版本用户。**这是权衡，不是遗漏。**

---

## 3. 凭证

密钥不进仓库、不进 Vault。设置里的 **Credentials file** 指向 Vault 之外的一个 `.env`，键名 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / `WECHAT_AUTHOR`。

**这是唯一的凭证入口。** 设置里没有直接填 AppSecret 的字段——曾经有，删掉了：`data.json` 会被 iCloud / Obsidian Sync 带走，而 Obsidian 没有插件沙箱，任何已安装插件都能读它。不要加回来。

- 不要把真实凭证写进代码、测试、README 或提交信息
- 调试时用 `maskAppId()`，**永远不要打印 secret**
- 这台机器上用的是 `/Users/doug/Git/Doug Su Photography/.env`（与该站点共用）。**面向用户的文本里不要出现这个路径**，示例一律用 `/Users/you/.config/wechat-publisher/.env` 这类通用路径

---

## 4. 写用户的笔记

写笔记是破坏性操作，这一节的每条都对应一次真实的数据损坏。

### 4.1 不要用 `fileManager.processFrontMatter`

它靠元数据缓存定位已有的 frontmatter 区间；缓存不是最新时，它认为文件没有 frontmatter，于是**在开头插入第二个块**，把笔记弄坏。插件无法保证那一刻缓存是新的。

用 `vault.process` + [src/frontmatter.ts](src/frontmatter.ts) 的 `upsertFrontmatter()`——纯文本合并，有测试覆盖。

### 4.2 合并结果必须验回来

`upsertFrontmatter` 会用**发布流程同一个解析器**把结果解析回来：值对不上、或正文有任何一个字节被改动，就抛错放弃写入。这个守卫抓到过真 bug（见 4.3），不要为了"简化"删掉它。

### 4.3 会被 YAML 重新解释的值必须加引号

标题是 `no`、`007`、`2024-01-01` 时，纯量会被读成 `false`、数字、日期。

### 4.4 frontmatter 的边界判定要与上游解析器一致

[src/frontmatter.ts](src/frontmatter.ts) 的正则刻意抄自基础库（含可选 BOM）。**它认为是 frontmatter 的，才是**——比如 `---\n---` 两边都不算。判定不一致就会写出一个发布流程读不到的块。

### 4.5 回写只写当前发布的那个文件

bundle 里就是那个译本（`zh.md` / `en.md`），`cover` 也一样。封面在概念上是共享的，但用户打开的是译本，去改 `index.md` 等于动了他没在看的文件。

---

## 5. 微信接口的既成事实

- **只创建草稿，永远不要调用群发/发布接口。**
- 正文图接口只收 jpg/png，单张 ≤ 1 MB。GIF 只能上首帧。
- 封面走 `add_material?type=thumb`，**占永久素材配额**，只能在后台手删。所以草稿创建失败时必须 `del_material` 归还——已实现，别删。
- 上传完必须断言正文里不再有未替换的本地图片引用。漏一张，草稿发出去时图只在本地能看，而微信不会报错。
- access_token 按微信返回的有效期缓存在内存里；`stable_token` 有每日调用限制。

---

## 6. 内容与图片处理

### 6.1 `normalizePath` 不解析 `./` 和 `../`

它只合并斜杠、去掉首尾斜杠，**`.` 和 `..` 段原样留着**。直接拿去查找会找不到文件——`cover: ./images/01.jpg` 曾经因此完全不可用，正文图同理。

用 [src/article.ts](src/article.ts) 的 `joinVaultPath()` / `imagePathCandidates()`：先按笔记所在文件夹解析，再按 Vault 根，`/` 开头直接按根。

### 6.2 改写 wiki 图片语法要跳过代码

`![[photo.jpg]]` → 标准 Markdown 的改写，必须跳过**围栏代码块、行内代码、以及开头的 frontmatter**。否则写教程时代码里的示例会被真的改写，还会被当成待上传的图片。逐行扫描的实现在 `rewriteWikiImageEmbeds()`，有测试覆盖。

### 6.3 能原样上传就不要重编码

正文图里 JPEG/PNG 只要 ≤ 1 MB 就**原样上传**——重编码只会掉画质，PNG 还会丢透明通道。超限才缩放（≤1920 宽）并转码；PNG 优先仍转 PNG，实在超限才铺白底转 JPEG。

封面是唯一必须重编码的：微信要 900×500、≤ 64 KB，原始构图本来就保不住。

格式判断用 magic bytes（`sniffImageKind()`），**不要信文件扩展名**。

### 6.4 替换 `<img src>` 要当心

提取用正则、替换用字符串字面量的组合曾经静默失效。替换时必须：**转义正则元字符**（路径里有 `+` `(` `.` 很常见）、**单双引号都认**、且只动 `src` 不动 `alt`。见 `replaceImageSource()`。

### 6.5 回写 frontmatter 只在草稿创建成功之后

失败时不要留下半吊子的 frontmatter；预览模式不写任何东西（没有真的发布）。回写失败只记日志，不能影响已经建好的草稿。

## 7. 代码与文案约定

- 排版层来自 pin 住的 `dgs-wechat-publisher`（`github:d0u9/dgs-wechat-publisher#<commit>`）。它只负责 Markdown→微信 HTML，不碰文件、凭证和 HTTP。**要改排版就改上游再更新 pin**，不要在插件里后处理 HTML。
- bundle 布局（`index.md` + `zh.md`/`en.md` + `images/`）要与上游 `src/bundle.mjs` 一致：同一个文件夹既要能用 CLI 发，也要能用插件发。改这块前先读那个文件。
- frontmatter 的 `lang` 只切换排版预设（zh 两端对齐/大行距，en 左对齐），与翻译无关。bundle 里**文件名优先于 `lang`**。
- `isDesktopOnly: true`。可以用 Electron 的 Canvas 和 DOM，但 Node 模块不行（见 2.2）。
- **设置页文案用英文**（面向社区用户），**运行时 Notice 和报错用中文**（面向写公众号的作者）。不要混。

---

## 8. 测试

- `src/*.ts` 通过 [tests/helpers/load-src.mjs](tests/helpers/load-src.mjs) 现场用 esbuild 编译、把 `obsidian` 换成桩模块来测。**不要为了可测性把代码拆成"无 obsidian 依赖"的文件**——桩已经够用。
- 桩里的类挂在 `globalThis.__obsidian` 上，测试构造假 Vault 时要用它们，否则 `instanceof` 对不上。
- 桩的内容是一个**模板字符串**：里面不要出现反引号，会把字符串截断（踩过）。
- Modal 的回调顺序：`SuggestModal` **先关窗、后报告选择**。`onClose` 里判定"取消"必须延后一个事件循环，否则用户选中的项会被当成取消（踩过，有回归测试）。

---

## 9. 部署与发版

### 9.1 部署到 Vault

```bash
npm run release
```

目标写在 [scripts/deploy.mjs](scripts/deploy.mjs) 的 `VAULTS`：

| Vault | 路径 |
|---|---|
| local | `~/Documents/Obsidian/Douglas.S Local` |
| iCloud | `~/Library/Mobile Documents/iCloud~md~obsidian/Documents/Douglas.S` |

- **两个 Vault 都要发**，别只发本地
- 只复制 `main.js`、`manifest.json`、`styles.css`。**不要复制 `data.json`**，那是每个 Vault 自己的设置
- 安装文件夹仍叫 `obsidian-dgs-wechat-publisher`，和插件 id 不同。Obsidian 按文件夹加载，两者可以不同——**不要"顺手"改名**，那只会把 `data.json` 挪来挪去
- 部署后必须在 Obsidian 里 `Cmd+P → Reload app without saving`。**没重载就等于还在跑旧代码**——排查"改了没效果"时先确认这一步

### 9.2 发版

版本号写在 `manifest.json`、`package.json`、`versions.json`（外加 lockfile 两处），四处必须一致。然后打一个**与 manifest 逐字相同、不带 `v` 前缀**的标签：

```bash
git tag -a 0.2.0 -m 0.2.0 && git push origin main 0.2.0
```

推标签触发 [.github/workflows/release.yml](.github/workflows/release.yml)：校验标签与 `manifest.json` / `versions.json` 一致 → 测试 → 构建 → 附 attestation → 建**草稿** release。

- **草稿要人工确认后才发布**，不要改成自动发布
- 不生成 changelog：一串提交标题不是 release 说明，正文留空自己写
- 标签移动后要重推时用 `--force`，工作流会刷新草稿的附件
- **已发布的 release 不要改**，发新版本号。工作流遇到已发布的 release 会直接失败退出——那是故意的：替换别人已经下载过的文件，不该由工作流决定
- GitHub 上的仓库名是 `obsidian-dgs-wechat-publisher`，与插件 id 不同，这没问题
