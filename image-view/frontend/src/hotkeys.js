export function shouldHandleGlobalHotkey(event) {
  const target = event?.target;
  if (!target) return true;

  const tagName = typeof target.tagName === "string" ? target.tagName.toUpperCase() : "";
  if (tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT") {
    return false;
  }

  if (target.isContentEditable) {
    return false;
  }

  if (typeof target.closest === "function" && target.closest("input, textarea, select, [contenteditable='true']")) {
    return false;
  }

  return true;
}
