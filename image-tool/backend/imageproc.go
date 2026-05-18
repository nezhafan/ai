package backend

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"strings"

	"golang.org/x/image/bmp"
	xgdraw "golang.org/x/image/draw"
	_ "golang.org/x/image/tiff"
	"golang.org/x/image/webp"
)

func loadImage(path string) (image.Image, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	img, format, err := image.Decode(f)
	if err != nil {
		return nil, "", err
	}
	return img, format, nil
}

func generatePreview(img image.Image) string {
	const previewSize = 128
	bounds := img.Bounds()
	w := bounds.Dx()
	h := bounds.Dy()

	var thumbW, thumbH int
	if w > h {
		thumbW = previewSize
		thumbH = int(float64(h) * float64(previewSize) / float64(w))
	} else {
		thumbH = previewSize
		thumbW = int(float64(w) * float64(previewSize) / float64(h))
	}
	if thumbW < 1 {
		thumbW = 1
	}
	if thumbH < 1 {
		thumbH = 1
	}

	thumb := image.NewRGBA(image.Rect(0, 0, thumbW, thumbH))
	xgdraw.CatmullRom.Scale(thumb, thumb.Bounds(), img, bounds, draw.Over, nil)

	var buf bytes.Buffer
	if err := png.Encode(&buf, thumb); err != nil {
		return ""
	}

	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func resizeImage(img image.Image, opts ProcessingOptions) image.Image {
	bounds := img.Bounds()
	srcW := bounds.Dx()
	srcH := bounds.Dy()

	var newW, newH int

	switch opts.ResizeMode {
	case "scale":
		scale := float64(opts.ResizeScale) / 100.0
		newW = int(float64(srcW) * scale)
		newH = int(float64(srcH) * scale)
		if newW < 1 {
			newW = 1
		}
		if newH < 1 {
			newH = 1
		}
	case "dimensions":
		newW = opts.ResizeWidth
		newH = opts.ResizeHeight
	case "width":
		newW = opts.ResizeWidth
		newH = int(float64(srcH) * float64(newW) / float64(srcW))
		if newH < 1 {
			newH = 1
		}
	case "height":
		newH = opts.ResizeHeight
		newW = int(float64(srcW) * float64(newH) / float64(srcH))
		if newW < 1 {
			newW = 1
		}
	default:
		return img
	}

	if newW == srcW && newH == srcH {
		return img
	}

	dst := image.NewRGBA(image.Rect(0, 0, newW, newH))
	xgdraw.CatmullRom.Scale(dst, dst.Bounds(), img, bounds, draw.Over, nil)
	return dst
}

func encodeImage(img image.Image, outputPath, format string, opts ProcessingOptions) ([]string, error) {
	steps := []string{}

	switch strings.ToLower(format) {
	case "jpg", "jpeg":
		quality := 85
		if opts.CompressionType == "quality" && opts.CompressionQuality != nil {
			quality = opts.CompressionQuality.Percent
		}
		if opts.CompressionType == "preset" {
			switch opts.CompressionPreset {
			case "standard":
				quality = 80
			case "128":
				quality = 60
			case "256":
				quality = 40
			}
		}
		if err := encodeJPEG(img, outputPath, quality); err != nil {
			return nil, err
		}
		steps = append(steps, fmt.Sprintf("JPEG 质量 %d", quality))
	case "png":
		if opts.CompressionType == "indexedColor" {
			maxColors := 256
			if opts.CompressionPreset == "128" {
				maxColors = 128
			}
			if err := encodePNGIndexed(img, outputPath, maxColors); err != nil {
				return nil, err
			}
			steps = append(steps, fmt.Sprintf("PNG 索引色 %d 色", maxColors))
		} else {
			if err := encodePNG(img, outputPath); err != nil {
				return nil, err
			}
			steps = append(steps, "PNG 无损")
		}
	default:
		if err := encodePNG(img, outputPath); err != nil {
			return nil, err
		}
		steps = append(steps, "默认 PNG")
	}

	return steps, nil
}

func encodeJPEG(img image.Image, outputPath string, quality int) error {
	f, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer f.Close()

	return jpeg.Encode(f, img, &jpeg.Options{Quality: quality})
}

func encodePNG(img image.Image, outputPath string) error {
	f, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer f.Close()

	encoder := &png.Encoder{CompressionLevel: png.BestCompression}
	return encoder.Encode(f, img)
}

func encodePNGIndexed(img image.Image, outputPath string, maxColors int) error {
	palette := quantizeColors(img, maxColors)
	paletted := image.NewPaletted(img.Bounds(), palette)
	draw.FloydSteinberg.Draw(paletted, img.Bounds(), img, image.Point{})

	f, err := os.Create(outputPath)
	if err != nil {
		return err
	}
	defer f.Close()

	encoder := &png.Encoder{CompressionLevel: png.BestCompression}
	return encoder.Encode(f, paletted)
}

func quantizeColors(img image.Image, maxColors int) color.Palette {
	bounds := img.Bounds()

	bits := uint(3)
	if maxColors <= 128 {
		bits = 2
	}

	colorCount := make(map[[3]uint8]int)
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := img.At(x, y).RGBA()
			if a == 0 {
				continue
			}
			key := [3]uint8{
				uint8(r>>8) >> (8 - bits) << (8 - bits),
				uint8(g>>8) >> (8 - bits) << (8 - bits),
				uint8(b>>8) >> (8 - bits) << (8 - bits),
			}
			colorCount[key]++
		}
	}

	palette := make(color.Palette, 0, len(colorCount))
	for key := range colorCount {
		palette = append(palette, color.RGBA{R: key[0], G: key[1], B: key[2], A: 255})
	}

	return palette
}

func decodeFullImage(path string) (image.Image, string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, "", err
	}
	defer f.Close()

	img, format, err := image.Decode(f)
	return img, format, err
}

func init() {
	image.RegisterFormat("jpeg", "jpeg", jpeg.Decode, jpeg.DecodeConfig)
	image.RegisterFormat("jpg", "jpg", jpeg.Decode, jpeg.DecodeConfig)
	image.RegisterFormat("png", "png", png.Decode, png.DecodeConfig)
	image.RegisterFormat("gif", "gif", gif.Decode, gif.DecodeConfig)
	image.RegisterFormat("webp", "webp", webp.Decode, webp.DecodeConfig)
	image.RegisterFormat("bmp", "bmp", bmp.Decode, bmp.DecodeConfig)
}
