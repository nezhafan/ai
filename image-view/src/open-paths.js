export function pickIncomingPath(paths, isImagePath) {
  if (!Array.isArray(paths) || paths.length === 0) return null;

  const stringPaths = paths
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

  if (stringPaths.length === 0) return null;

  const imageCandidate = stringPaths.find((item) => isImagePath(item));
  if (imageCandidate) return imageCandidate;

  return stringPaths[0];
}

export function collectIncomingImagePaths(paths, isImagePath) {
  if (!Array.isArray(paths) || paths.length === 0) return [];

  return paths
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && isImagePath(item));
}

export function createRequestGate() {
  let current = 0;

  return {
    next() {
      current += 1;
      return current;
    },
    isCurrent(token) {
      return token === current;
    },
  };
}
