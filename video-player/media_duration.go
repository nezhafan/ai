package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
)

func parseMP4DurationSeconds(filePath string) (float64, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return 0, err
	}
	defer file.Close()

	duration, timescale, err := findMovieHeaderDuration(file, filePath)
	if err != nil {
		return 0, err
	}

	if timescale == 0 || duration == 0 {
		return 0, errors.New("invalid mp4 duration metadata")
	}

	return float64(duration) / float64(timescale), nil
}

func findMovieHeaderDuration(reader io.ReaderAt, filePath string) (uint64, uint32, error) {
	info, err := os.Stat(filePath)
	if err != nil {
		return 0, 0, err
	}

	return scanBoxes(reader, 0, info.Size())
}

func scanBoxes(reader io.ReaderAt, start, end int64) (uint64, uint32, error) {
	var header [16]byte

	for offset := start; offset < end; {
		if _, err := reader.ReadAt(header[:8], offset); err != nil {
			return 0, 0, err
		}

		size := uint64(binary.BigEndian.Uint32(header[:4]))
		boxType := string(header[4:8])
		headerSize := uint64(8)

		if size == 1 {
			if _, err := reader.ReadAt(header[:16], offset); err != nil {
				return 0, 0, err
			}

			size = binary.BigEndian.Uint64(header[8:16])
			headerSize = 16
		} else if size == 0 {
			size = uint64(end - offset)
		}

		if size < headerSize {
			return 0, 0, fmt.Errorf("invalid mp4 box %s", boxType)
		}

		boxStart := offset + int64(headerSize)
		boxEnd := offset + int64(size)

		switch boxType {
		case "moov":
			return scanBoxes(reader, boxStart, boxEnd)
		case "mvhd":
			return readMovieHeader(reader, boxStart, int64(size-headerSize))
		}

		offset = boxEnd
	}

	return 0, 0, errors.New("mvhd box not found")
}

func readMovieHeader(reader io.ReaderAt, start, size int64) (uint64, uint32, error) {
	if size < 20 {
		return 0, 0, errors.New("mvhd box too small")
	}

	var version [1]byte
	if _, err := reader.ReadAt(version[:], start); err != nil {
		return 0, 0, err
	}

	if version[0] == 1 {
		payload := make([]byte, 32)
		if _, err := reader.ReadAt(payload, start); err != nil {
			return 0, 0, err
		}

		timescale := binary.BigEndian.Uint32(payload[20:24])
		duration := binary.BigEndian.Uint64(payload[24:32])
		return duration, timescale, nil
	}

	payload := make([]byte, 20)
	if _, err := reader.ReadAt(payload, start); err != nil {
		return 0, 0, err
	}

	timescale := binary.BigEndian.Uint32(payload[12:16])
	duration := uint64(binary.BigEndian.Uint32(payload[16:20]))
	return duration, timescale, nil
}
