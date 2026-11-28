import { describe, test, expect, vi } from "vitest";

// DOMPurify needs a real DOM, which the unit (node) project does not provide —
// a recording pass-through stands in for the sanitizer (same approach as
// markdown.test.js).
vi.mock("dompurify", () => ({
  default: {
    sanitize: (html) => html,
  },
}));

// The highlighter is normally a lazy dynamic import; pin it to a tiny fake so
// the test controls exactly when "highlight.js has loaded" happens.
const fakeHljs = {
  getLanguage: (lang) => lang === "js",
  // Real hljs returns { value } — keep the shape.
  highlight: (code) => ({ value: `<span class="hljs-keyword">${code}</span>` }),
  highlightAuto: (code) => ({ value: `<span class="hljs-auto">${code}</span>` }),
};
vi.mock("highlight.js/lib/common", () => ({ default: fakeHljs }));

import {
  isMarkdownHighlighterReady,
  preloadMarkdownHighlighter,
  renderMarkdownBlock,
} from "../../src/utils/markdown.js";

const CODE_MESSAGE = "```js\nconst answer = 42;\n```";

describe("markdown — code blocks re-render once highlight.js loads", () => {
  test("first render (hljs missing) produces plain escaped code, not cached", async () => {
    expect(isMarkdownHighlighterReady()).toBe(false);

    const plain = renderMarkdownBlock(CODE_MESSAGE);
    expect(plain).toContain("sb-code-block");
    // Plain output: the code is escaped, no highlight spans yet.
    expect(plain).toContain("const answer = 42;");
    expect(plain).not.toContain("hljs-keyword");
    expect(plain).not.toContain("hljs-auto");
  });

  test("after the highlighter loads the same text renders highlighted", async () => {
    await preloadMarkdownHighlighter();
    expect(isMarkdownHighlighterReady()).toBe(true);

    const highlighted = renderMarkdownBlock(CODE_MESSAGE);
    expect(highlighted).toContain("sb-code-block");
    // If the pre-highlight output had been cached (the old bug), this render
    // would still return the plain escaped code without any hljs markup.
    expect(highlighted).toContain("hljs-keyword");
  });

  test("non-code markdown keeps being served from cache after hljs loads", () => {
    const text = "hello *world*";
    const first = renderMarkdownBlock(text);
    const second = renderMarkdownBlock(text);
    expect(second).toBe(first);
    expect(second).toContain("<em>world</em>");
  });

  test("highlightAuto is used for unknown languages", () => {
    const out = renderMarkdownBlock("```\nsomething\n```");
    expect(out).toContain("hljs-auto");
  });
});
