import test from "node:test";
import assert from "node:assert/strict";

import {
  createDefaultViewState,
  getCropButtonAction,
  isAspectRatioMatch,
  shouldRenderAdjustPreview,
} from "./viewer-state.js";

test("default viewer state starts with crop mode disabled", () => {
  const state = createDefaultViewState();

  assert.equal(state.isCropping, false);
  assert.equal(state.rotation, 0);
  assert.deepEqual(state.imageOffset, { x: 0, y: 0 });
});

test("crop button enters crop mode on first click when no selection exists", () => {
  assert.equal(
    getCropButtonAction({ isCropping: false, hasSelection: false }),
    "start"
  );
});

test("crop button confirms when a selection already exists", () => {
  assert.equal(
    getCropButtonAction({ isCropping: true, hasSelection: true }),
    "confirm"
  );
});

test("aspect ratio matching tolerates truncated decimal values from the DOM", () => {
  assert.equal(isAspectRatioMatch(1.333, 4 / 3), true);
  assert.equal(isAspectRatioMatch(1.5, 4 / 3), false);
});

test("adjust preview is disabled when no filter or tonal adjustments are active", () => {
  assert.equal(
    shouldRenderAdjustPreview({ brightness: 0, contrast: 0, activeFilter: "none" }),
    false
  );
  assert.equal(
    shouldRenderAdjustPreview({ brightness: 10, contrast: 0, activeFilter: "none" }),
    true
  );
});
