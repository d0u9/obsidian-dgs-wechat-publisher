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
