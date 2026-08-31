import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSelfContained, renderForWechat } from 'dgs-wechat-publisher/markdown';

test('the pinned base library renders a publishable WeChat fragment', async () => {
  const source = `---
title: 测试文章
description: 一段摘要
cover: ./cover.jpg
---

正文。

![](./photo.jpg)
`;
  const { html } = await renderForWechat(source, { lang: 'zh' });
  assert.doesNotThrow(() => assertSelfContained(html));
  assert.match(html, /<section style=/);
  assert.match(html, /src="\.\/photo\.jpg"/);
  assert.doesNotMatch(html, /\sclass=|<style|<script/i);
});
