import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

export interface Credentials {
  appId: string;
  appSecret: string;
  author: string;
}

/** Conventional dotenv names, so an existing project .env can be reused as-is. */
const APP_ID_KEY = 'WECHAT_APP_ID';
const APP_SECRET_KEY = 'WECHAT_APP_SECRET';
const AUTHOR_KEY = 'WECHAT_AUTHOR';

function expandHome(path: string): string {
  const trimmed = path.trim();
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/')) return resolve(homedir(), trimmed.slice(2));
  return trimmed;
}

/**
 * Read the subset of dotenv syntax that credential files actually use: `KEY=value`, an optional
 * `export` prefix, optional quotes, `#` comments. Anything fancier belongs in a real dotenv parser.
 */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match?.[1]) continue;
    let value = (match[2] ?? '').trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n');
    } else {
      value = value.split(' #', 1)[0]!.trim();
    }
    values[match[1]] = value;
  }
  return values;
}

export async function loadCredentials(path: string): Promise<Credentials> {
  const absolute = expandHome(path);
  if (!isAbsolute(absolute)) throw new Error(`凭证文件路径必须是绝对路径：${path}`);

  let text: string;
  try {
    text = await readFile(absolute, 'utf8');
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? '文件不存在' : String(error);
    throw new Error(`读取凭证文件失败（${absolute}）：${reason}`);
  }

  const values = parseEnv(text);
  const credentials: Credentials = {
    appId: values[APP_ID_KEY] ?? '',
    appSecret: values[APP_SECRET_KEY] ?? '',
    author: values[AUTHOR_KEY] ?? '',
  };
  const missing = ([[APP_ID_KEY, 'appId'], [APP_SECRET_KEY, 'appSecret']] as const)
    .filter(([, key]) => !credentials[key])
    .map(([name]) => name);
  if (missing.length) throw new Error(`凭证文件缺少 ${missing.join('、')}（${absolute}）。`);
  return credentials;
}

/** Show enough of an AppID to recognise it, and never any of the secret. */
export const maskAppId = (appId: string): string => appId.length <= 6 ? appId : `${appId.slice(0, 4)}…${appId.slice(-4)}`;
