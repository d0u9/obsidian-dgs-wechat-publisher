# DGS WeChat Publisher for Obsidian

[中文说明](README.zh-CN.md)

Turn the Markdown note you are editing into a WeChat Official Account draft, formatted with the
inline HTML the WeChat editor accepts. Typography comes from
[dgs-wechat-publisher](https://github.com/d0u9/dgs-wechat-publisher).

The plugin only ever creates a draft. It never publishes an article and never sends a mass message.

Desktop only, and Chinese-facing by nature: the runtime messages are in Chinese, because the people
writing these articles are.

## Getting started

1. Put your Official Account credentials in a `.env` file **outside your vault**:

   ```dotenv
   WECHAT_APP_ID=wx…
   WECHAT_APP_SECRET=…
   WECHAT_AUTHOR=Your name   # optional
   ```

   In **Settings → Community plugins → DGS WeChat Publisher**, set **Credentials file** to that
   file's absolute path (`~` is expanded), then press **Check**. This is the only way to give the
   plugin credentials: nothing secret is written into your vault.

2. In the WeChat admin console, whitelist this machine's public IP address and confirm the account
   has permission to use the material and draft APIs.

3. Give the note some frontmatter:

   ```yaml
   ---
   title: An article
   description: The summary readers see in the subscription list
   cover: ./images/cover.jpg # optional — you are asked when it is missing
   author: A name            # optional
   lang: zh                  # zh (default) or en; picks the typography
   ---
   ```

4. Run **预检并预览当前笔记** (preview) to check the rendering, then **发布当前笔记到公众号草稿箱**
   (publish) to create the draft.

## What it handles

**Images.** Standard Markdown (`![](./images/photo.jpg)`) and Obsidian wiki embeds
(`![[photo.jpg]]`) both work, in the body and for the cover. Relative references (`./`, `../`)
resolve against the note's folder, a leading `/` against the vault root, and remote `http(s)` images
are downloaded and re-uploaded. JPEG and PNG under WeChat's 1 MB limit are uploaded untouched, so
quality and transparency survive; anything larger is scaled and re-encoded. Covers are cropped to
the 900×500 thumbnail WeChat wants. The body endpoint takes no GIF, so an animated one is uploaded
as its first frame.

**Missing pieces.** A note without a title, digest, author or cover is not rejected. The cover
picker offers candidates best guess first — the bundle's own images, then the note's pictures, then
its folder, then the vault — each with a thumbnail. The confirmation dialog asks for whatever text
is still missing, within WeChat's own length limits. With **Remember what you fill in** enabled
(the default), your answers are written back to the note's frontmatter, so the next publish asks
nothing.

**Bundles.** An article can be a folder rather than a single note, matching the layout the base
library publishes from the command line:

```
my-article/
├── index.md      shared, language-independent frontmatter — the cover in particular
├── zh.md         title and description, which are per-language by nature
├── en.md
└── images/
    └── cover.jpg
```

Running the command on a translation picks up the `index.md` beside it, and anything the
translation names itself wins. Running it on `index.md` asks which translation to publish. The
filename decides the typography, ahead of any `lang` in the frontmatter. A cover at
`images/cover.*` is used without asking. Write-back always goes to the translation you published.

**Failures.** If the draft cannot be created, the cover's permanent-material slot is given back
rather than left orphaned in your account. If any image reference was not replaced with the URL
WeChat returned, publishing aborts instead of shipping a draft whose pictures only load in your
vault.

## Why the plugin reads a file outside the vault

Storing the AppSecret in the plugin's `data.json` would put it wherever your vault syncs — iCloud,
Obsidian Sync, a git remote — and Obsidian gives plugins no sandbox from one another, so any other
installed plugin could read it. The AppSecret is the account's master credential: it can send mass
messages, rewrite menus and enumerate followers, far beyond what this plugin needs. Keeping it in a
file you control, and whitelisting your IP in the WeChat console, are the two things that actually
contain the damage if it leaks.

For the same reason the plugin uses Node's `fs` to read that one file — the vault API cannot reach
outside the vault — and lists the vault's images to offer you covers. Neither is used for anything
else.

## Development

```bash
npm install
npm test        # unit tests for the pure logic
npm run lint    # the same rules the plugin directory's review runs
npm run build
```

`npm run deploy` copies the build into the vaults listed in `scripts/deploy.mjs`.

## Releasing

Bump the version in `manifest.json`, `package.json` and `versions.json`, then push a tag that
matches it exactly:

```bash
git tag -a 0.1.2 -m 0.1.2 && git push origin main 0.1.2
```

GitHub Actions checks the tag against the manifest, runs the tests, builds, and opens a **draft**
release with `main.js`, `manifest.json` and `styles.css` attached. Publishing it stays a manual
step.

## License

MIT — see [LICENSE](LICENSE).
