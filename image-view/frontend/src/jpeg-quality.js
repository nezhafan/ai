export const DEFAULT_EDITED_JPEG_QUALITY = 0.82;
export const MAX_SAFE_JPEG_QUALITY = 0.92;
export const JPEG_SIZE_TOLERANCE_RATIO = 1.0;
export const MIN_ADAPTIVE_JPEG_QUALITY = 0.5;
export const ADAPTIVE_JPEG_QUALITY_STEP = 0.02;

export function resolveJpegQuality(requestedQuality) {
  if (requestedQuality === undefined || requestedQuality === null) {
    return DEFAULT_EDITED_JPEG_QUALITY;
  }

  const normalized = Math.max(0.1, Math.min(requestedQuality, 1));
  return Math.min(normalized, MAX_SAFE_JPEG_QUALITY);
}

export function getTargetJpegByteBudget({ sourceMime, sourceBytes }) {
  if (sourceMime !== "image/jpeg" || !sourceBytes) {
    return null;
  }

  return Math.round(sourceBytes * JPEG_SIZE_TOLERANCE_RATIO);
}

export function buildAdaptiveJpegQualityPlan(requestedQuality) {
  const start = resolveJpegQuality(requestedQuality);
  const plan = [];

  for (let quality = start; quality >= MIN_ADAPTIVE_JPEG_QUALITY; quality -= ADAPTIVE_JPEG_QUALITY_STEP) {
    plan.push(Number(quality.toFixed(2)));
  }

  if (plan[plan.length - 1] !== MIN_ADAPTIVE_JPEG_QUALITY) {
    plan.push(MIN_ADAPTIVE_JPEG_QUALITY);
  }

  return [...new Set(plan)];
}
