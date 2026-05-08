export function createDefaultViewState() {
  return {
    scale: 1,
    rotation: 0,
    imageOffset: { x: 0, y: 0 },
    hasChanges: false,
    isCropping: false,
  };
}

export function getCropButtonAction({ isCropping, hasSelection }) {
  if (isCropping) {
    return hasSelection ? "confirm" : "cancel";
  }

  return "start";
}

export function isAspectRatioMatch(value, expected, epsilon = 0.01) {
  if (!Number.isFinite(value) || !Number.isFinite(expected)) {
    return false;
  }

  return Math.abs(value - expected) <= epsilon;
}

export function shouldRenderAdjustPreview({ brightness = 0, contrast = 0, activeFilter = "none" }) {
  return brightness !== 0 || contrast !== 0 || activeFilter !== "none";
}
