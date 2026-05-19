package backend

import (
	"context"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"sync"
	"time"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/tiff"
	_ "golang.org/x/image/webp"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var processSem = make(chan struct{}, 2)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) emitStage(inputPath string, stage string, elapsedMs int64) {
	runtime.EventsEmit(a.ctx, "image-processing-stage", ProcessingStageEvent{
		InputPath: inputPath,
		Stage:     stage,
		ElapsedMs: elapsedMs,
	})
}

func (a *App) SelectImageFiles() ([]string, error) {
	paths, err := runtime.OpenMultipleFilesDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择图片文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "图片文件 (*.jpg, *.jpeg, *.png, *.webp, *.gif, *.bmp, *.tiff)",
				Pattern:     "*.jpg;*.jpeg;*.png;*.webp;*.gif;*.bmp;*.tiff;*.avif",
			},
		},
	})
	if err != nil {
		return nil, err
	}
	if paths == nil {
		return []string{}, nil
	}
	return paths, nil
}

func (a *App) SelectImageFolder() ([]string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择包含图片的文件夹",
	})
	if err != nil {
		return nil, err
	}
	if dir == "" {
		return []string{}, nil
	}

	var imagePaths []string
	extensions := map[string]bool{
		".jpg": true, ".jpeg": true, ".png": true, ".webp": true,
		".gif": true, ".bmp": true, ".tiff": true, ".avif": true,
	}

	filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			return nil
		}
		ext := strings.ToLower(filepath.Ext(path))
		if extensions[ext] {
			imagePaths = append(imagePaths, path)
		}
		return nil
	})

	return imagePaths, nil
}

func (a *App) SelectOutputDirectory() (string, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择输出文件夹",
	})
	if err != nil {
		return "", err
	}
	return dir, nil
}

func (a *App) GetDefaultOutputDirectory() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	picturesDir := filepath.Join(homeDir, "Pictures")
	if info, err := os.Stat(picturesDir); err == nil && info.IsDir() {
		return picturesDir, nil
	}
	return homeDir, nil
}

func (a *App) InspectImages(inputPaths []string) ([]ImageFileInfo, error) {
	var mu sync.Mutex
	results := make([]ImageFileInfo, 0, len(inputPaths))
	var wg sync.WaitGroup
	errCh := make(chan error, len(inputPaths))
	sem := make(chan struct{}, 2)

	for _, inputPath := range inputPaths {
		wg.Add(1)
		go func(path string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			info, err := inspectSingleImage(path)
			if err != nil {
				errCh <- fmt.Errorf("读取 %s 失败: %w", filepath.Base(path), err)
				return
			}
			mu.Lock()
			results = append(results, info)
			mu.Unlock()
		}(inputPath)
	}

	wg.Wait()
	close(errCh)

	var errs []string
	for err := range errCh {
		errs = append(errs, err.Error())
	}
	if len(errs) > 0 && len(results) == 0 {
		return nil, fmt.Errorf("%s", strings.Join(errs, "; "))
	}

	return results, nil
}

func inspectSingleImage(inputPath string) (ImageFileInfo, error) {
	fi, err := os.Stat(inputPath)
	if err != nil {
		return ImageFileInfo{}, err
	}

	f, err := os.Open(inputPath)
	if err != nil {
		return ImageFileInfo{}, err
	}
	defer f.Close()

	cfg, _, err := image.DecodeConfig(f)
	if err != nil {
		return ImageFileInfo{}, err
	}

	return ImageFileInfo{
		Path:     inputPath,
		FileName: filepath.Base(inputPath),
		Size:     fi.Size(),
		Width:    cfg.Width,
		Height:   cfg.Height,
	}, nil
}

func (a *App) ProcessImage(inputPath string, options ProcessingOptions, outputDir string) (ProcessResult, error) {
	processSem <- struct{}{}
	result, err := processSingleImage(a, inputPath, options, outputDir)
	<-processSem
	goruntime.GC()
	return result, err
}

func (a *App) TriggerGC() {
	goruntime.GC()
}

func (a *App) GeneratePreviews(inputPaths []string) {
	for _, inputPath := range inputPaths {
		processSem <- struct{}{}
		previewDataURL := generatePreviewFromPath(inputPath)
		<-processSem
		if previewDataURL != "" {
			runtime.EventsEmit(a.ctx, "image-preview", PreviewEvent{
				InputPath:      inputPath,
				PreviewDataURL: previewDataURL,
			})
		}
	}
	goruntime.GC()
}

func (a *App) ProcessImages(inputPaths []string, options ProcessingOptions, outputDir string) (BatchProcessResult, error) {
	result := BatchProcessResult{
		TotalFiles: len(inputPaths),
		OutputDir:  outputDir,
	}

	for _, inputPath := range inputPaths {
		res, err := processSingleImage(a, inputPath, options, outputDir)
		if err != nil {
			result.FailureCount++
			result.Failures = append(result.Failures, fmt.Sprintf("%s: %s", filepath.Base(inputPath), err.Error()))
			continue
		}
		result.TotalOriginalSize += res.OriginalSize
		result.TotalOutputSize += res.OutputSize
		if res.Success {
			result.SuccessCount++
		} else {
			result.FailureCount++
			result.Failures = append(result.Failures, fmt.Sprintf("%s: %s", filepath.Base(inputPath), res.Message))
		}
	}

	result.Success = result.FailureCount == 0
	if result.Success {
		result.Message = fmt.Sprintf("成功处理 %d 张图片", result.SuccessCount)
	} else {
		result.Message = fmt.Sprintf("处理完成：%d 成功，%d 失败", result.SuccessCount, result.FailureCount)
	}

	return result, nil
}

func processSingleImage(a *App, inputPath string, options ProcessingOptions, outputDir string) (ProcessResult, error) {
	startTime := time.Now()
	steps := []string{}

	emit := func(stage string) {
		a.emitStage(inputPath, stage, time.Since(startTime).Milliseconds())
	}

	emit("preparing")

	if outputDir == "" {
		defaultDir, err := a.GetDefaultOutputDirectory()
		if err != nil {
			return ProcessResult{Success: false, Message: "无法确定输出目录"}, nil
		}
		outputDir = defaultDir
	}

	fi, err := os.Stat(inputPath)
	if err != nil {
		return ProcessResult{
			Success:    false,
			Message:    fmt.Sprintf("无法读取文件: %s", err.Error()),
			DurationMs: time.Since(startTime).Milliseconds(),
		}, nil
	}
	originalSize := fi.Size()

	emit("loading")

	srcImg, formatName, err := loadImage(inputPath)
	if err != nil {
		return ProcessResult{
			Success:      false,
			OriginalSize: originalSize,
			Message:      fmt.Sprintf("无法解码图片: %s", err.Error()),
			DurationMs:   time.Since(startTime).Milliseconds(),
		}, nil
	}
	steps = append(steps, fmt.Sprintf("读取 %s 格式", formatName))

	emit("transforming")

	processed := srcImg

	if options.ResizeMode != "" && options.ResizeMode != "none" {
		processed = resizeImage(processed, options)
		srcImg = nil
		steps = append(steps, "已缩放")
	}

	outputFormat := options.ConvertFormat
	if outputFormat == "" || outputFormat == "none" {
		outputFormat = formatName
	}

	outputExt := outputFormat
	switch outputFormat {
	case "jpeg":
		outputExt = "jpg"
	case "jpg", "png", "gif", "webp", "bmp":
	default:
		outputExt = formatName
	}

	baseName := strings.TrimSuffix(filepath.Base(inputPath), filepath.Ext(inputPath))
	outputPath := filepath.Join(outputDir, baseName+"."+outputExt)

	counter := 1
	for fileExists(outputPath) {
		outputPath = filepath.Join(outputDir, fmt.Sprintf("%s_%d.%s", baseName, counter, outputExt))
		counter++
	}

	emit("encoding")

	compressionSteps, err := encodeImage(processed, outputPath, outputFormat, options)
	srcImg = nil
	processed = nil
	if err != nil {
		return ProcessResult{
			Success:      false,
			OriginalSize: originalSize,
			Message:      fmt.Sprintf("编码失败: %s", err.Error()),
			Steps:        steps,
			DurationMs:   time.Since(startTime).Milliseconds(),
		}, nil
	}
	steps = append(steps, compressionSteps...)

	emit("writing")

	outFi, err := os.Stat(outputPath)
	if err != nil {
		return ProcessResult{
			Success:      false,
			OriginalSize: originalSize,
			Message:      fmt.Sprintf("写入后无法读取输出文件: %s", err.Error()),
			Steps:        steps,
			DurationMs:   time.Since(startTime).Milliseconds(),
		}, nil
	}

	emit("done")

	return ProcessResult{
		Success:      true,
		OutputPath:   outputPath,
		OriginalSize: originalSize,
		OutputSize:   outFi.Size(),
		Message:      "处理完成",
		Steps:        steps,
		DurationMs:   time.Since(startTime).Milliseconds(),
	}, nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
