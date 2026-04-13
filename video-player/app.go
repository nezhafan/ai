package main

import (
	"context"
	"net/http"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx context.Context
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) OpenVideoFile() (string, error) {
	return runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "选择视频文件",
		Filters: []runtime.FileFilter{
			{
				DisplayName: "视频文件",
				Pattern:     "*.mp4;*.mov;*.m4v;*.webm;*.mkv;*.avi",
			},
		},
	})
}

func (a *App) GetVideoDuration(filePath string) (float64, error) {
	return parseMP4DurationSeconds(filePath)
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

		info, err := os.Stat(filePath)
		if err != nil {
			http.NotFound(writer, request)
			return
		}

		if info.IsDir() {
			http.Error(writer, "invalid file", http.StatusBadRequest)
			return
		}

		http.ServeFile(writer, request, filePath)
	})
}
