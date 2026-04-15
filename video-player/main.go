package main

import (
	"embed"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

// fileProtocolHandler handles file:// URLs for direct local file access
type fileProtocolHandler struct{}

func (h *fileProtocolHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	filePath := request.URL.Path
	if len(filePath) > 5 && filePath[:5] == "/file" {
		filePath = filePath[5:]
	}

	decodedPath, err := url.PathUnescape(filePath)
	if err != nil {
		http.NotFound(writer, request)
		return
	}

	absPath, err := filepath.Abs(decodedPath)
	if err != nil {
		http.NotFound(writer, request)
		return
	}

	info, err := os.Stat(absPath)
	if err != nil || info.IsDir() {
		http.NotFound(writer, request)
		return
	}

	http.ServeFile(writer, request, absPath)
}

var supportedVideoExtensions = map[string]struct{}{
	".mp4":  {},
	".mov":  {},
	".m4v":  {},
	".webm": {},
	".mkv":  {},
	".avi":  {},
	".ts":   {},
	".mts":  {},
	".m2ts": {},
}

func resolveOpenedFileFromArgs(args []string) string {
	if len(args) <= 1 {
		return ""
	}

	for _, arg := range args[1:] {
		if arg == "" || strings.HasPrefix(arg, "-") {
			continue
		}

		candidate := decodeFileURLIfNeeded(arg)
		if !isSupportedVideoFile(candidate) {
			continue
		}

		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}

	return ""
}

func decodeFileURLIfNeeded(value string) string {
	if !strings.HasPrefix(strings.ToLower(value), "file://") {
		return value
	}

	parsed, err := url.Parse(value)
	if err != nil {
		return value
	}

	path := parsed.Path
	if unescaped, unescapeErr := url.PathUnescape(path); unescapeErr == nil {
		path = unescaped
	}

	if runtime.GOOS == "windows" && len(path) >= 3 && path[0] == '/' && path[2] == ':' {
		return path[1:]
	}

	return path
}

func isSupportedVideoFile(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	_, ok := supportedVideoExtensions[ext]
	return ok
}

func main() {
	app := NewApp()

	// 处理文件关联打开的视频文件
	if filePath := resolveOpenedFileFromArgs(os.Args); filePath != "" {
		app.SetOpenedFile(filePath)
	}

	err := wails.Run(&options.App{
		Title:     "视频播放器",
		Width:     1024,
		Height:    672,
		MinWidth:  320,
		MinHeight: 240,
		AssetServer: &assetserver.Options{
			Assets:  assets,
			Handler: mediaHandler(),
		},
		Mac: &mac.Options{
			OnFileOpen: func(filePath string) {
				app.SetOpenedFile(filePath)
			},
		},
		SingleInstanceLock: &options.SingleInstanceLock{
			UniqueId: "com.wails.video-player",
			OnSecondInstanceLaunch: func(secondInstanceData options.SecondInstanceData) {
				args := append([]string{"video-player"}, secondInstanceData.Args...)
				if filePath := resolveOpenedFileFromArgs(args); filePath != "" {
					app.SetOpenedFile(filePath)
				}
			},
		},
		BackgroundColour: &options.RGBA{R: 9, G: 12, B: 18, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
