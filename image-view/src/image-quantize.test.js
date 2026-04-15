import test from "node:test";
import assert from "node:assert/strict";
import { quantizeImageData } from "./image-quantize.js";

function createGradientImageData(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[idx++] = Math.round((x / (width - 1)) * 255);
      data[idx++] = Math.round((y / (height - 1)) * 255);
      data[idx++] = Math.round((((x + y) / 2) / ((width + height - 2) / 2)) * 255);
      data[idx++] = 255;
    }
  }
  return { data, width, height };
}

function countUniqueRgba(data) {
  const set = new Set();
  for (let i = 0; i < data.length; i += 4) {
    set.add(`${data[i]},${data[i + 1]},${data[i + 2]},${data[i + 3]}`);
  }
  return set.size;
}

test("quantizeImageData limits colors to requested max", () => {
  const imageData = createGradientImageData(64, 64);
  const out = quantizeImageData(imageData, 16, { dither: true });
  assert.ok(countUniqueRgba(out.data) <= 16);
});

test("quantizeImageData with dither differs from non-dither", () => {
  const imageData = createGradientImageData(32, 32);
  const outNoDither = quantizeImageData(imageData, 16, { dither: false });
  const outDither = quantizeImageData(imageData, 16, { dither: true });

  assert.notDeepEqual(Array.from(outNoDither.data), Array.from(outDither.data));
});
