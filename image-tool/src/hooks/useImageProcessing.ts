import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import type { BatchProcessResult, ImageFileInfo, ProcessResult, ProcessingOptions } from '@/types';

export function useImageProcessing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFiles = async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{
          name: 'Image',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif']
        }]
      });
      if (!selected) {
        return [];
      }

      return Array.isArray(selected) ? selected : [selected];
    } catch (e) {
      setError(`选择文件失败: ${e}`);
      return [];
    }
  };

  const selectOutputDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });
      return selected as string | null;
    } catch (e) {
      setError(`选择输出目录失败: ${e}`);
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
      const result = await invoke<BatchProcessResult>('process_images', {
        inputPaths,
        options,
        outputDir,
      });
      return result;
    } catch (e) {
      setError(`处理失败: ${e}`);
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
      const result = await invoke<ProcessResult>('process_image', {
        inputPath,
        options,
        outputDir,
      });
      return result;
    } catch (e) {
      setError(`处理失败: ${e}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const inspectImages = async (inputPaths: string[]): Promise<ImageFileInfo[]> => {
    setError(null);
    try {
      return await invoke<ImageFileInfo[]>('inspect_images', {
        inputPaths,
      });
    } catch (e) {
      setError(`读取图片信息失败: ${e}`);
      return [];
    }
  };

  return {
    loading,
    error,
    selectFiles,
    selectOutputDirectory,
    inspectImages,
    processImage,
    processImages,
  };
}
