import type {
  BatchProcessResult,
  ImageFileInfo,
  ProcessResult,
  ProcessingOptions,
  WailsAppBindings,
} from "@/types";

function getBindings(): WailsAppBindings | undefined {
  return window.go?.backend?.App;
}

function missingBindingError(methodName: keyof WailsAppBindings) {
  return new Error(
    `Wails binding backend.App.${String(methodName)} is unavailable. Generate or implement the corresponding Go binding before runtime integration.`,
  );
}

async function callBinding<TResult>(
  methodName: keyof WailsAppBindings,
  ...args: unknown[]
): Promise<TResult> {
  const bindings = getBindings();
  const method = bindings?.[methodName];

  if (typeof method !== "function") {
    throw missingBindingError(methodName);
  }

  return (method as (...callArgs: unknown[]) => Promise<TResult>)(...args);
}

export function selectImageFiles() {
  return callBinding<string[] | null | undefined>("SelectImageFiles");
}

export function selectImageFolder() {
  return callBinding<string[] | null | undefined>("SelectImageFolder");
}

export function selectOutputDirectory() {
  return callBinding<string | null | undefined>("SelectOutputDirectory");
}

export function getDefaultOutputDirectory() {
  return callBinding<string | null | undefined>("GetDefaultOutputDirectory");
}

export function inspectImages(inputPaths: string[]): Promise<ImageFileInfo[]> {
  return callBinding<ImageFileInfo[]>("InspectImages", inputPaths);
}

export function processImage(
  inputPath: string,
  options: ProcessingOptions,
  outputDir?: string,
): Promise<ProcessResult> {
  return callBinding<ProcessResult>("ProcessImage", inputPath, options, outputDir);
}

export function processImages(
  inputPaths: string[],
  options: ProcessingOptions,
  outputDir?: string,
): Promise<BatchProcessResult> {
  return callBinding<BatchProcessResult>(
    "ProcessImages",
    inputPaths,
    options,
    outputDir,
  );
}

export function generatePreviews(inputPaths: string[]) {
  const bindings = getBindings();
  bindings?.GeneratePreviews?.(inputPaths);
}

export function triggerGC() {
  const bindings = getBindings();
  bindings?.TriggerGC?.();
}
