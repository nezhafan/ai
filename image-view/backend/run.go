package backend

import (
	"io/fs"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/linux"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

func collectStartupPaths() []string {
	var out []string
	for _, arg := range os.Args[1:] {
		if len(arg) > 0 && arg[0] == '-' {
			continue
		}
		abs, err := filepath.Abs(arg)
		if err != nil {
			continue
		}
		if _, err := os.Stat(abs); err == nil {
			out = append(out, abs)
		}
	}
	return out
}

func Run(assets fs.FS) {
	app := NewApp()
	app.pendingPaths = collectStartupPaths()
	if len(app.pendingPaths) > 0 {
		app.requestForeground("startup_args")
	}

	err := wails.Run(&options.App{
		Title:     "图片查看",
		Width:     960,
		Height:    720,
		MinWidth:  400,
		MinHeight: 300,
		AssetServer: &assetserver.Options{
			Assets:     assets,
			Handler:    newLocalFileHandler(),
			Middleware: newLocalFileMiddleware(),
		},
		BackgroundColour: &options.RGBA{R: 245, G: 245, B: 245, A: 1},
		OnStartup:        app.startup,
		OnDomReady:       app.domReady,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
		},
		Mac: &mac.Options{
			OnFileOpen: func(path string) {
				app.PushPendingPaths([]string{path})
			},
		},
		Linux: &linux.Options{
			ProgramName: "图片查看",
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
