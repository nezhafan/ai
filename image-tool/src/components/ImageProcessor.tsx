import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useImageProcessing } from '@/hooks/useImageProcessing';
import type { ImageFileInfo, ProcessingOptions } from '@/types';

type ResizeMode = 'none' | 'scale' | 'dimensions';
type CompressionType = 'none' | 'preset' | 'quality';
type CompressionPreset = 'standard';
type ConvertFormat = 'none' | 'png' | 'jpg';
type FileStatus = 'idle' | 'processing' | 'done' | 'error' | 'skipped';

type ImageProcessorProps = {
  outputDir: string;
  concurrency: number;
};

type SelectedImage = ImageFileInfo & {
  status: FileStatus;
  outputSize?: number;
  outputPath?: string;
  errorMessage?: string;
  durationMs?: number;
  processingMessage?: string;
  processingStage?: ProcessingStageEvent['stage'];
  processingElapsedMs?: number;
};

type ProcessingStageEvent = {
  inputPath: string;
  stage: 'preparing' | 'loading' | 'transforming' | 'saving' | 'encoding' | 'optimizing' | 'writing' | 'done';
  elapsedMs: number;
};

const SUPPORTED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'tiff', 'avif']);
function stageLabel(stage?: ProcessingStageEvent['stage']) {
  switch (stage) {
    case 'preparing':
      return '准备中';
    case 'loading':
      return '读取中';
    case 'transforming':
      return '压缩中';
    case 'saving':
      return '保存中';
    case 'encoding':
      return '编码中';
    case 'optimizing':
      return '优化中';
    case 'writing':
      return '保存中';
    case 'done':
      return '已完成';
    default:
      return '处理中';
  }
}

function stageProgress(stage?: ProcessingStageEvent['stage']) {
  switch (stage) {
    case 'preparing':
      return 5;
    case 'loading':
      return 15;
    case 'transforming':
      return 35;
    case 'saving':
      return 48;
    case 'encoding':
      return 55;
    case 'optimizing':
      return 70;
    case 'writing':
      return 85;
    case 'done':
      return 100;
    default:
      return 4;
  }
}

function formatBytes(value?: number) {
  if (!value || value <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let index = 0;

  while (current >= 1000 && index < units.length - 1) {
    current /= 1000;
    index += 1;
  }

  const decimals = index === 0 ? 0 : 1;
  return `${current.toFixed(decimals)} ${units[index]}`;
}

function getCommonExtension(paths: string[]) {
  if (paths.length === 0) {
    return '';
  }

  const extensions = new Set(
    paths.map((path) => path.split('.').pop()?.toLowerCase() || '').filter(Boolean),
  );

  return extensions.size === 1 ? [...extensions][0] : '';
}

function isSupportedImagePath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase() || '';
  return SUPPORTED_EXTENSIONS.has(extension);
}

function mergeImageInfo(current: SelectedImage[], incoming: ImageFileInfo[]) {
  const known = new Map(current.map((item) => [item.path, item]));
  const merged = [...current];

  for (const item of incoming) {
    if (known.has(item.path)) {
      continue;
    }

    merged.push({
      ...item,
      status: 'idle',
    });
  }

  return merged;
}

function statusLabel(status: FileStatus) {
  switch (status) {
    case 'processing':
      return '处理中';
    case 'done':
      return '已完成';
    case 'skipped':
      return '不处理';
    case 'error':
      return '失败';
    default:
      return '等待中';
  }
}

function statusClassName(status: FileStatus) {
  switch (status) {
    case 'processing':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300';
    case 'done':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300';
    case 'skipped':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-500/10 dark:text-slate-300';
    case 'error':
      return 'bg-red-100 text-red-700 dark:bg-red-500/10 dark:text-red-300';
    default:
      return 'bg-stone-200 text-stone-700 dark:bg-zinc-800 dark:text-zinc-300';
  }
}

function formatSavings(originalSize?: number, outputSize?: number) {
  if (!originalSize || !outputSize || outputSize >= originalSize) {
    return null;
  }

  return `${(((originalSize - outputSize) / originalSize) * 100).toFixed(1)}%`;
}

export function ImageProcessor({ outputDir, concurrency }: ImageProcessorProps) {
  const [images, setImages] = useState<SelectedImage[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [convertFormat, setConvertFormat] = useState<ConvertFormat>('none');
  const [resizeMode, setResizeMode] = useState<ResizeMode>('none');
  const [resizeWidth, setResizeWidth] = useState<string>('');
  const [resizeHeight, setResizeHeight] = useState<string>('');
  const [resizeScale, setResizeScale] = useState<number>(50);
  const [compressionType, setCompressionType] = useState<CompressionType>('none');
  const [compressionPreset, setCompressionPreset] = useState<CompressionPreset>('standard');
  const [compressionQuality, setCompressionQuality] = useState<number>(75);
  const [isProcessing, setIsProcessing] = useState(false);

  const { error, selectFiles, inspectImages, processImage } = useImageProcessing();

  const inputPaths = images.map((item) => item.path);
  const commonExtension = getCommonExtension(inputPaths);
  const effectiveOutputFormat = convertFormat === 'none' ? commonExtension : convertFormat;
  const compressionFormat = effectiveOutputFormat === 'png'
    ? 'png'
    : (effectiveOutputFormat === 'jpg' || effectiveOutputFormat === 'jpeg' ? 'jpg' : null);
  const displayError = localError || error;
  const completedCount = images.filter((item) => item.status === 'done' || item.status === 'error').length;

  useEffect(() => {
    if (compressionFormat === 'png' && compressionType === 'quality') {
      setCompressionType('none');
      return;
    }

    if (compressionFormat === 'jpg' && compressionType === 'preset') {
      setCompressionType('none');
      return;
    }

    if (compressionFormat === null && compressionType !== 'none') {
      setCompressionType('none');
    }
  }, [compressionFormat, compressionType]);

  useEffect(() => {
    let unlistenProcessing: (() => void) | undefined;
    let unlistenDrop: (() => void) | undefined;

    const bind = async () => {
      unlistenProcessing = await listen<ProcessingStageEvent>('image-processing-stage', (event) => {
        const payload = event.payload;
        setImages((current) => current.map((item) => (
          item.path === payload.inputPath
            ? {
                ...item,
                processingStage: payload.stage,
                processingElapsedMs: payload.elapsedMs,
                status: payload.stage === 'done' ? 'done' : 'processing',
              }
            : item
        )));
      });

      unlistenDrop = await getCurrentWindow().onDragDropEvent(async (event) => {
        if (event.payload.type === 'enter' || event.payload.type === 'over') {
          setDragActive(true);
          return;
        }

        if (event.payload.type === 'leave') {
          setDragActive(false);
          return;
        }

        setDragActive(false);
        const droppedPaths = event.payload.paths.filter(isSupportedImagePath);
        if (droppedPaths.length === 0) {
          setLocalError('拖拽的内容里没有可处理的图片文件');
          return;
        }

        const inspected = await inspectImages(droppedPaths);
        if (inspected.length === 0) {
          return;
        }

        setImages((current) => mergeImageInfo(current, inspected));
        setLocalError(null);
      });
    };

    void bind();

    return () => {
      if (unlistenProcessing) {
        unlistenProcessing();
      }

      if (unlistenDrop) {
        unlistenDrop();
      }
    };
  }, [inspectImages]);

  const appendSelectedPaths = async (paths: string[]) => {
    const filtered = paths.filter(isSupportedImagePath);
    if (filtered.length === 0) {
      setLocalError('没有找到支持的图片文件');
      return;
    }

    const newPaths = filtered.filter((path) => !images.some((item) => item.path === path));
    if (newPaths.length === 0) {
      return;
    }

    const inspected = await inspectImages(newPaths);
    if (inspected.length === 0) {
      return;
    }

    setImages((current) => mergeImageInfo(current, inspected));
    setLocalError(null);
  };

  const handleSelectFiles = async () => {
    const selected = await selectFiles();
    if (selected.length === 0) {
      return;
    }

    await appendSelectedPaths(selected);
  };

  const handleRemovePath = (targetPath: string) => {
    setImages((current) => current.filter((item) => item.path !== targetPath));
    setLocalError(null);
  };

  const handleClearPaths = () => {
    setImages([]);
    setLocalError(null);
  };

  const buildOptions = (): ProcessingOptions | null => {
    const options: ProcessingOptions = {};

    if (convertFormat !== 'none') {
      options.convertFormat = convertFormat;
    }

    if (resizeMode === 'scale') {
      options.resizeMode = 'scale';
      options.resizeScale = resizeScale;
    }

    if (resizeMode === 'dimensions') {
      const width = resizeWidth ? Number(resizeWidth) : undefined;
      const height = resizeHeight ? Number(resizeHeight) : undefined;

      if (!width && !height) {
        setLocalError('请输入宽度或高度');
        return null;
      }

      if (width && height) {
        options.resizeMode = 'dimensions';
        options.resizeWidth = width;
        options.resizeHeight = height;
      } else if (width) {
        options.resizeMode = 'width';
        options.resizeWidth = width;
      } else if (height) {
        options.resizeMode = 'height';
        options.resizeHeight = height;
      }
    }

    if (compressionType === 'preset') {
      options.compressionType = compressionType;
      options.compressionPreset = compressionPreset;
    }

    if (compressionType === 'quality') {
      options.compressionType = compressionType;
      options.compressionQuality = {
        percent: compressionQuality,
      };
    }

    return options;
  };

  const shouldSkipProcessing = () => (
    convertFormat === 'none'
    && resizeMode === 'none'
    && compressionType === 'none'
  );

  const handleProcess = async () => {
    if (images.length === 0) {
      setLocalError('请先选择图片');
      return;
    }

    const options = buildOptions();
    if (!options) {
      return;
    }

    if (shouldSkipProcessing()) {
      setImages((current) => current.map((item) => ({
        ...item,
        status: 'skipped',
        outputSize: undefined,
        outputPath: undefined,
        errorMessage: undefined,
        processingMessage: undefined,
        durationMs: 0,
        processingStage: undefined,
        processingElapsedMs: undefined,
      })));
      setLocalError(null);
      return;
    }

    setLocalError(null);
    setIsProcessing(true);
    setImages((current) => current.map((item) => ({
      ...item,
      status: 'idle',
      outputSize: undefined,
      outputPath: undefined,
      errorMessage: undefined,
      processingMessage: undefined,
      durationMs: undefined,
      processingStage: undefined,
      processingElapsedMs: undefined,
    })));

    let nextIndex = 0;
    const workerCount = Math.min(Math.max(concurrency, 1), 4, images.length);

    const runSingle = async (image: SelectedImage) => {
      setImages((current) => current.map((item) => (
        item.path === image.path
          ? {
              ...item,
              status: 'processing',
              errorMessage: undefined,
              processingMessage: undefined,
              processingStage: 'preparing',
              processingElapsedMs: 0,
            }
          : item
      )));

      const response = await processImage(image.path, options, outputDir || undefined);

      setImages((current) => current.map((item) => {
        if (item.path !== image.path) {
          return item;
        }

        if (!response) {
          return {
            ...item,
            status: 'error',
            outputSize: undefined,
            outputPath: undefined,
            durationMs: undefined,
            processingStage: undefined,
            processingElapsedMs: undefined,
            errorMessage: '处理失败，请检查参数或图片格式',
          };
        }

        return {
          ...item,
          status: response.success ? 'done' : 'error',
          outputSize: response.outputSize,
          outputPath: response.outputPath,
          durationMs: response.durationMs,
          processingStage: response.success ? 'done' : undefined,
          processingElapsedMs: response.durationMs,
          processingMessage: response.message,
          errorMessage: response.success ? undefined : response.message,
        };
      }));
    };

    const runWorker = async () => {
      while (nextIndex < images.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await runSingle(images[currentIndex]);
      }
    };

    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    setIsProcessing(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="mb-2 text-2xl font-bold">批量图片转换</h2>
      </div>

      <div className="space-y-4 rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <label className="block text-sm font-medium">选择图片</label>
            {images.length > 0 && (
              <button
                onClick={handleClearPaths}
                className="text-sm text-stone-500 transition-colors hover:text-stone-900 dark:text-zinc-400 dark:hover:text-white"
              >
                清空选中
              </button>
            )}
          </div>

          <div
            className={`rounded-2xl border-2 border-dashed p-4 transition-colors ${
              dragActive
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-500/10'
                : 'border-stone-300 bg-stone-50 dark:border-zinc-700 dark:bg-zinc-950'
            }`}
          >
            <button
              onClick={handleSelectFiles}
              className="w-full text-left"
            >
              <p className="font-medium text-stone-900 dark:text-zinc-100">
                {images.length > 0 ? `已选择 ${images.length} 张图片，可继续追加` : '点击选择图片（支持多选）'}
              </p>
              <p className="mt-1 text-sm text-stone-500 dark:text-zinc-400">
                也可以直接把图片拖进窗口，立即加入处理列表
              </p>
            </button>
          </div>

          {images.length > 0 && (
            <div className="rounded-xl border border-stone-200 bg-stone-50 p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
              <div className="space-y-2">
                {images.map((image) => {
                  const savingRate = formatSavings(image.size, image.outputSize);

                  return (
                    <div
                      key={image.path}
                      className="rounded-xl border border-stone-200 bg-white px-3 py-3 transition-colors dark:border-zinc-800 dark:bg-zinc-900"
                    >
                      <div className="flex items-start gap-3">
                        <div className="shrink-0">
                          <img
                            src={image.previewDataUrl}
                            alt={image.fileName}
                            className="h-16 w-16 rounded-lg border border-stone-200 object-cover dark:border-zinc-800"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="min-w-0 flex-1 truncate font-medium">{image.fileName}</p>
                            <span className={`rounded-full px-2 py-1 text-xs ${statusClassName(image.status)}`}>
                              {statusLabel(image.status)}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-stone-500 dark:text-zinc-500">
                            原始 {formatBytes(image.size)} · {image.width} × {image.height}
                            {typeof image.outputSize === 'number' && ` · 处理后 ${formatBytes(image.outputSize)}`}
                            {savingRate && ` · 节省 ${savingRate}`}
                            {typeof image.durationMs === 'number' && ` · 用时 ${(image.durationMs / 1000).toFixed(1)}s`}
                          </p>
                          {image.status === 'processing' && (
                            <div className="mt-2 space-y-1">
                              <div className="h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-zinc-800">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500 transition-[width] duration-300"
                                  style={{ width: `${stageProgress(image.processingStage)}%` }}
                                />
                              </div>
                              <p className="text-xs text-blue-600 dark:text-blue-400">
                                {stageLabel(image.processingStage)}
                              </p>
                            </div>
                          )}
                          {image.errorMessage && (
                            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{image.errorMessage}</p>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemovePath(image.path)}
                          disabled={isProcessing}
                          className="flex h-7 w-7 items-center justify-center rounded-full border border-stone-300 text-sm leading-none text-stone-500 transition-colors hover:border-stone-500 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-500 dark:hover:text-white"
                          aria-label={`移除 ${image.fileName}`}
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 pt-4 dark:border-zinc-800">
          <label className="mb-2 block text-sm font-medium">缩放</label>
          <div className="mb-3 flex gap-2">
            {[
              ['none', '不缩放'],
              ['scale', '百分比'],
              ['dimensions', '宽高'],
            ].map(([value, label]) => (
              <button
                key={value}
                onClick={() => setResizeMode(value as ResizeMode)}
                className={`flex-1 rounded-lg py-2 transition-colors ${
                  resizeMode === value
                    ? 'bg-blue-600 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {resizeMode === 'scale' && (
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>缩放比例</span>
                <span>{resizeScale}%</span>
              </div>
              <input
                type="range"
                min="1"
                max="100"
                value={resizeScale}
                onChange={(event) => setResizeScale(Number(event.target.value))}
                className="w-full"
              />
            </div>
          )}

          {resizeMode === 'dimensions' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="number"
                  value={resizeWidth}
                  onChange={(event) => setResizeWidth(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  placeholder="宽度"
                />
                <input
                  type="number"
                  value={resizeHeight}
                  onChange={(event) => setResizeHeight(event.target.value)}
                  className="w-full rounded-lg border border-stone-300 bg-stone-50 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-950"
                  placeholder="高度"
                />
              </div>
              <p className="text-xs text-stone-500 dark:text-zinc-500">
                只填宽度或高度时，会按原图比例自动计算另一边；两个都填时按输入值处理。
              </p>
            </div>
          )}
        </div>

        <div className="border-t border-stone-200 pt-4 dark:border-zinc-800">
          <label className="mb-2 block text-sm font-medium">格式转换</label>
          <div className="flex gap-2">
            {[
              ['none', '保持原格式', '输出文件保持原始格式，不额外做格式转换。'],
              ['jpg', '转 JPG', 'JPG 属于有损压缩格式，通常更适合照片，文件体积通常更小，但不支持透明背景。'],
              ['png', '转 PNG', 'PNG 属于无损格式，适合透明背景、图标和需要保留细节的图片，但文件体积通常更大。'],
            ].map(([value, label, hint]) => (
              <div key={value} className="group relative flex-1">
                <button
                  onClick={() => setConvertFormat(value as ConvertFormat)}
                  className={`w-full rounded-lg py-2 transition-colors ${
                    convertFormat === value
                      ? 'bg-blue-600 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  {label}
                </button>
                {value !== 'none' && (
                  <div className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 w-60 -translate-x-1/2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs leading-5 text-stone-700 opacity-0 shadow-xl ring-1 ring-black/5 transition duration-100 group-hover:opacity-100 group-focus-within:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10">
                    {hint}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-stone-200 pt-4 dark:border-zinc-800">
          <label className="mb-2 block text-sm font-medium">压缩</label>
          {compressionFormat === 'png' && (
            <div className="grid gap-2 md:grid-cols-2">
              <button
                onClick={() => setCompressionType('none')}
                className={`rounded-lg px-4 py-2 transition-colors ${
                  compressionType === 'none'
                    ? 'bg-blue-600 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                不压缩
              </button>
              <button
                onClick={() => {
                  setCompressionType('preset');
                  setCompressionPreset('standard');
                }}
                className={`rounded-lg px-4 py-2 transition-colors ${
                  compressionType === 'preset'
                    ? 'bg-blue-600 text-white'
                    : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                自动
              </button>
            </div>
          )}

          {compressionFormat === 'jpg' && (
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-2">
                <button
                  onClick={() => setCompressionType('none')}
                  className={`rounded-lg px-4 py-2 transition-colors ${
                    compressionType === 'none'
                      ? 'bg-blue-600 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  不压缩
                </button>
                <button
                  onClick={() => setCompressionType('quality')}
                  className={`rounded-lg px-4 py-2 transition-colors ${
                    compressionType === 'quality'
                      ? 'bg-blue-600 text-white'
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                  }`}
                >
                  质量
                </button>
              </div>
              {compressionType === 'quality' && (
                <div>
                  <div className="mb-1 flex justify-between text-sm">
                    <div className="group relative">
                      <span className="cursor-help text-stone-700 underline decoration-dotted underline-offset-4 dark:text-zinc-300">
                        JPG 质量
                      </span>
                      <div className="pointer-events-none absolute left-0 top-full z-30 mt-2 w-64 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left text-xs leading-5 text-stone-700 opacity-0 shadow-xl ring-1 ring-black/5 transition duration-100 group-hover:opacity-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-white/10">
                        这里的数值表示 JPEG 编码质量，不是文件大小百分比。数值越高画质越好、体积通常越大；数值越低压缩越强、体积通常越小。
                      </div>
                    </div>
                    <span>质量 {compressionQuality}</span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="95"
                    value={compressionQuality}
                    onChange={(event) => setCompressionQuality(Number(event.target.value))}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}

          {compressionFormat === null && (
            <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              请选择统一的输出格式后再设置压缩方式。
            </div>
          )}
        </div>

        <button
          onClick={handleProcess}
          disabled={images.length === 0 || isProcessing}
          className="w-full rounded-xl bg-blue-600 py-4 text-lg font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-stone-300 disabled:text-stone-500 dark:disabled:bg-zinc-700 dark:disabled:text-zinc-500"
        >
          {isProcessing
            ? `处理中 ${completedCount}/${images.length}`
            : `开始处理 ${images.length || ''}${images.length ? ' 张图片' : ''}`}
        </button>

        {displayError && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {displayError}
          </div>
        )}
      </div>
    </div>
  );
}
