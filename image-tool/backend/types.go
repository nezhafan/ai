package backend

type ProcessingOptions struct {
	ConvertFormat      string              `json:"convertFormat,omitempty"`
	ResizeMode         string              `json:"resizeMode,omitempty"`
	ResizeWidth        int                 `json:"resizeWidth,omitempty"`
	ResizeHeight       int                 `json:"resizeHeight,omitempty"`
	ResizeScale        int                 `json:"resizeScale,omitempty"`
	CompressionType    string              `json:"compressionType,omitempty"`
	CompressionPreset  string              `json:"compressionPreset,omitempty"`
	CompressionQuality *CompressionQuality `json:"compressionQuality,omitempty"`
	TargetRatio        float64             `json:"targetRatio,omitempty"`
}

type CompressionQuality struct {
	Percent int `json:"percent"`
}

type ProcessResult struct {
	Success      bool     `json:"success"`
	OutputPath   string   `json:"outputPath"`
	OriginalSize int64    `json:"originalSize"`
	OutputSize   int64    `json:"outputSize"`
	Message      string   `json:"message"`
	Steps        []string `json:"steps"`
	DurationMs   int64    `json:"durationMs"`
}

type ImageFileInfo struct {
	Path           string `json:"path"`
	FileName       string `json:"fileName"`
	Size           int64  `json:"size"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	PreviewDataURL string `json:"previewDataUrl,omitempty"`
}

type BatchProcessResult struct {
	Success           bool     `json:"success"`
	TotalFiles        int      `json:"totalFiles"`
	SuccessCount      int      `json:"successCount"`
	FailureCount      int      `json:"failureCount"`
	TotalOriginalSize int64    `json:"totalOriginalSize"`
	TotalOutputSize   int64    `json:"totalOutputSize"`
	OutputDir         string   `json:"outputDir,omitempty"`
	Message           string   `json:"message"`
	Failures          []string `json:"failures"`
}

type ProcessingStageEvent struct {
	InputPath string `json:"inputPath"`
	Stage     string `json:"stage"`
	ElapsedMs int64  `json:"elapsedMs"`
}

type PreviewEvent struct {
	InputPath      string `json:"inputPath"`
	PreviewDataURL string `json:"previewDataUrl"`
}
