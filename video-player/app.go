package main

import (
	"context"
	"net/http"
	"net/url"
	"os"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx        context.Context
	openedFile string
	mu         sync.RWMutex
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.mu.Lock()
	a.ctx = ctx
	a.mu.Unlock()
}

func (a *App) OpenVideoFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择视频文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "视频文件",
				Pattern:     "*.mp4;*.mov;*.m4v;*.webm;*.mkv;*.avi;*.ts;*.mts;*.m2ts",
			},
		},
	})
}

func (a *App) GetVideoDuration(filePath string) (float64, error) {
	return parseMP4DurationSeconds(filePath)
}

func (a *App) GetOpenedFile() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.openedFile
}

func (a *App) SetOpenedFile(filePath string) {
	if filePath == "" {
		return
	}

	a.mu.Lock()
	a.openedFile = filePath
	ctx := a.ctx
	a.mu.Unlock()

	if ctx != nil {
		runtime.EventsEmit(ctx, "app:file-opened", filePath)
	}
}

func mediaHandler() http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if (request.Method != http.MethodGet && request.Method != http.MethodHead) || request.URL.Path != "/local-media" {
			http.NotFound(writer, request)
			return
		}

		filePath := request.URL.Query().Get("path")
		if filePath == "" {
			http.Error(writer, "missing path", http.StatusBadRequest)
			return
		}

		decodedPath, err := url.PathUnescape(filePath)
		if err != nil {
			http.NotFound(writer, request)
			return
		}

		info, err := os.Stat(decodedPath)
		if err != nil {
			http.NotFound(writer, request)
			return
		}

		if info.IsDir() {
			http.Error(writer, "invalid file", http.StatusBadRequest)
			return
		}

		http.ServeFile(writer, request, decodedPath)
	})
}
