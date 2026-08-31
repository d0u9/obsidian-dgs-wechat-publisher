// Copy the built plugin into every vault that runs it. Build output only: data.json holds the
// vault's own settings (and, unless a credentials file is configured, its secret), so it is never
// touched here.
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ID = 'obsidian-dgs-wechat-publisher';
const ARTIFACTS = ['main.js', 'manifest.json', 'styles.css'];

const VAULTS = [
  { name: 'local', path: join(homedir(), 'Documents/Obsidian/Douglas.S Local') },
  { name: 'iCloud', path: join(homedir(), 'Library/Mobile Documents/iCloud~md~obsidian/Documents/Douglas.S') },
];

const root = dirname(dirname(fileURLToPath(import.meta.url)));

for (const artifact of ARTIFACTS) {
  await stat(join(root, artifact)).catch(() => {
    console.error(`缺少 ${artifact}，请先运行 npm run build。`);
    process.exit(1);
  });
}

for (const vault of VAULTS) {
  const target = join(vault.path, '.obsidian/plugins', PLUGIN_ID);
  if (target === root) {
    console.log(`${vault.name}: 就地构建，无需复制（${target}）`);
    continue;
  }
  if (!await stat(vault.path).then(() => true).catch(() => false)) {
    console.warn(`${vault.name}: 跳过，Vault 不存在（${vault.path}）`);
    continue;
  }
  await mkdir(target, { recursive: true });
  for (const artifact of ARTIFACTS) await copyFile(join(root, artifact), join(target, artifact));
  console.log(`${vault.name}: 已部署 → ${target}`);
}

console.log('在每个 Vault 里用 Ctrl/Cmd+P → “Reload app without saving” 让改动生效。');
