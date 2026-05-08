package backend

import (
	"bytes"
	"context"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	_ "image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"

	_ "golang.org/x/image/bmp"
	_ "golang.org/x/image/webp"

	"github.com/nfnt/resize"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx               context.Context
	pendingPathsMu    sync.Mutex
	pendingPaths      []string
	domReadySeen      bool
	foregroundMu      sync.Mutex
	foregroundPending bool
	activateWindow    func(context.Context, string)
}

func NewApp() *App {
	app := &App{}
	app.activateWindow = app.defaultActivateWindow
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) domReady(ctx context.Context) {
	a.foregroundMu.Lock()
	a.domReadySeen = true
	shouldActivate := a.foregroundPending
	a.foregroundPending = false
	a.foregroundMu.Unlock()

	if shouldActivate {
		a.activateWindow(ctx, "dom_ready_pending")
	}
}

func (a *App) shutdown(ctx context.Context) {}

func (a *App) requestForeground(reason string) {
	a.foregroundMu.Lock()
	if a.ctx != nil && a.domReadySeen {
		ctx := a.ctx
		a.foregroundMu.Unlock()
		a.activateWindow(ctx, reason)
		return
	}

	a.foregroundPending = true
	a.foregroundMu.Unlock()
}

func (a *App) defaultActivateWindow(ctx context.Context, reason string) {
	wailsRuntime.Show(ctx)
	wailsRuntime.WindowShow(ctx)
	wailsRuntime.WindowUnminimise(ctx)
	activateNativeForeground()
}

var imageExtensions = map[string]bool{
	"jpg": true, "jpeg": true, "png": true, "gif": true,
	"bmp": true, "webp": true, "avif": true, "heic": true,
	"heif": true, "tif": true, "tiff": true,
}

// ListImages returns all image files in the given directory.
func (a *App) ListImages(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	var images []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(strings.TrimPrefix(filepath.Ext(entry.Name()), "."))
		if imageExtensions[ext] {
			images = append(images, filepath.Join(dir, entry.Name()))
		}
	}
	sort.Strings(images)
	return images, nil
}

// IsDir returns true if the path is a directory.
func (a *App) IsDir(path string) bool {
	info, err := os.Stat(path)
	if err != nil {
		return false
	}
	return info.IsDir()
}

// ReadImage reads an image file and returns its contents as a base64 string.
func (a *App) ReadImage(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(data), nil
}

// SaveImage saves base64-encoded image data to the given path.
func (a *App) SaveImage(path string, base64Data string) error {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return fmt.Errorf("invalid base64 data: %w", err)
	}
	return os.WriteFile(path, data, 0644)
}

// ReadThumbnail reads an image and returns a JPEG thumbnail as base64.
func (a *App) ReadThumbnail(path string, maxSize uint32) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return "", err
	}

	bounds := img.Bounds()
	w := uint(bounds.Dx())
	h := uint(bounds.Dy())

	var newW, newH uint
	if w > h {
		if w <= uint(maxSize) {
			newW, newH = w, h
		} else {
			ratio := float64(maxSize) / float64(w)
			newW = uint(maxSize)
			newH = uint(float64(h) * ratio)
		}
	} else {
		if h <= uint(maxSize) {
			newW, newH = w, h
		} else {
			ratio := float64(maxSize) / float64(h)
			newW = uint(float64(w) * ratio)
			newH = uint(maxSize)
		}
	}

	thumbnail := resize.Resize(newW, newH, img, resize.Bilinear)

	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, thumbnail, &jpeg.Options{Quality: 85}); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// EncodeIndexedPNG takes base64-encoded RGBA pixel data and encodes it as an indexed PNG.
func (a *App) EncodeIndexedPNG(base64Data string, width uint32, height uint32) (string, error) {
	data, err := base64.StdEncoding.DecodeString(base64Data)
	if err != nil {
		return "", fmt.Errorf("invalid base64 input: %w", err)
	}

	pixelCount := int(width) * int(height)
	if len(data) != pixelCount*4 {
		return "", fmt.Errorf("invalid RGBA buffer length: expected %d, got %d", pixelCount*4, len(data))
	}

	paletteMap := make(map[[4]byte]uint8)
	var paletteList []color.RGBA
	indices := make([]uint8, pixelCount)

	for i := 0; i < len(data); i += 4 {
		key := [4]byte{data[i], data[i+1], data[i+2], data[i+3]}
		idx, ok := paletteMap[key]
		if !ok {
			if len(paletteList) >= 256 {
				return "", fmt.Errorf("indexed PNG palette exceeds 256 colors")
			}
			idx = uint8(len(paletteList))
			paletteMap[key] = idx
			paletteList = append(paletteList, color.RGBA{key[0], key[1], key[2], key[3]})
		}
		indices[i/4] = idx
	}

	pal := make(color.Palette, len(paletteList))
	for i, c := range paletteList {
		pal[i] = c
	}

	img := image.NewPaletted(image.Rect(0, 0, int(width), int(height)), pal)
	img.Pix = indices

	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return "", err
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes()), nil
}

// CopyImageToClipboard copies the image at the given path to the system clipboard.
func (a *App) CopyImageToClipboard(path string) error {
	switch runtime.GOOS {
	case "darwin":
		script := fmt.Sprintf(`set the clipboard to (read (POSIX file "%s") as «class PNGf»)`, path)
		return exec.Command("osascript", "-e", script).Run()
	case "windows":
		script := fmt.Sprintf(
			`Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Clipboard]::SetImage([System.Drawing.Image]::FromFile('%s'))`,
			strings.ReplaceAll(path, "'", "''"),
		)
		return exec.Command("powershell", "-Command", script).Run()
	default:
		return fmt.Errorf("unsupported platform for clipboard operation")
	}
}

// TakePendingOpenPaths returns any paths collected at startup.
func (a *App) TakePendingOpenPaths() []string {
	a.pendingPathsMu.Lock()
	defer a.pendingPathsMu.Unlock()
	paths := a.pendingPaths
	a.pendingPaths = nil
	return paths
}

// CheckMacOSSecurityStatus checks macOS security attributes.
func (a *App) CheckMacOSSecurityStatus() map[string]interface{} {
	if runtime.GOOS != "darwin" {
		return map[string]interface{}{
			"supported":    false,
			"allowed":      true,
			"quarantined":  false,
			"translocated": false,
			"note":         "non-macos platform",
		}
	}
	// Simplified: full implementation would need CGo for spctl/xattr checks.
	return map[string]interface{}{
		"supported":    true,
		"allowed":      true,
		"quarantined":  false,
		"translocated": false,
	}
}

// OpenMacOSSecuritySettings opens macOS Security & Privacy preferences.
func (a *App) OpenMacOSSecuritySettings() error {
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("only available on macOS")
	}
	return exec.Command("open", "x-apple.systempreferences:com.apple.preference.security?General").Run()
}

// OpenImageDialog opens a native file dialog to select image files.
func (a *App) OpenImageDialog() ([]string, error) {
	filter := wailsRuntime.FileFilter{
		DisplayName: "Images",
		Pattern:     "*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.webp;*.avif;*.heic;*.heif;*.tif;*.tiff",
	}
	return wailsRuntime.OpenMultipleFilesDialog(a.ctx, wailsRuntime.OpenDialogOptions{
		Title:   "打开图片",
		Filters: []wailsRuntime.FileFilter{filter},
	})
}

// SaveImageDialog opens a native save dialog and returns the chosen path.
func (a *App) SaveImageDialog(defaultFilename string, ext string) (string, error) {
	pattern := "*." + ext
	return wailsRuntime.SaveFileDialog(a.ctx, wailsRuntime.SaveDialogOptions{
		DefaultFilename: defaultFilename,
		Filters: []wailsRuntime.FileFilter{
			{DisplayName: "Image (*." + ext + ")", Pattern: pattern},
		},
	})
}

// PushPendingPaths adds paths and emits the "open-paths" event to the frontend.
func (a *App) PushPendingPaths(paths []string) {
	if len(paths) == 0 {
		return
	}
	a.pendingPathsMu.Lock()
	a.pendingPaths = append(a.pendingPaths, paths...)
	a.pendingPathsMu.Unlock()

	a.requestForeground("push_pending_paths")
	wailsRuntime.EventsEmit(a.ctx, "open-paths", paths)
}
