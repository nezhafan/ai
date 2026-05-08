import test from "node:test";
import assert from "node:assert/strict";

import { getNextInitialSize, getResetImageState } from "./image-state.js";

test("getResetImageState restores default transform state without keeping resized dimensions", () => {
  const out = getResetImageState({
    defaultScale: 1,
    defaultRotation: 0,
    defaultImageOffset: { x: 0, y: 0 },
    originalPath: "/tmp/source.jpg",
  });

  assert.deepEqual(out, {
    scale: 1,
    rotation: 0,
    imageOffset: { x: 0, y: 0 },
    sourcePath: "/tmp/source.jpg",
  });
});

test("getNextInitialSize replaces thumbnail dimensions with full image dimensions", () => {
  const out = getNextInitialSize({
    currentWidth: 800,
    currentHeight: 453,
    naturalWidth: 4032,
    naturalHeight: 2268,
    replace: true,
  });

  assert.deepEqual(out, { width: 4032, height: 2268 });
});
