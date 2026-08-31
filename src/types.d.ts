declare module 'dgs-wechat-publisher/markdown' {
  export function renderMarkdown(source: string): Promise<{
    frontmatter: Record<string, unknown>;
    html: string;
  }>;
  export function renderForWechat(source: string, options?: { lang?: string }): Promise<{
    frontmatter: Record<string, unknown>;
    html: string;
  }>;
  export function parseFrontmatter(source: string): {
    frontmatter: Record<string, unknown>;
    content: string;
  };
  export function assertSelfContained(html: string): void;
}

declare module 'dgs-wechat-publisher/converter' {
  export const wechatPublisher: {
    toWechatHtml(renderedHtml: string, options?: { lang?: string }): string;
  };
}

// The three Node builtins src/node.ts needs, declared here rather than pulled in with @types/node.
// The plugin runs in Electron and uses almost none of Node's surface; declaring just this much
// keeps the code typed wherever it is compiled or linted, including a checkout without dev
// dependencies, and documents exactly how far into Node the plugin reaches.
declare module 'node:fs/promises' {
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
}

declare module 'node:os' {
  export function homedir(): string;
}

declare module 'node:path' {
  export function isAbsolute(path: string): boolean;
  export function resolve(...segments: string[]): string;
}
