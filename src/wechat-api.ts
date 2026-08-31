import { requestUrl } from 'obsidian';
import { PreparedImage } from './image';

const API_ROOT = 'https://api.weixin.qq.com';
const encoder = new TextEncoder();

function apiError(payload: unknown): never {
  const record = payload as { errcode?: number; errmsg?: string } | null;
  if (record?.errcode === 40164) throw new Error('微信拒绝了当前公网 IP，请把本机出口 IP 加入公众号白名单。');
  if (record?.errcode === 48001) throw new Error('公众号没有草稿或素材接口权限。');
  if (record?.errcode === 40001 || record?.errcode === 42001) throw new Error('access_token 无效或已过期，请检查 AppID/AppSecret 后重试。');
  throw new Error(`微信 API 请求失败：${JSON.stringify(payload)}`);
}

async function jsonRequest(url: string, options: { method?: string; body?: string | ArrayBuffer; headers?: Record<string, string> } = {}) {
  const response = await requestUrl({ url, method: options.method ?? 'GET', body: options.body, headers: options.headers, throw: false });
  let payload: any;
  try {
    payload = response.json;
  } catch {
    // A gateway or proxy error answers with HTML, and `response.json` throws while parsing it.
    // Report what actually came back instead of a SyntaxError from deep inside Obsidian.
    throw new Error(`微信 API 返回了非 JSON 响应（HTTP ${response.status}）：${response.text.slice(0, 200)}`);
  }
  if (response.status < 200 || response.status >= 300 || payload?.errcode) apiError(payload);
  return payload;
}

// stable_token is rate limited per app per day, and one publish makes many calls. Hold the token
// for as long as WeChat says it is good for, minus a minute of slack.
const tokens = new Map<string, { token: string; expiresAt: number }>();

export function forgetAccessToken(appId: string): void {
  tokens.delete(appId);
}

export async function getAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = tokens.get(appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const payload = await jsonRequest(`${API_ROOT}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: false }),
  });
  if (!payload.access_token) apiError(payload);
  const lifetime = typeof payload.expires_in === 'number' ? payload.expires_in : 7200;
  tokens.set(appId, { token: payload.access_token, expiresAt: Date.now() + Math.max(0, lifetime - 60) * 1000 });
  return payload.access_token;
}

function concat(chunks: Uint8Array[]): ArrayBuffer {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output.buffer;
}

async function uploadImage(token: string, endpoint: string, image: PreparedImage) {
  const boundary = `----obsidian-wechat-${Date.now().toString(16)}`;
  const head = encoder.encode(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${image.filename}"\r\nContent-Type: ${image.contentType}\r\n\r\n`);
  const tail = encoder.encode(`\r\n--${boundary}--\r\n`);
  return jsonRequest(`${API_ROOT}${endpoint}${endpoint.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body: concat([head, new Uint8Array(image.bytes), tail]),
  });
}

export async function uploadBodyImage(token: string, image: PreparedImage): Promise<string> {
  const payload = await uploadImage(token, '/cgi-bin/media/uploadimg', image);
  if (!payload.url) apiError(payload);
  return payload.url;
}

export async function uploadCover(token: string, image: PreparedImage): Promise<string> {
  const payload = await uploadImage(token, '/cgi-bin/material/add_material?type=thumb', image);
  if (!payload.media_id) apiError(payload);
  return payload.media_id;
}

/**
 * A thumb costs one slot of the account's permanent-material quota, which only the WeChat console
 * can clear. If the draft it was uploaded for never gets created, give the slot back.
 */
export async function deleteMaterial(token: string, mediaId: string): Promise<void> {
  await jsonRequest(`${API_ROOT}/cgi-bin/material/del_material?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_id: mediaId }),
  });
}

export async function createDraft(token: string, article: Record<string, unknown>): Promise<string> {
  const payload = await jsonRequest(`${API_ROOT}/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ articles: [article] }),
  });
  if (!payload.media_id) apiError(payload);
  return payload.media_id;
}
