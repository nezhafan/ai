# Video Editor Design

## Overview

Build a cross-platform desktop video tool that supports local single-file `mp4` and single-file `ts` input, playback controls, timeline-based navigation, simple segment deletion, and export to a new `mp4` file. The application targets macOS and Windows packaging and uses `Electron + React + TypeScript + ffmpeg`.

The first version is intentionally narrow:
- One video track only
- Local files only
- Input formats limited to single `mp4` and single `ts`
- Output format limited to `mp4`
- Editing model limited to creating markers, selecting marker-bounded segments, marking segments for deletion, and exporting the remaining content

## Goals

- Open and play local `mp4` and `ts` files
- Support normal playback controls:
  - Play
  - Pause
  - Space to toggle play and pause
  - Seek forward 5 seconds
  - Seek backward 5 seconds
  - Click or drag on a timeline to seek
- Support an edit mode:
  - Add markers at the current playback time
  - Use adjacent markers to define segments
  - Select a segment and mark it as deleted
  - Undo deletion before export
  - Export the remaining video as a new `mp4`
- Support converting a single `ts` file to `mp4` through the same export pipeline
- Package the app for macOS and Windows

## Non-Goals

- No multi-track timeline
- No waveform display
- No keyframe thumbnails
- No freeform trim handles for dragging segment boundaries
- No direct in-place file modification
- No network video sources
- No `m3u8` or multi-file TS playlist support
- No output formats other than `mp4` in v1

## Product Model

The app has two modes.

### Normal Mode

Normal mode is the default playback mode. Users can:
- Open a file
- Play and pause
- Use the space key to toggle play state
- Jump backward or forward by 5 seconds
- See current time and total duration
- Seek by clicking or dragging the timeline

### Edit Mode

Edit mode adds lightweight cut planning on top of playback.

Users can:
- Add markers at the current playback position
- View markers on the timeline
- See segments formed by every adjacent marker pair
- Select a segment from the timeline or segment list
- Mark the selected segment as deleted
- Restore a previously deleted segment before export

Editing never changes the source file. The UI only stores edit decisions in memory for the current file session.

## Segment Definition Rules

Markers are sorted by time. Adjacent markers define one segment.

Example:
- Markers at `10s`, `25s`, `40s`
- Segments are `10-25` and `25-40`

Only marker-bounded segments are deletable in v1. There is no separate boundary drag editing.

To keep the model unambiguous, the app should treat the video start and end as implicit boundaries when generating export ranges. That means:
- If the user creates markers inside the video, export logic can still compute the remaining ranges around deleted segments
- A deleted segment always maps to a concrete `[start, end)` time range

To keep the UI predictable, the app should also treat the video start and end as implicit timeline boundaries when building selectable segments. That means:
- With one marker at `10s`, selectable segments are `0-10` and `10-end`
- With markers at `10s`, `25s`, `40s`, selectable segments are `0-10`, `10-25`, `25-40`, and `40-end`

If no markers exist, there are no user-defined segments to delete. The user can still export the original content as a re-encoded `mp4`, which also covers plain `ts -> mp4` conversion.

## UX Layout

The first version UI should have four areas:

### Top Bar

- Open file button
- File name display
- Mode toggle (`Normal` / `Edit`)
- Export button

### Player Area

- Video element
- Empty state before file load
- Loading / error state when file probing fails

### Bottom Controls

- Play / pause
- Backward 5 seconds
- Forward 5 seconds
- Current time / total duration
- Timeline with draggable playhead

### Edit Panel

- Add marker button
- Marker list with timestamps
- Segment list
- Delete selected segment button
- Restore deleted segment action
- Export progress and status

The timeline does not need thumbnails or waveforms. It only needs:
- A track
- A draggable playhead
- Marker indicators
- Segment visualization
- A distinct visual style for deleted segments

## Architecture

### Desktop Shell

Use `Electron` for:
- Native file selection
- Safe local file access
- Running `ffmpeg` and `ffprobe`
- Packaging on macOS and Windows

### Frontend

Use `React + TypeScript` in the renderer process for:
- Playback UI
- Timeline interactions
- Marker and segment state
- Export progress display

### Secure Bridge

Use a `preload` script to expose a narrow IPC API from Electron main to the renderer. The renderer should not access Node APIs directly.

### Media Processing

Use bundled `ffprobe` to inspect:
- Duration
- Streams
- Container information

Use bundled `ffmpeg` to:
- Re-encode a source `mp4` to exported `mp4`
- Convert a source `ts` to exported `mp4`
- Export the remaining video after deleted ranges are removed

## Playback Design

The renderer uses a standard HTML5 `video` element.

Local files are loaded from a safe file path or object URL supplied through the Electron bridge. Playback controls update the video element directly.

The timeline is synchronized with the `video.currentTime` value and supports:
- Click to seek
- Drag to scrub
- Keyboard-independent playback control through buttons

Space key toggling should be disabled when focus is inside text inputs, if any exist later.

## Edit State Model

The renderer owns the edit session state for the currently opened file.

Recommended model:
- `file`
- `duration`
- `markers: number[]`
- `segments: { id, start, end, deleted }[]`
- `selectedSegmentId`
- `mode`
- `exportState`

Segment regeneration rules:
- Sort and deduplicate markers within a small tolerance
- Recompute adjacent marker segments after marker changes
- Preserve deleted state by stable segment ids where possible, otherwise recalculate cleanly

For v1, it is acceptable to clear selected segment state if markers are changed in a way that invalidates current segments.

## Export Pipeline

The export action always creates a new `mp4`.

### Export Without Deleted Segments

If there are no deleted segments:
- Source `mp4` exports as a re-encoded `mp4`
- Source `ts` exports as a re-encoded `mp4`

This keeps the pipeline consistent and avoids format-specific branching in the UI.

### Export With Deleted Segments

If one or more segments are marked deleted:
1. Compute deleted ranges
2. Compute remaining ranges from full video duration
3. Ignore zero-length or near-zero ranges
4. Use `ffmpeg` to cut the remaining ranges
5. Concatenate the remaining ranges
6. Re-encode to the final `mp4`

This approach is slower than stream copying, but it is much more stable for v1 and works consistently for both input types.

## ffmpeg Strategy

The export implementation should prefer correctness over maximum speed.

Use a range-based workflow with re-encoding:
- Probe source metadata with `ffprobe`
- Build keep ranges from edit state
- Produce final `mp4` from those ranges with `ffmpeg`

The app should surface:
- Export started
- Export progress if available
- Export success with output path
- Export failure with a concise error summary

## Error Handling

The app should handle these cases clearly:

- Unsupported file extension
- Probe failure
- Missing or unusable `ffmpeg` / `ffprobe`
- Timeline actions before file load
- Export with no file loaded
- Export failure
- Duplicate export clicks while a job is already running

Closing or replacing the file should clear all markers, segment selections, and deletion state tied to the previous file.

## Packaging

Use `electron-builder`.

Packaging requirements:
- macOS build
- Windows build
- Bundle `ffmpeg` and `ffprobe` with the app
- Ensure runtime code resolves packaged binary paths correctly in development and production

## Testing Strategy

The first implementation should cover:

- Unit tests for marker-to-segment generation
- Unit tests for deleted-range to keep-range conversion
- Unit tests for timeline utility functions
- UI tests for mode switching, marker creation, segment selection, and deletion state
- Integration tests for IPC boundaries where practical

Manual verification should include:
- Open `mp4`
- Open `ts`
- Play / pause / space toggle
- Seek by buttons
- Seek by timeline drag
- Add markers
- Delete a segment
- Restore a segment
- Export remaining video
- Export plain `ts -> mp4`
- Verify packaged app launch on macOS and Windows

## Implementation Boundaries

To keep v1 deliverable, do not expand scope into:
- Professional NLE-style timeline editing
- Thumbnail generation
- Background task queue management
- Multiple simultaneous exports
- Edit project save/load

If later versions need finer control, the next upgrade path is adding direct segment boundary editing on the timeline. That should be treated as a separate feature after this version is stable.
