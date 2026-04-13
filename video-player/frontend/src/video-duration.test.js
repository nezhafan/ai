import test from "node:test";
import assert from "node:assert/strict";

import { getEffectiveDuration } from "./video-duration.js";

test("getEffectiveDuration prefers corrected metadata duration when present", () => {
  const video = {
    duration: 10968.4,
    dataset: {
      svpExpectedDuration: "5484.2",
    },
  };

  assert.equal(getEffectiveDuration(video), 5484.2);
});

test("getEffectiveDuration falls back to media element duration without corrected metadata", () => {
  const video = {
    duration: 120,
    dataset: {},
  };

  assert.equal(getEffectiveDuration(video), 120);
});
