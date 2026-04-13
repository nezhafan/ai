package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

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
