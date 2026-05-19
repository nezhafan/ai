import type { PreviewEvent, ProcessingStageEvent, WailsRuntimeBindings } from "@/types";

export type Unsubscribe = () => void;

function getRuntime(): WailsRuntimeBindings | undefined {
  return window.runtime;
}

export function listenEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): Unsubscribe {
  const runtime = getRuntime();
  if (!runtime?.EventsOn) {
    return () => {};
  }

  const unsubscribe = runtime.EventsOn<T>(eventName, handler);
  if (typeof unsubscribe === "function") {
    return unsubscribe;
  }

  return () => {
    runtime.EventsOff?.(eventName);
  };
}

export function listenImageProcessingStage(
  handler: (payload: ProcessingStageEvent) => void,
): Unsubscribe {
  return listenEvent<ProcessingStageEvent>("image-processing-stage", handler);
}

export function listenImagePreview(
  handler: (payload: PreviewEvent) => void,
): Unsubscribe {
  return listenEvent<PreviewEvent>("image-preview", handler);
}
