import test from "node:test";
import assert from "node:assert/strict";
import { shouldHandleGlobalHotkey } from "./hotkeys.js";

test("ignores global hotkeys when target is input", () => {
  const event = {
    target: {
      tagName: "INPUT",
      isContentEditable: false,
      closest: () => null,
    },
  };

  assert.equal(shouldHandleGlobalHotkey(event), false);
});

test("handles global hotkeys on normal viewer area", () => {
  const event = {
    target: {
      tagName: "DIV",
      isContentEditable: false,
      closest: () => null,
    },
  };

  assert.equal(shouldHandleGlobalHotkey(event), true);
});

test("ignores global hotkeys in contenteditable elements", () => {
  const event = {
    target: {
      tagName: "DIV",
      isContentEditable: true,
      closest: () => null,
    },
  };

  assert.equal(shouldHandleGlobalHotkey(event), false);
});
