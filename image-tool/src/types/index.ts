export interface ProcessingOptions {
  convertFormat?: string;
  resizeMode?: 'width' | 'height' | 'scale' | 'dimensions' | 'none';
  resizeWidth?: number;
  resizeHeight?: number;
  resizeScale?: number;
  compressionType?: 'none' | 'preset' | 'targetSize' | 'quality';
  compressionPreset?: 'standard' | 'strong';
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
