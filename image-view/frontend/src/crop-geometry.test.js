import test from "node:test";
import assert from "node:assert/strict";

import { clampCropToBounds, fitCropRegionToRatioWithinBounds } from "./crop-geometry.js";

test("fitCropRegionToRatioWithinBounds keeps the crop region inside image bounds", () => {
  const bounds = { left: 0, top: 0, right: 1000, bottom: 800 };
  const region = { x: 760, y: 200, width: 220, height: 300 };

  const next = fitCropRegionToRatioWithinBounds(region, bounds, 4 / 3);

  assert.equal(next.x >= bounds.left, true);
  assert.equal(next.y >= bounds.top, true);
  assert.equal(next.x + next.width <= bounds.right, true);
  assert.equal(next.y + next.height <= bounds.bottom, true);
  assert.ok(Math.abs(next.width / next.height - 4 / 3) < 0.01);
});

test("clampCropToBounds brings a rotated free-form crop back inside image bounds", () => {
  const bounds = { left: 100, top: 50, right: 500, bottom: 350 };
  const region = { x: 420, y: 260, width: 140, height: 120 };

  const next = clampCropToBounds(region, bounds);

  assert.equal(next.x >= bounds.left, true);
  assert.equal(next.y >= bounds.top, true);
  assert.equal(next.x + next.width <= bounds.right, true);
  assert.equal(next.y + next.height <= bounds.bottom, true);
});
