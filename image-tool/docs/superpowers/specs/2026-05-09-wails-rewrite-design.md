# Image Tool Wails Rewrite Design

**Date:** 2026-05-09

## Goal

Rewrite the current desktop app from `Tauri + Rust` to `Wails v2 + Go` while preserving the existing React-based UI and the current end-user feature set as closely as practical.

This rewrite explicitly does **not** preserve the Rust image-processing implementation or its compression and palette-reduction strategy. The new implementation should instead follow the architectural direction used in `/opt/www/ai/image-view`: a Wails host, a Go backend, and a frontend that remains web-based.

## Confirmed Scope

### In Scope

- Replace Tauri with Wails as the desktop host.
- Replace the Rust backend with Go.
- Keep the current React + TypeScript frontend where practical.
- Preserve the current product feature set:
  - format conversion
  - image resizing
  - image compression
  - mask-to-transparency processing if it exists in the shipped UI flow
  - batch processing with configurable concurrency
  - local-only processing
- Preserve the current general UI layout and interaction model unless migration forces small targeted changes.
- Rebuild the desktop bridge layer:
  - file selection
  - output directory selection
  - image inspection
  - batch processing
  - progress updates

### Out of Scope

- Packaging and installer output
- Build script migration for release artifacts
- Reproducing the Rust algorithms exactly
- Large visual redesigns
- Cross-platform packaging behavior

## Current State Summary

The existing project is a `Vite + React + TypeScript + TailwindCSS` frontend with a `Tauri + Rust` backend. The frontend currently depends on Tauri APIs for:

- opening file dialogs
- opening output directory dialogs
- invoking backend commands
- listening for processing progress events
- window drag-drop integration

The backend currently owns image inspection and processing. It emits per-file processing stage updates and returns structured result payloads to the frontend.

## Recommended Architecture

Use a structure aligned to the reference Wails project:

```text
image-tool/
├── backend/
│   ├── app.go
│   ├── processing/
│   │   ├── service.go
│   │   ├── types.go
│   │   └── events.go
│   ├── imaging/
│   │   ├── decode.go
│   │   ├── encode.go
│   │   ├── resize.go
│   │   ├── compress.go
│   │   ├── quantize.go
│   │   └── paths.go
│   └── system/
│       └── dialogs.go
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
├── main.go
├── go.mod
└── wails.json
```

This keeps the desktop boundary narrow:

- `frontend/` renders UI and holds state
- `backend/app.go` exposes Wails bindings
- `backend/processing/` coordinates work and progress
- `backend/imaging/` owns image transforms and file naming

## Frontend Migration Design

The frontend should remain in React and TypeScript. The migration should minimize visual churn by preserving the existing component tree where that is reasonable.

### Keep

- the overall page layout in `App.tsx`
- the main `ImageProcessor` interaction model
- the existing processing option model where it maps cleanly to Go
- the current file list, progress list, and batch flow

### Replace

- `@tauri-apps/api/core` `invoke` calls with Wails-generated Go bindings
- Tauri dialog APIs with Wails runtime dialog usage exposed through Go methods
- Tauri event listeners with Wails runtime event listeners
- Tauri-specific drag-drop integration with either:
  - Wails runtime events if sufficient, or
  - a normal web drag-drop flow limited to file drops over the app content area

### Frontend Boundary Rule

The frontend should not own the authoritative batch-processing pipeline. It may format options, display progress, and manage drag-and-drop state, but file writes and image transformations should stay in Go.

## Backend Module Design

### `backend/app.go`

Responsibilities:

- expose Wails-bound methods to the frontend
- store Wails context
- validate top-level request shapes
- translate frontend requests into service calls

Expected methods:

- `SelectFiles() ([]string, error)`
- `SelectOutputDirectory() (string, error)`
- `InspectImages(inputPaths []string) ([]ImageFileInfo, error)`
- `ProcessImages(inputPaths []string, options ProcessingOptions, outputDir string, concurrency int) (BatchProcessResult, error)`

`app.go` should not directly contain image algorithms.

### `backend/processing/service.go`

Responsibilities:

- schedule batch work
- cap concurrency
- aggregate file-level results
- emit progress events
- isolate per-file failures so one bad file does not abort the whole batch

This module replaces the current Rust command orchestration and event emission.

### `backend/processing/events.go`

Responsibilities:

- define event names and payloads
- centralize Wails event emission

Recommended event shape:

```json
{
  "inputPath": "/abs/path/a.png",
  "stage": "loading",
  "elapsedMs": 123
}
```

The frontend should continue to consume stage-based updates similar to the current UI behavior.

### `backend/imaging/*`

Responsibilities:

- decode source images
- normalize orientation if the chosen Go stack supports EXIF orientation handling
- resize images
- convert formats
- apply JPEG compression
- apply PNG quantization / palette reduction
- write output files with collision-safe names

This layer must not depend on Wails types.

## Image Processing Design

The Rust implementation is intentionally discarded. The new Go pipeline should optimize for simple, understandable behavior and stable batch execution.

### Input Support

The app should continue to accept the image types currently surfaced by the UI where the Go stack can decode them reliably. If some formats from the current list are not realistically supported by the chosen Go libraries, the migration should narrow support explicitly in code and UI messaging rather than fail ambiguously.

### Resize Behavior

Support the current resize modes:

- none
- percentage scale
- width-constrained
- height-constrained
- dimensions

Aspect-ratio-preserving behavior should remain the default unless both dimensions are explicitly supplied.

### Conversion Behavior

Support output selection consistent with the current UI, but only for formats the Go encoder path can produce reliably.

### Compression Behavior

Compression behavior does not need to match Rust. It should instead be defined as:

- JPEG: quality-based encoding with bounded quality inputs
- PNG: either plain PNG encoding or indexed/palette PNG generation when the user chooses color reduction

The reference project indicates a viable direction for PNG palette work. This rewrite may either:

- implement quantization in Go, or
- use a small frontend-assisted helper only if that remains invisible to the user and does not turn the frontend into the primary processing engine

The preferred design is still Go-owned processing.

### EXIF Orientation

The previous backend normalized EXIF orientation. The new backend should preserve that user-visible behavior if feasible with the selected Go stack. If the chosen decoder path cannot do that reliably, the limitation must be made explicit during implementation and addressed before release.

### Progress Reporting

Keep stage-based progress updates, not byte-stream progress. The frontend already maps named stages into percentages, and that model is sufficient for this tool.

Recommended stages:

- `preparing`
- `loading`
- `transforming`
- `encoding`
- `writing`
- `done`
- `error`

## Data Flow

The target runtime flow is:

1. User selects files or drags files into the app.
2. Frontend requests image inspection from Go.
3. Go returns file metadata used to render the selection list.
4. User chooses output directory and processing options.
5. Frontend calls `ProcessImages(...)`.
6. Go schedules per-file work under the requested concurrency limit.
7. Go emits stage events during processing.
8. Frontend updates each row status from those events.
9. Go returns an aggregate batch result after all work completes.

This keeps the frontend reactive and the backend authoritative.

## Error Handling

The rewrite should preserve tolerant batch behavior:

- invalid or unreadable files fail individually
- unsupported format combinations fail individually
- output write conflicts are resolved by unique output naming
- one file failure does not terminate the whole batch unless the batch cannot start at all

Error messages should stay user-facing and concise. The frontend should continue showing row-level failures and batch-level summary feedback.

## Testing Strategy

Testing should focus on migration risk rather than pixel-perfect parity with the Rust backend.

### Go Tests

- output path collision naming
- resize dimension calculations
- batch aggregation logic
- concurrency limiting behavior
- unsupported option validation
- representative JPEG and PNG encode flows

### Frontend Tests

- option-to-request mapping
- progress event handling
- status transitions for success and failure
- drag-drop selection behavior if rewritten

### Manual Verification

- select multiple mixed-format files
- process to JPEG
- process to PNG
- resize by width, height, scale, and dimensions
- run color reduction flow
- verify output directory selection
- verify per-file progress rendering
- verify one broken file does not break the rest

## Migration Strategy

Implement the rewrite as a source-structure migration rather than an in-place hybrid.

Recommended sequence:

1. Scaffold Wails app structure alongside the current codebase.
2. Move the React app into `frontend/` and make it build under Wails.
3. Replace Tauri APIs with temporary Wails-compatible stubs.
4. Build the Go backend bindings and data types.
5. Reconnect image inspection.
6. Reconnect batch processing and progress events.
7. Remove Tauri and Rust code once the Wails path is working.

This sequence reduces the chance of breaking the UI and makes it easier to isolate migration regressions.

## Risks

- Go image library support may not cover every input format previously listed in the UI.
- PNG color reduction quality may differ noticeably from the prior Rust implementation.
- Wails drag-drop behavior may not map 1:1 to the current Tauri integration.
- Large images may stress memory if the new Go implementation is naive.

These risks are acceptable for the rewrite, but they must be handled explicitly during implementation and verification.

## Success Criteria

The rewrite is successful when:

- the app runs under Wails
- the frontend remains recognizably the same product
- Rust and Tauri are removed from the runtime path
- batch processing works end-to-end in Go
- progress updates still render in the UI
- the supported core flows work locally without server upload
