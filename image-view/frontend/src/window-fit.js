export function calculateAutoFitWindowSize(options) {
  const {
    imageWidth,
    imageHeight,
    toolbarHeight = 0,
    workAreaWidth,
    workAreaHeight,
    scaleFactor = 1,
    minWidth = 100,
    minHeight = 100,
    chromeHeight = 34,
    paddingX = 0,
    paddingY = 0,
    maxUsageRatio = 0.98,
  } = options;

  if (!imageWidth || !imageHeight || !workAreaWidth || !workAreaHeight) {
    return null;
  }

  const logicalWorkAreaWidth = workAreaWidth / scaleFactor;
  const logicalWorkAreaHeight = workAreaHeight / scaleFactor;

  const maxLogicalWidth = Math.max(minWidth, Math.floor(logicalWorkAreaWidth * maxUsageRatio));
  const maxLogicalHeight = Math.max(minHeight, Math.floor(logicalWorkAreaHeight * maxUsageRatio));

  const reservedHeight = toolbarHeight + chromeHeight + paddingY;
  const maxContentWidth = Math.max(1, maxLogicalWidth - paddingX);
  const maxContentHeight = Math.max(1, maxLogicalHeight - reservedHeight);
  const fitScale = Math.min(maxContentWidth / imageWidth, maxContentHeight / imageHeight, 1);

  const desiredWidth = Math.round(imageWidth * fitScale + paddingX);
  const desiredHeight = Math.round(imageHeight * fitScale + reservedHeight);

  return {
    width: Math.min(maxLogicalWidth, Math.max(minWidth, desiredWidth)),
    height: Math.min(maxLogicalHeight, Math.max(minHeight, desiredHeight)),
  };
}
