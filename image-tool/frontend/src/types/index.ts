export interface ProcessingOptions {
  convertFormat?: string;
  resizeMode?: "width" | "height" | "scale" | "dimensions" | "none";
  resizeWidth?: number;
  resizeHeight?: number;
  resizeScale?: number;
  compressionType?: "none" | "preset" | "targetSize" | "quality" | "indexedColor";
  compressionPreset?: "standard" | "strong" | "256" | "128";
  compressionQuality?: CompressionQuality;
  targetRatio?: number;
}

export interface CompressionQuality {
  percent: number;
}

export interface ProcessResult {
  success: boolean;
  outputPath: string;
  originalSize: number;
  outputSize: number;
  message: string;
  steps: string[];
  durationMs: number;
}

export interface ImageFileInfo {
  path: string;
  fileName: string;
  size: number;
  width: number;
  height: number;
  previewDataUrl?: string;
}

export interface BatchProcessResult {
  success: boolean;
  totalFiles: number;
  successCount: number;
  failureCount: number;
  totalOriginalSize: number;
  totalOutputSize: number;
  outputDir?: string;
  message: string;
  failures: string[];
}

export interface ProcessingStageEvent {
  inputPath: string;
  stage:
    | "preparing"
    | "loading"
    | "transforming"
    | "saving"
    | "encoding"
    | "optimizing"
    | "writing"
    | "done";
  elapsedMs: number;
}

export interface PreviewEvent {
  inputPath: string;
  previewDataUrl: string;
}

export interface WailsAppBindings {
  SelectImageFiles?: () => Promise<string[] | null | undefined>;
  SelectImageFolder?: () => Promise<string[] | null | undefined>;
  SelectOutputDirectory?: () => Promise<string | null | undefined>;
  GetDefaultOutputDirectory?: () => Promise<string | null | undefined>;
  InspectImages?: (inputPaths: string[]) => Promise<ImageFileInfo[]>;
  ProcessImage?: (
    inputPath: string,
    options: ProcessingOptions,
    outputDir?: string,
  ) => Promise<ProcessResult>;
  ProcessImages?: (
    inputPaths: string[],
    options: ProcessingOptions,
    outputDir?: string,
  ) => Promise<BatchProcessResult>;
  GeneratePreviews?: (inputPaths: string[]) => void;
  TriggerGC?: () => void;
}

export interface WailsRuntimeBindings {
  EventsOn?: <T = unknown>(
    eventName: string,
    callback: (payload: T) => void,
  ) => (() => void) | void;
  EventsOff?: (eventName: string) => void;
}

declare global {
  interface Window {
    go?: {
      backend?: {
        App?: WailsAppBindings;
      };
    };
    runtime?: WailsRuntimeBindings;
  }
}
