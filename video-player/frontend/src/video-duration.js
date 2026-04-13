export function parseCorrectedDuration(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function getEffectiveDuration(video) {
  const correctedDuration = parseCorrectedDuration(video?.dataset?.svpExpectedDuration);
  if (correctedDuration > 0) {
    return correctedDuration;
  }

  const mediaDuration = Number(video?.duration);
  return Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : 0;
}
