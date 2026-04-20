import test from "node:test";
import assert from "node:assert/strict";

import { pickIncomingPath, collectIncomingImagePaths, createRequestGate } from "./open-paths.js";

test("pickIncomingPath prefers image file when mixed with non-image paths", () => {
  const isImagePath = (p) => /\.(png|jpg|jpeg)$/i.test(p);
  const paths = [
    "/Applications/Image View.app",
    "/Users/demo/Pictures/photo.JPG",
  ];

  assert.equal(pickIncomingPath(paths, isImagePath), "/Users/demo/Pictures/photo.JPG");
});

test("pickIncomingPath falls back to first non-empty path for directories", () => {
  const isImagePath = () => false;
  const paths = ["", "   ", "/Users/demo/Pictures"];

  assert.equal(pickIncomingPath(paths, isImagePath), "/Users/demo/Pictures");
});

test("request gate marks old requests as stale", () => {
  const gate = createRequestGate();
  const first = gate.next();
  const second = gate.next();

  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
});

test("collectIncomingImagePaths returns all image candidates in order", () => {
  const isImagePath = (p) => /\.(png|jpg|jpeg|webp)$/i.test(p);
  const paths = [
    "/Applications/Image View.app",
    "/Users/demo/Pictures/a.jpg",
    "   ",
    "/Users/demo/Pictures/b.PNG",
    "/Users/demo/readme.md",
  ];

  assert.deepEqual(collectIncomingImagePaths(paths, isImagePath), [
    "/Users/demo/Pictures/a.jpg",
    "/Users/demo/Pictures/b.PNG",
  ]);
});
