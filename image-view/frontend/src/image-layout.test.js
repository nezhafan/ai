import test from "node:test";
import assert from "node:assert/strict";

import { calculateImageLayout } from "./image-layout.js";

test("calculateImageLayout does not upscale images smaller than the viewer", () => {
  const out = calculateImageLayout({
    imageWidth: 320,
    imageHeight: 200,
    viewerWidth: 800,
    viewerHeight: 600,
    rotation: 0,
  });

  assert.deepEqual(out, {
    renderWidth: 320,
    renderHeight: 200,
    boundsWidth: 320,
    boundsHeight: 200,
    fitScale: 1,
  });
});

test("calculateImageLayout scales by the overflowing dimension while keeping aspect ratio", () => {
  const out = calculateImageLayout({
    imageWidth: 2000,
    imageHeight: 500,
    viewerWidth: 800,
    viewerHeight: 600,
    rotation: 0,
  });

  assert.deepEqual(out, {
    renderWidth: 800,
    renderHeight: 200,
    boundsWidth: 800,
    boundsHeight: 200,
    fitScale: 0.4,
  });
});

test("calculateImageLayout reports rotated bounds separately from render size", () => {
  const out = calculateImageLayout({
    imageWidth: 600,
    imageHeight: 300,
    viewerWidth: 800,
    viewerHeight: 600,
    rotation: 90,
  });

  assert.deepEqual(out, {
    renderWidth: 600,
    renderHeight: 300,
    boundsWidth: 300,
    boundsHeight: 600,
    fitScale: 1,
  });
});
