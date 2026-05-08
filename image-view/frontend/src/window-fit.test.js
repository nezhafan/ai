import test from "node:test";
import assert from "node:assert/strict";

import { calculateAutoFitWindowSize } from "./window-fit.js";

test("calculateAutoFitWindowSize uses tight image size without forced large minimums", () => {
  const out = calculateAutoFitWindowSize({
    imageWidth: 240,
    imageHeight: 160,
    toolbarHeight: 40,
    workAreaWidth: 1920,
    workAreaHeight: 1080,
    scaleFactor: 1,
    minWidth: 100,
    minHeight: 100,
    chromeHeight: 34,
    paddingX: 0,
    paddingY: 0,
  });

  assert.deepEqual(out, { width: 240, height: 234 });
});

test("calculateAutoFitWindowSize clamps to monitor work area", () => {
  const out = calculateAutoFitWindowSize({
    imageWidth: 4000,
    imageHeight: 3000,
    toolbarHeight: 40,
    workAreaWidth: 1920,
    workAreaHeight: 1080,
    scaleFactor: 1,
    maxUsageRatio: 0.98,
    minWidth: 100,
    minHeight: 100,
  });

  assert.deepEqual(out, { width: 1312, height: 1058 });
});

test("calculateAutoFitWindowSize scales tall images proportionally to the available work area", () => {
  const out = calculateAutoFitWindowSize({
    imageWidth: 1200,
    imageHeight: 3000,
    toolbarHeight: 40,
    workAreaWidth: 1400,
    workAreaHeight: 1000,
    scaleFactor: 1,
    maxUsageRatio: 0.98,
    minWidth: 100,
    minHeight: 100,
    chromeHeight: 34,
    paddingX: 0,
    paddingY: 0,
  });

  assert.deepEqual(out, { width: 362, height: 980 });
});

test("calculateAutoFitWindowSize respects the 800x600 minimum default window size", () => {
  const out = calculateAutoFitWindowSize({
    imageWidth: 240,
    imageHeight: 160,
    toolbarHeight: 40,
    workAreaWidth: 1920,
    workAreaHeight: 1080,
    scaleFactor: 1,
    minWidth: 800,
    minHeight: 600,
    chromeHeight: 34,
    paddingX: 0,
    paddingY: 0,
  });

  assert.deepEqual(out, { width: 800, height: 600 });
});
