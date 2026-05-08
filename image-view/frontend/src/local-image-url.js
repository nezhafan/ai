export function buildLocalImageURL(path) {
  return `/local-file?path=${encodeURIComponent(path)}`;
}

export function shouldRevokeObjectURL(url) {
  return typeof url === "string" && url.startsWith("blob:");
}
