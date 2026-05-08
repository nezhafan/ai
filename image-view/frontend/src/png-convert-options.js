function getExtension(path) {
  return path?.split(".").pop()?.toLowerCase() || "";
}

export function shouldShowOriginalPngColorOption(path) {
  return getExtension(path) !== "png";
}
