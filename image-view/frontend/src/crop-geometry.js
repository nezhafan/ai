export function clampCropToBounds(region, bounds) {
  const out = { ...region };
  if (out.width < 1) out.width = 1;
  if (out.height < 1) out.height = 1;
  if (out.x < bounds.left) out.x = bounds.left;
  if (out.y < bounds.top) out.y = bounds.top;
  if (out.x + out.width > bounds.right) out.width = bounds.right - out.x;
  if (out.y + out.height > bounds.bottom) out.height = bounds.bottom - out.y;
  if (out.width < 1) out.width = 1;
  if (out.height < 1) out.height = 1;
  return out;
}

export function fitCropRegionToRatioWithinBounds(region, bounds, ratio) {
  if (!region) return null;
  if (!(ratio > 0)) return clampCropToBounds(region, bounds);

  const centerX = region.x + region.width / 2;
  const centerY = region.y + region.height / 2;

  let width = region.width;
  let height = region.height;

  if (width > height * ratio) {
    width = height * ratio;
  } else {
    height = width / ratio;
  }

  const maxHalfWidth = Math.max(0.5, Math.min(centerX - bounds.left, bounds.right - centerX));
  const maxHalfHeight = Math.max(0.5, Math.min(centerY - bounds.top, bounds.bottom - centerY));
  const maxWidthByBounds = Math.min(maxHalfWidth * 2, maxHalfHeight * 2 * ratio);

  width = Math.max(1, Math.min(width, maxWidthByBounds));
  height = width / ratio;

  return clampCropToBounds({
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height,
  }, bounds);
}

function resizeWithCornerRatio(rect, handle, mouseX, mouseY, bounds, ratio) {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const anchor = {
    nw: { x: right, y: bottom },
    ne: { x: rect.x, y: bottom },
    sw: { x: right, y: rect.y },
    se: { x: rect.x, y: rect.y },
  }[handle];

  if (!anchor) return null;

  const movingLeft = handle.includes("w");
  const movingUp = handle.includes("n");

  const dx = Math.abs(mouseX - anchor.x);
  const dy = Math.abs(mouseY - anchor.y);

  let width = Math.max(dx, dy * ratio);

  const maxWByX = movingLeft ? anchor.x - bounds.left : bounds.right - anchor.x;
  const maxHByY = movingUp ? anchor.y - bounds.top : bounds.bottom - anchor.y;
  const maxWByY = maxHByY * ratio;
  const maxWidth = Math.max(1, Math.min(maxWByX, maxWByY));

  width = Math.max(1, Math.min(width, maxWidth));
  const height = width / ratio;

  const region = {
    x: movingLeft ? anchor.x - width : anchor.x,
    y: movingUp ? anchor.y - height : anchor.y,
    width,
    height,
  };

  return clampCropToBounds(region, bounds);
}

export function resizeCropRegionWithHandle(rect, handle, mouseX, mouseY, bounds, ratio = 0) {
  if (ratio > 0 && (handle === "nw" || handle === "ne" || handle === "sw" || handle === "se")) {
    const locked = resizeWithCornerRatio(rect, handle, mouseX, mouseY, bounds, ratio);
    if (locked) return locked;
  }

  let left = rect.x;
  let top = rect.y;
  let right = rect.x + rect.width;
  let bottom = rect.y + rect.height;

  if (handle.includes("w")) left = Math.min(mouseX, right - 1);
  if (handle.includes("e")) right = Math.max(mouseX, left + 1);
  if (handle.includes("n")) top = Math.min(mouseY, bottom - 1);
  if (handle.includes("s")) bottom = Math.max(mouseY, top + 1);

  const resized = {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };

  return clampCropToBounds(resized, bounds);
}
