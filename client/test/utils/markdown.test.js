import { describe, test, expect, vi, beforeEach } from "vitest";

// DOMPurify needs a real DOM, which the unit (node) project does not provide.
// The tests below verify the escaping/renderer contract, so a recording
// pass-through stands in for the sanitizer; the FORBID_TAGS contract test
// pins the sanitizer configuration that the browser build relies on.
const domPurifyState = vi.hoisted(() => ({ lastOptions: null }));

vi.mock("dompurify", () => ({
  default: {
    sanitize: (html, options) => {
      domPurifyState.lastOptions = options;
      return html;
    },
  },
}));

import { renderMarkdownBlock, renderMarkdownInline } from "../../src/utils/markdown.js";

describe("markdown HTML injection hardening (fenced-code bypass)", () => {
  beforeEach(() => {
    domPurifyState.lastOptions = null;
  });

  // The old behaviour: a ``` fence skipped escapeMarkdownHtmlTags for the
  // whole message, so raw HTML after the fence went through marked and
  // DOMPurify's default allow-list — <style>, <form>, <input>, <img> all
  // rendered as live elements.
  test("escapes raw HTML outside a fence instead of rendering it", () => {
    const html = renderMarkdownBlock(
      "```\nx\n```\n<style>body{display:none}</style><form action=https://evil.test><input type=password>",
    );

    expect(html).toContain("sb-code-block"); // the fence still renders as code
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<form[\s>]/i);
    expect(html).not.toMatch(/<input[\s>]/i);
    expect(html).toContain("&lt;style&gt;body{display:none}&lt;/style&gt;");
  });

  test("escapes hand-written inline HTML tags in a fenced message", () => {
    const html = renderMarkdownBlock(
      "```\nx\n```\ntext <img src=https://tracker.example> more",
    );

    expect(html).not.toMatch(/<img[\s>]/i);
    expect(html).toContain("&lt;img src=https://tracker.example&gt;");
  });

  test("escapes raw HTML in messages without fences (fallback path)", () => {
    const html = renderMarkdownBlock("<b>bold</b> and <iframe src=//evil.test></iframe>");

    expect(html).not.toMatch(/<b>/i);
    expect(html).not.toMatch(/<iframe[\s>]/i);
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("markdown images are still rendered (product feature, not raw HTML)", () => {
    const html = renderMarkdownBlock("![logo](https://example.com/cat.png)");

    expect(html).toMatch(/<img[^>]+src="https:\/\/example\.com\/cat\.png"/);
    expect(html).toMatch(/alt="logo"/);
  });

  test("links still render through the hardened renderer", () => {
    const html = renderMarkdownBlock("[site](https://example.test)");

    expect(html).toContain('<a href="https://example.test"');
    expect(html).toContain('class="sb-link"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("fenced code content stays escaped text (no double escape regression)", () => {
    const html = renderMarkdownBlock("```\n<div>&amp;</div>\n```");

    expect(html).toContain("sb-code-block");
    expect(html).toContain("&lt;div&gt;");
    expect(html).toContain("&amp;amp;");
  });

  test("inline renderer keeps escaping raw HTML", () => {
    const html = renderMarkdownInline("<script>alert(1)</script>");

    expect(html).not.toMatch(/<script[\s>]/i);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});

describe("DOMPurify sanitizer configuration", () => {
  test("forbids style/form/iframe/script-alike tags, keeps img and the copy button", () => {
    renderMarkdownBlock("hello ```\ncode\n``` world");

    const options = domPurifyState.lastOptions;
    expect(options).toBeTruthy();
    const forbid = options.FORBID_TAGS || [];
    for (const tag of [
      "style",
      "form",
      "input",
      "textarea",
      "select",
      "iframe",
      "object",
      "embed",
      "link",
      "meta",
      "base",
      "script",
      "noscript",
      "template",
    ]) {
      expect(forbid).toContain(tag);
    }
    // Markdown images and the code-block copy button must keep working.
    expect(forbid).not.toContain("img");
    expect(forbid).not.toContain("button");
    expect(options.ADD_TAGS).toContain("button");
    expect(options.ADD_TAGS).toContain("div");
  });
});
