package main

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

func TestMediaHandlerSupportsHeadRequests(t *testing.T) {
	tempDir := t.TempDir()
	videoPath := filepath.Join(tempDir, "sample.mp4")
	if err := os.WriteFile(videoPath, []byte("fake mp4 content"), 0o644); err != nil {
		t.Fatalf("write test file: %v", err)
	}

	request := httptest.NewRequest(http.MethodHead, "/local-media?path="+url.QueryEscape(videoPath), nil)
	recorder := httptest.NewRecorder()

	mediaHandler().ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected HEAD request to return 200, got %d", recorder.Code)
	}

	if got := recorder.Header().Get("Accept-Ranges"); got == "" {
		t.Fatalf("expected Accept-Ranges header for media probing")
	}

	if got := recorder.Header().Get("Content-Length"); got == "" {
		t.Fatalf("expected Content-Length header for media probing")
	}
}

func TestParseMP4DurationSecondsReadsMovieHeaderDuration(t *testing.T) {
	filePath := filepath.Join(t.TempDir(), "duration.mp4")
	if err := os.WriteFile(filePath, buildTestMP4WithDuration(t, 1000, 5000), 0o644); err != nil {
		t.Fatalf("write test mp4: %v", err)
	}

	duration, err := parseMP4DurationSeconds(filePath)
	if err != nil {
		t.Fatalf("parse duration: %v", err)
	}

	if duration != 5 {
		t.Fatalf("expected duration 5s, got %v", duration)
	}
}

func buildTestMP4WithDuration(t *testing.T, timescale uint32, duration uint32) []byte {
	t.Helper()

	mvhdPayload := make([]byte, 100)
	mvhdPayload[0] = 0
	putU32(mvhdPayload, 12, timescale)
	putU32(mvhdPayload, 16, duration)

	return append(box("ftyp", []byte("isom")), box("moov", box("mvhd", mvhdPayload))...)
}

func box(name string, payload []byte) []byte {
	buf := make([]byte, 8+len(payload))
	putU32(buf, 0, uint32(len(buf)))
	copy(buf[4:8], []byte(name))
	copy(buf[8:], payload)
	return buf
}

func putU32(buf []byte, offset int, value uint32) {
	buf[offset] = byte(value >> 24)
	buf[offset+1] = byte(value >> 16)
	buf[offset+2] = byte(value >> 8)
	buf[offset+3] = byte(value)
}
