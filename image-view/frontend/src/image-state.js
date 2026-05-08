export function getResetImageState({ defaultScale, defaultRotation, defaultImageOffset, originalPath }) {
  return {
    scale: defaultScale,
    rotation: defaultRotation,
    imageOffset: { ...defaultImageOffset },
    sourcePath: originalPath,
  };
}

export function getNextInitialSize({ currentWidth, currentHeight, naturalWidth, naturalHeight, replace = false }) {
  if (!naturalWidth || !naturalHeight) {
    return { width: currentWidth, height: currentHeight };
  }

  if (replace || currentWidth === 0 || currentHeight === 0) {
    return { width: naturalWidth, height: naturalHeight };
  }

  return { width: currentWidth, height: currentHeight };
}
