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
