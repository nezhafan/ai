# Image Tool Wails 重写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `/opt/www/ai` 下创建新的 `image-tool-wails` 项目，用 `Wails v2 + Go` 重写当前 `image-tool`，尽量保留现有 React 界面和核心功能。

**Architecture:** 新项目采用 `frontend + backend + main.go + wails.json` 结构。前端复用现有 React 组件并移除 Tauri 依赖，后端用 Go 提供文件选择、图片探测、批处理和进度事件，图片处理逻辑集中在 `backend/imaging` 与 `backend/processing`。

**Tech Stack:** Wails v2、Go、React、TypeScript、Vite、TailwindCSS、Go image 编码/解码库

---

### Task 1: 创建独立 Wails 项目骨架

**Files:**
- Create: `/opt/www/ai/image-tool-wails/main.go`
- Create: `/opt/www/ai/image-tool-wails/go.mod`
- Create: `/opt/www/ai/image-tool-wails/wails.json`
- Create: `/opt/www/ai/image-tool-wails/backend/app.go`
- Create: `/opt/www/ai/image-tool-wails/backend/run.go`
- Create: `/opt/www/ai/image-tool-wails/frontend/index.html`
- Create: `/opt/www/ai/image-tool-wails/frontend/package.json`
- Create: `/opt/www/ai/image-tool-wails/frontend/vite.config.ts`
- Create: `/opt/www/ai/image-tool-wails/frontend/tsconfig.json`

- [ ] **Step 1: 创建新项目目录结构**

```bash
mkdir -p /opt/www/ai/image-tool-wails/backend
mkdir -p /opt/www/ai/image-tool-wails/frontend/src
mkdir -p /opt/www/ai/image-tool-wails/frontend/public
mkdir -p /opt/www/ai/image-tool-wails/build
```

- [ ] **Step 2: 初始化 Go 模块**

```bash
cd /opt/www/ai/image-tool-wails
go mod init image-tool-wails
```

Expected: 生成 `go.mod`

- [ ] **Step 3: 写入 Wails 入口文件**

```go
package main

import (
	"embed"

	"image-tool-wails/backend"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	backend.Run(assets)
}
```

- [ ] **Step 4: 写入后端入口和空 App**

```go
package backend

import "context"

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}
```

```go
package backend

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
)

func Run(assets embed.FS) {
	app := NewApp()

	err := wails.Run(&options.App{
		Title:  "Image Tool",
		Width:  1280,
		Height: 860,
		AssetServer: &options.AssetServer{
			Assets: assets,
		},
		OnStartup: app.startup,
		Bind: []interface{}{
			app,
		},
	})
	if err != nil {
		panic(err)
	}
}
```

- [ ] **Step 5: 写入前端最小可运行配置**

```json
{
  "name": "image-tool-wails-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  }
}
```

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Image Tool</title>
    <script type="module" src="/src/main.tsx"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
```

- [ ] **Step 6: 验证基础目录和文件存在**

Run: `rg --files /opt/www/ai/image-tool-wails`

Expected: 输出 `main.go`、`backend/app.go`、`frontend/index.html` 等骨架文件

- [ ] **Step 7: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: scaffold image-tool wails project"
```

### Task 2: 迁移前端工程并消除 Tauri 依赖

**Files:**
- Create: `/opt/www/ai/image-tool-wails/frontend/src/main.tsx`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/App.tsx`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/components/ImageProcessor.tsx`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/hooks/useImageProcessing.ts`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/types/index.ts`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/lib/wails.ts`
- Create: `/opt/www/ai/image-tool-wails/frontend/src/lib/events.ts`
- Modify: `/opt/www/ai/image-tool-wails/frontend/package.json`
- Modify: `/opt/www/ai/image-tool-wails/frontend/vite.config.ts`
- Test: `/opt/www/ai/image-tool-wails/frontend/src/lib/wails.ts`

- [ ] **Step 1: 复制现有前端源码到新项目**

```bash
cp -R /opt/www/ai/image-tool/src /opt/www/ai/image-tool-wails/frontend/
cp /opt/www/ai/image-tool/index.html /opt/www/ai/image-tool-wails/frontend/index.html
cp /opt/www/ai/image-tool/tsconfig.json /opt/www/ai/image-tool-wails/frontend/tsconfig.json
cp /opt/www/ai/image-tool/postcss.config.js /opt/www/ai/image-tool-wails/frontend/postcss.config.js
cp /opt/www/ai/image-tool/tailwind.config.js /opt/www/ai/image-tool-wails/frontend/tailwind.config.js
```

- [ ] **Step 2: 替换前端依赖定义**

```json
{
  "name": "image-tool-wails-frontend",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.5",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.4.49",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.7.3",
    "vite": "^6.0.5"
  }
}
```

- [ ] **Step 3: 添加 Wails 绑定适配层**

```ts
import { EventsOn } from "../wailsjs/runtime/runtime";
import { InspectImages, ProcessImages, SelectFiles, SelectOutputDirectory } from "../wailsjs/go/backend/App";

export { EventsOn, InspectImages, ProcessImages, SelectFiles, SelectOutputDirectory };
```

```ts
import { EventsOn } from "./wails";

export function listenProcessingStage(
  handler: (payload: { inputPath: string; stage: string; elapsedMs: number }) => void,
) {
  return EventsOn("image-processing-stage", handler);
}
```

- [ ] **Step 4: 把 Tauri 调用替换成 Wails 调用**

```ts
import { useState } from "react";
import { InspectImages, ProcessImages, SelectFiles, SelectOutputDirectory } from "@/lib/wails";
import type { BatchProcessResult, ImageFileInfo, ProcessResult, ProcessingOptions } from "@/types";

export function useImageProcessing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectFiles = async () => {
    try {
      return await SelectFiles();
    } catch (e) {
      setError(`选择文件失败: ${e}`);
      return [];
    }
  };

  const selectOutputDirectory = async () => {
    try {
      return await SelectOutputDirectory();
    } catch (e) {
      setError(`选择输出目录失败: ${e}`);
      return "";
    }
  };

  const inspectImages = async (inputPaths: string[]): Promise<ImageFileInfo[]> => {
    try {
      return await InspectImages(inputPaths);
    } catch (e) {
      setError(`读取图片信息失败: ${e}`);
      return [];
    }
  };

  const processImages = async (
    inputPaths: string[],
    options: ProcessingOptions,
    outputDir: string,
    concurrency: number,
  ): Promise<BatchProcessResult | null> => {
    setLoading(true);
    setError(null);
    try {
      return await ProcessImages(inputPaths, options, outputDir, concurrency);
    } catch (e) {
      setError(`处理失败: ${e}`);
      return null;
    } finally {
      setLoading(false);
    }
  };

  return { loading, error, selectFiles, selectOutputDirectory, inspectImages, processImages };
}
```

- [ ] **Step 5: 替换事件监听入口**

```ts
import { useEffect } from "react";
import { listenProcessingStage } from "@/lib/events";

useEffect(() => {
  const unsubscribe = listenProcessingStage((payload) => {
    console.log(payload);
  });
  return () => {
    if (typeof unsubscribe === "function") {
      unsubscribe();
    }
  };
}, []);
```

- [ ] **Step 6: 安装前端依赖并生成最小构建**

Run: `npm install`

Run: `npm run build`

Workdir: `/opt/www/ai/image-tool-wails/frontend`

Expected: `frontend/dist` 成功生成，允许因后端绑定未完成而存在少量类型缺口，但不得再依赖 Tauri 包

- [ ] **Step 7: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: migrate react frontend into wails project"
```

### Task 3: 建立 Go 绑定类型与图片探测能力

**Files:**
- Create: `/opt/www/ai/image-tool-wails/backend/types.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/inspect.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/orientation.go`
- Modify: `/opt/www/ai/image-tool-wails/backend/app.go`
- Test: `/opt/www/ai/image-tool-wails/backend/imaging/inspect_test.go`

- [ ] **Step 1: 定义与前端对齐的数据类型**

```go
package backend

type CompressionQuality struct {
	Percent uint8 `json:"percent"`
}

type ProcessingOptions struct {
	ConvertFormat      string              `json:"convertFormat"`
	ResizeMode         string              `json:"resizeMode"`
	ResizeWidth        uint32              `json:"resizeWidth"`
	ResizeHeight       uint32              `json:"resizeHeight"`
	ResizeScale        float32             `json:"resizeScale"`
	CompressionType    string              `json:"compressionType"`
	CompressionPreset  string              `json:"compressionPreset"`
	CompressionQuality *CompressionQuality `json:"compressionQuality"`
	TargetRatio        float32             `json:"targetRatio"`
}

type ImageFileInfo struct {
	Path           string `json:"path"`
	FileName       string `json:"fileName"`
	Size           uint64 `json:"size"`
	Width          uint32 `json:"width"`
	Height         uint32 `json:"height"`
	PreviewDataURL string `json:"previewDataUrl,omitempty"`
}
```

- [ ] **Step 2: 写图片探测函数**

```go
package imaging

import (
	"os"
	"path/filepath"
)

func InspectImage(path string) (ImageFileInfo, error) {
	info, err := os.Stat(path)
	if err != nil {
		return ImageFileInfo{}, err
	}

	width, height, err := ReadDimensions(path)
	if err != nil {
		return ImageFileInfo{}, err
	}

	return ImageFileInfo{
		Path:     path,
		FileName: filepath.Base(path),
		Size:     uint64(info.Size()),
		Width:    width,
		Height:   height,
	}, nil
}
```

- [ ] **Step 3: 在 App 中暴露 `InspectImages`**

```go
func (a *App) InspectImages(inputPaths []string) ([]ImageFileInfo, error) {
	results := make([]ImageFileInfo, 0, len(inputPaths))
	for _, path := range inputPaths {
		item, err := imaging.InspectImage(path)
		if err != nil {
			return nil, err
		}
		results = append(results, item)
	}
	return results, nil
}
```

- [ ] **Step 4: 写一个最小测试覆盖尺寸读取**

```go
func TestInspectImageReturnsFileNameAndDimensions(t *testing.T) {
	item, err := InspectImage("testdata/sample.jpg")
	if err != nil {
		t.Fatalf("InspectImage failed: %v", err)
	}
	if item.FileName != "sample.jpg" {
		t.Fatalf("unexpected file name: %s", item.FileName)
	}
	if item.Width == 0 || item.Height == 0 {
		t.Fatalf("invalid dimensions: %dx%d", item.Width, item.Height)
	}
}
```

- [ ] **Step 5: 运行 Go 测试**

Run: `go test ./backend/...`

Workdir: `/opt/www/ai/image-tool-wails`

Expected: `backend/imaging` 基础测试通过

- [ ] **Step 6: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: add wails image inspection backend"
```

### Task 4: 建立文件选择、输出目录选择和事件桥接

**Files:**
- Create: `/opt/www/ai/image-tool-wails/backend/system/dialogs.go`
- Create: `/opt/www/ai/image-tool-wails/backend/processing/events.go`
- Modify: `/opt/www/ai/image-tool-wails/backend/app.go`
- Modify: `/opt/www/ai/image-tool-wails/frontend/src/App.tsx`
- Modify: `/opt/www/ai/image-tool-wails/frontend/src/components/ImageProcessor.tsx`
- Test: `/opt/www/ai/image-tool-wails/backend/app_test.go`

- [ ] **Step 1: 封装文件与目录选择**

```go
func (a *App) SelectFiles() ([]string, error) {
	return runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择图片",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "Image",
				Pattern:     "*.jpg;*.jpeg;*.png;*.webp;*.gif;*.bmp;*.tiff;*.avif",
			},
		},
	})
}

func (a *App) SelectOutputDirectory() (string, error) {
	return runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择输出文件夹",
	})
}
```

- [ ] **Step 2: 建立统一事件发送函数**

```go
package processing

import "github.com/wailsapp/wails/v2/pkg/runtime"

const EventImageProcessingStage = "image-processing-stage"

type StageEvent struct {
	InputPath string `json:"inputPath"`
	Stage     string `json:"stage"`
	ElapsedMS uint64 `json:"elapsedMs"`
}

func EmitStage(ctx context.Context, payload StageEvent) {
	runtime.EventsEmit(ctx, EventImageProcessingStage, payload)
}
```

- [ ] **Step 3: 前端改为通过 hook 触发目录选择**

```ts
const { selectOutputDirectory } = useImageProcessing();

const handleSelectOutputDir = async () => {
  const selected = await selectOutputDirectory();
  if (selected) {
    setOutputDir(selected);
  }
};
```

- [ ] **Step 4: 为拖拽行为设定降级方案**

```ts
const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
  event.preventDefault();
  const paths = Array.from(event.dataTransfer.files).map((file) => file.path).filter(Boolean);
  if (paths.length === 0) return;
  const next = await inspectImages(paths);
  setImages((current) => mergeImageInfo(current, next));
};
```

- [ ] **Step 5: 验证绑定方法存在**

Run: `go test ./backend/...`

Expected: App 层编译通过，测试通过

- [ ] **Step 6: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: add dialog and event bridge for wails"
```

### Task 5: 实现 Go 图片处理管线与批处理服务

**Files:**
- Create: `/opt/www/ai/image-tool-wails/backend/processing/service.go`
- Create: `/opt/www/ai/image-tool-wails/backend/processing/types.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/decode.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/resize.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/compress.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/quantize.go`
- Create: `/opt/www/ai/image-tool-wails/backend/imaging/paths.go`
- Modify: `/opt/www/ai/image-tool-wails/backend/app.go`
- Test: `/opt/www/ai/image-tool-wails/backend/processing/service_test.go`
- Test: `/opt/www/ai/image-tool-wails/backend/imaging/paths_test.go`

- [ ] **Step 1: 定义批处理结果类型**

```go
type ProcessResult struct {
	Success      bool     `json:"success"`
	OutputPath   string   `json:"outputPath"`
	OriginalSize uint64   `json:"originalSize"`
	OutputSize   uint64   `json:"outputSize"`
	Message      string   `json:"message"`
	Steps        []string `json:"steps"`
	DurationMS   uint64   `json:"durationMs"`
}

type BatchProcessResult struct {
	Success           bool     `json:"success"`
	TotalFiles        int      `json:"totalFiles"`
	SuccessCount      int      `json:"successCount"`
	FailureCount      int      `json:"failureCount"`
	TotalOriginalSize uint64   `json:"totalOriginalSize"`
	TotalOutputSize   uint64   `json:"totalOutputSize"`
	OutputDir         string   `json:"outputDir,omitempty"`
	Message           string   `json:"message"`
	Failures          []string `json:"failures"`
}
```

- [ ] **Step 2: 实现输出路径去重逻辑**

```go
func BuildOutputPath(inputPath string, outputDir string, outputExt string) string {
	base := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	candidate := filepath.Join(outputDir, base+"."+outputExt)
	if _, err := os.Stat(candidate); errors.Is(err, os.ErrNotExist) {
		return candidate
	}
	for i := 1; ; i++ {
		next := filepath.Join(outputDir, fmt.Sprintf("%s (%d).%s", base, i, outputExt))
		if _, err := os.Stat(next); errors.Is(err, os.ErrNotExist) {
			return next
		}
	}
}
```

- [ ] **Step 3: 实现单文件处理函数**

```go
func ProcessOne(ctx context.Context, inputPath string, options ProcessingOptions, outputDir string) (ProcessResult, error) {
	start := time.Now()
	EmitStage(ctx, StageEvent{InputPath: inputPath, Stage: "loading", ElapsedMS: 0})

	img, meta, err := imaging.Decode(inputPath)
	if err != nil {
		return ProcessResult{}, err
	}

	EmitStage(ctx, StageEvent{InputPath: inputPath, Stage: "transforming", ElapsedMS: uint64(time.Since(start).Milliseconds())})
	img = imaging.ApplyResize(img, options)

	EmitStage(ctx, StageEvent{InputPath: inputPath, Stage: "encoding", ElapsedMS: uint64(time.Since(start).Milliseconds())})
	outputPath, outputSize, err := imaging.EncodeToFile(img, meta, inputPath, outputDir, options)
	if err != nil {
		return ProcessResult{}, err
	}

	EmitStage(ctx, StageEvent{InputPath: inputPath, Stage: "done", ElapsedMS: uint64(time.Since(start).Milliseconds())})
	return ProcessResult{
		Success:      true,
		OutputPath:   outputPath,
		OriginalSize: meta.FileSize,
		OutputSize:   outputSize,
		Message:      "处理完成",
		DurationMS:   uint64(time.Since(start).Milliseconds()),
	}, nil
}
```

- [ ] **Step 4: 实现并发受控的批处理服务**

```go
func (s *Service) ProcessImages(ctx context.Context, inputPaths []string, options ProcessingOptions, outputDir string, concurrency int) (BatchProcessResult, error) {
	limit := concurrency
	if limit < 1 {
		limit = 1
	}

	sem := make(chan struct{}, limit)
	results := make(chan fileResult, len(inputPaths))
	var wg sync.WaitGroup

	for _, path := range inputPaths {
		wg.Add(1)
		go func(inputPath string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			result, err := ProcessOne(ctx, inputPath, options, outputDir)
			results <- fileResult{Path: inputPath, Result: result, Err: err}
		}(path)
	}

	wg.Wait()
	close(results)
	return summarize(results, outputDir), nil
}
```

- [ ] **Step 5: 写路径冲突和聚合测试**

```go
func TestBuildOutputPathAddsNumericSuffixWhenTargetExists(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "photo.png")
	if err := os.WriteFile(first, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}

	got := BuildOutputPath("/tmp/photo.jpg", dir, "png")
	want := filepath.Join(dir, "photo (1).png")
	if got != want {
		t.Fatalf("want %s, got %s", want, got)
	}
}
```

```go
func TestSummarizeCountsFailuresAndSuccesses(t *testing.T) {
	results := make(chan fileResult, 2)
	results <- fileResult{Path: "a.jpg", Result: ProcessResult{Success: true, OutputSize: 10, OriginalSize: 20}}
	results <- fileResult{Path: "b.jpg", Err: errors.New("decode failed")}
	close(results)

	batch := summarize(results, "/tmp/out")
	if batch.SuccessCount != 1 || batch.FailureCount != 1 {
		t.Fatalf("unexpected counts: %+v", batch)
	}
}
```

- [ ] **Step 6: 运行后端测试**

Run: `go test ./backend/...`

Workdir: `/opt/www/ai/image-tool-wails`

Expected: `processing`、`imaging` 测试通过

- [ ] **Step 7: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: implement go image processing pipeline"
```

### Task 6: 接通前后端、清理旧依赖并完成端到端验证

**Files:**
- Modify: `/opt/www/ai/image-tool-wails/frontend/src/hooks/useImageProcessing.ts`
- Modify: `/opt/www/ai/image-tool-wails/frontend/src/components/ImageProcessor.tsx`
- Modify: `/opt/www/ai/image-tool-wails/frontend/src/App.tsx`
- Modify: `/opt/www/ai/image-tool-wails/backend/app.go`
- Modify: `/opt/www/ai/image-tool-wails/go.mod`
- Modify: `/opt/www/ai/image-tool-wails/frontend/package.json`
- Test: `/opt/www/ai/image-tool-wails/frontend/src/components/ImageProcessor.tsx`

- [ ] **Step 1: 将前端处理入口统一到批处理接口**

```ts
const handleProcess = async () => {
  const result = await processImages(
    images.map((item) => item.path),
    options,
    outputDir,
    concurrency,
  );

  if (!result) {
    return;
  }

  setImages((current) =>
    current.map((item) => {
      const matched = result.failures.find((failure) => failure.includes(item.path));
      return matched ? { ...item, status: "error" } : { ...item, status: "done" };
    }),
  );
};
```

- [ ] **Step 2: 移除 Tauri 相关 import 和依赖**

```bash
cd /opt/www/ai/image-tool-wails/frontend
npm uninstall @tauri-apps/api @tauri-apps/plugin-dialog @tauri-apps/plugin-shell
```

Expected: `package.json` 中不再包含任何 `@tauri-apps/*`

- [ ] **Step 3: 安装 Go 与前端依赖**

Run: `go mod tidy`

Workdir: `/opt/www/ai/image-tool-wails`

Run: `npm install`

Workdir: `/opt/www/ai/image-tool-wails/frontend`

Expected: 依赖锁文件完整更新

- [ ] **Step 4: 运行前端构建**

Run: `npm run build`

Workdir: `/opt/www/ai/image-tool-wails/frontend`

Expected: `frontend/dist` 成功生成

- [ ] **Step 5: 运行 Wails 开发验证**

Run: `wails dev`

Workdir: `/opt/www/ai/image-tool-wails`

Expected: 应用能启动，文件选择、输出目录选择、图片探测、批处理和进度渲染可手工验证

- [ ] **Step 6: 完成手工验收清单**

Run:

```text
1. 选择 2 张 JPG 和 1 张 PNG
2. 输出格式切到 JPG，执行一次
3. 输出格式切到 PNG，执行一次
4. 分别测试比例缩放、宽度缩放、高度缩放、指定尺寸
5. 测试 PNG 减色
6. 放入一个损坏文件，确认其它文件仍可完成
```

Expected: 所有核心流程按 spec 工作，单文件失败不影响整批

- [ ] **Step 7: Commit**

```bash
cd /opt/www/ai
git add image-tool-wails
git commit -m "feat: finish image-tool wails rewrite"
```
