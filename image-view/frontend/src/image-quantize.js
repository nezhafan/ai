function getRange(pixels, channel) {
  let min = 255;
  let max = 0;
  for (const p of pixels) {
    if (p[channel] < min) min = p[channel];
    if (p[channel] > max) max = p[channel];
  }
  return max - min;
}

function splitBox(pixels) {
  if (pixels.length <= 1) return [pixels];

  const ranges = [getRange(pixels, 0), getRange(pixels, 1), getRange(pixels, 2)];
  const channel = ranges.indexOf(Math.max(...ranges));
  pixels.sort((a, b) => a[channel] - b[channel]);

  const mid = Math.floor(pixels.length / 2);
  return [pixels.slice(0, mid), pixels.slice(mid)];
}

function buildPalette(pixels, depth) {
  if (pixels.length === 0) return [];

  if (depth === 0 || pixels.length <= 1) {
    const avg = [0, 0, 0, 0];
    for (const p of pixels) {
      avg[0] += p[0];
      avg[1] += p[1];
      avg[2] += p[2];
      avg[3] += p[3];
    }
    avg[0] = Math.round(avg[0] / pixels.length);
    avg[1] = Math.round(avg[1] / pixels.length);
    avg[2] = Math.round(avg[2] / pixels.length);
    avg[3] = Math.round(avg[3] / pixels.length);
    return [avg];
  }

  const boxes = splitBox(pixels);
  const palette = [];
  for (const box of boxes) {
    palette.push(...buildPalette(box, depth - 1));
  }
  return palette;
}

export function medianCutQuantize(imageData, maxColors = 256) {
  const pixels = [];
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    pixels.push([data[i], data[i + 1], data[i + 2], data[i + 3]]);
  }

  const depth = Math.ceil(Math.log2(maxColors));
  const palette = buildPalette(pixels, depth).slice(0, maxColors);

  return { palette };
}

function findNearestColor(rgb, palette) {
  let minDist = Infinity;
  let nearest = palette[0];
  for (const color of palette) {
    const dr = rgb[0] - color[0];
    const dg = rgb[1] - color[1];
    const db = rgb[2] - color[2];
    const dist = dr * dr + dg * dg + db * db;
    if (dist < minDist) {
      minDist = dist;
      nearest = color;
    }
  }
  return nearest;
}

function clampByte(v) {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

export function quantizeImageData(imageData, numColors, { dither = true } = {}) {
  if (!numColors || numColors <= 0) {
    return {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
  }

  const { palette } = medianCutQuantize(imageData, numColors);
  if (palette.length === 0) {
    return {
      data: new Uint8ClampedArray(imageData.data),
      width: imageData.width,
      height: imageData.height,
    };
  }

  const width = imageData.width;
  const height = imageData.height;
  const source = imageData.data;
  const out = new Uint8ClampedArray(source.length);
  const work = new Float32Array(source.length);

  for (let i = 0; i < source.length; i++) {
    work[i] = source[i];
    out[i] = source[i];
  }

  function addError(x, y, er, eg, eb, factor) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const idx = (y * width + x) * 4;
    work[idx] += er * factor;
    work[idx + 1] += eg * factor;
    work[idx + 2] += eb * factor;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const oldR = clampByte(work[idx]);
      const oldG = clampByte(work[idx + 1]);
      const oldB = clampByte(work[idx + 2]);
      const alpha = source[idx + 3];

      const nearest = findNearestColor([oldR, oldG, oldB], palette);
      out[idx] = nearest[0];
      out[idx + 1] = nearest[1];
      out[idx + 2] = nearest[2];
      out[idx + 3] = alpha;

      if (!dither) continue;

      const errR = oldR - nearest[0];
      const errG = oldG - nearest[1];
      const errB = oldB - nearest[2];

      addError(x + 1, y, errR, errG, errB, 7 / 16);
      addError(x - 1, y + 1, errR, errG, errB, 3 / 16);
      addError(x, y + 1, errR, errG, errB, 5 / 16);
      addError(x + 1, y + 1, errR, errG, errB, 1 / 16);
    }
  }

  return { data: out, width, height };
}
