export function calculateImageLayout(options) {
  const {
    imageWidth,
    imageHeight,
    viewerWidth,
    viewerHeight,
    rotation = 0,
  } = options;

  if (!imageWidth || !imageHeight || !viewerWidth || !viewerHeight) {
    return null;
  }

  const rotated = Math.abs(rotation % 180) === 90;
  const rotatedWidth = rotated ? imageHeight : imageWidth;
  const rotatedHeight = rotated ? imageWidth : imageHeight;
  const fitScale = Math.min(viewerWidth / rotatedWidth, viewerHeight / rotatedHeight, 1);

  return {
    renderWidth: imageWidth * fitScale,
    renderHeight: imageHeight * fitScale,
    boundsWidth: rotatedWidth * fitScale,
    boundsHeight: rotatedHeight * fitScale,
    fitScale,
  };
}
