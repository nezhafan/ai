import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAdaptiveJpegQualityPlan,
  DEFAULT_EDITED_JPEG_QUALITY,
  MAX_SAFE_JPEG_QUALITY,
  getTargetJpegByteBudget,
  resolveJpegQuality,
} from "./jpeg-quality.js";

test("resolveJpegQuality uses the edited-image default when no quality is requested", () => {
  assert.equal(resolveJpegQuality(undefined), DEFAULT_EDITED_JPEG_QUALITY);
});

test("resolveJpegQuality caps overly aggressive jpeg quality values", () => {
  assert.equal(resolveJpegQuality(1), MAX_SAFE_JPEG_QUALITY);
  assert.equal(resolveJpegQuality(0.95), MAX_SAFE_JPEG_QUALITY);
});

test("resolveJpegQuality keeps moderate requested jpeg quality values", () => {
  assert.equal(resolveJpegQuality(0.85), 0.85);
  assert.equal(resolveJpegQuality(0.5), 0.5);
});

test("getTargetJpegByteBudget targets the original jpeg size", () => {
  assert.equal(
    getTargetJpegByteBudget({ sourceMime: "image/jpeg", sourceBytes: 300_000 }),
    300_000
  );
  assert.equal(
    getTargetJpegByteBudget({ sourceMime: "image/png", sourceBytes: 300_000 }),
    null
  );
});

test("buildAdaptiveJpegQualityPlan descends from the requested quality", () => {
  assert.deepEqual(
    buildAdaptiveJpegQualityPlan(0.92).slice(0, 5),
    [0.92, 0.9, 0.88, 0.86, 0.84]
  );
});
