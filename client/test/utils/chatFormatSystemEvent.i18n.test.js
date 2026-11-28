import { describe, test, expect } from "vitest";
import { getSystemEventLine } from "../../src/utils/chatFormat.js";
import { chat } from "../../src/i18n/namespaces/chat.js";

// A minimal stand-in for the i18n t() that resolves dot paths in the real
// dictionaries and interpolates {name} — same contract as the app's t().
const makeT = (dict) => (key, vars = {}) => {
  let node = dict;
  for (const part of String(key).split(".")) {
    if (node === undefined || node === null || typeof node !== "object") {
      return undefined;
    }
    node = node[part];
  }
  return String(node).replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
};

// The app dictionary is keyed by namespace: { chat: chatNamespace.en, ... }.
const tEn = makeT({ chat: chat.en });
const tFa = makeT({ chat: chat.fa });

describe("system event line localization (MessageItem)", () => {
  const events = [
    [{ type: "join", name: "Bob" }, "Bob joined the group", "Bob به گروه پیوست"],
    [
      { type: "joined", name: "Bob" },
      "Bob joined the group",
      "Bob به گروه پیوست",
    ],
    [
      { type: "left", name: "Carol" },
      "Carol left the group",
      "Carol گروه را ترک کرد",
    ],
    [
      { type: "removed", name: "Dave" },
      "Dave was removed from the group",
      "Dave از گروه حذف شد",
    ],
    [
      { type: "referred", name: "support_desk" },
      "Ticket referred to support_desk",
      "تیکت به support_desk ارجاع شد",
    ],
  ];

  test.each(events)(
    "$0 renders from the event type in en and fa",
    (event, expectedEn, expectedFa) => {
      expect(getSystemEventLine(event, tEn)).toBe(expectedEn);
      expect(getSystemEventLine(event, tFa)).toBe(expectedFa);
    },
  );

  test("a missing member name falls back to the localized 'a member'", () => {
    expect(getSystemEventLine({ type: "join", name: "" }, tEn)).toBe(
      "A member joined the group",
    );
    expect(getSystemEventLine({ type: "join" }, tFa)).toContain("یک عضو");
  });

  test("an event without a type renders nothing", () => {
    expect(getSystemEventLine(null, tEn)).toBe("");
    expect(getSystemEventLine({ name: "Bob" }, tEn)).toBe("");
  });
});
