import { useState } from "react";
import {
  inspectImages as inspectImagesWithWails,
  processImage as processImageWithWails,
  processImages as processImagesWithWails,
  selectImageFiles,
  selectImageFolder,
  selectOutputDirectory,
} from "@/lib/wails";
import type {
  BatchProcessResult,
  ImageFileInfo,
  ProcessResult,
  ProcessingOptions,
} from "@/types";

function formatError(prefix: string, error: unknown) {
  if (error instanceof Error) {
    return `${prefix}: ${error.message}`;
  }

  return `${prefix}: ${String(error)}`;
}

export function useImageProcessing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFiles = async () => {
    try {
      const selected = await selectImageFiles();
      return selected ?? [];
    } catch (e) {
      setError(formatError("选择文件失败", e));
      return [];
    }
  };

  const selectFolder = async () => {
    try {
      const selected = await selectImageFolder();
      return selected ?? [];
    } catch (e) {
      setError(formatError("选择文件夹失败", e));
      return [];
    }
  };

  const selectOutput = async () => {
    try {
      return await selectOutputDirectory();
    } catch (e) {
      setError(formatError("选择输出目录失败", e));
      return null;
    }
  };

  const processImages = async (
    inputPaths: string[],
    options: ProcessingOptions,
    outputDir?: string,
  ): Promise<BatchProcessResult | null> => {
    setLoading(true);
    setError(null);
    try {
      return await processImagesWithWails(inputPaths, options, outputDir);
    } catch (e) {
      setError(formatError("处理失败", e));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const processImage = async (
    inputPath: string,
    options: ProcessingOptions,
    outputDir?: string,
  ): Promise<ProcessResult | null> => {
    setLoading(true);
    setError(null);
    try {
      return await processImageWithWails(inputPath, options, outputDir);
    } catch (e) {
      setError(formatError("处理失败", e));
      return null;
    } finally {
      setLoading(false);
    }
  };

  const inspectImages = async (inputPaths: string[]): Promise<ImageFileInfo[]> => {
    setError(null);
    try {
      return await inspectImagesWithWails(inputPaths);
    } catch (e) {
      setError(formatError("读取图片信息失败", e));
      return [];
    }
  };

  return {
    loading,
    error,
    selectFiles,
    selectFolder,
    selectOutputDirectory: selectOutput,
    inspectImages,
    processImage,
    processImages,
  };
}
