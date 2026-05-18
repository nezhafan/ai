import type { ProcessingStageEvent, WailsRuntimeBindings } from "@/types";

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
