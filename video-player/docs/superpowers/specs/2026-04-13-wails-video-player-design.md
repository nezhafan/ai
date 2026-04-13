# Wails Local Video Player Design

## Overview

Build a cross-platform desktop video player with Wails and a plain HTML/CSS/JS frontend. The app is scoped to local file playback only. It must reuse the existing visual and interaction assets under `assets/` without modifying those source files directly.

Confirmed constraints:

- Frontend uses plain HTML/CSS/JS, not React.
- Local file playback only.
- File selection starts from a button-driven system picker.
- Persist volume and playback rate.
- Do not persist playback history or recently opened files.
- Preserve keyboard shortcuts.
- Do not edit `assets/video-player.js` or `assets/video-player.css`; add new files instead.

## Goals

- Launch as a Wails desktop app on supported platforms.
- Show an empty-state player UI on startup.
- Let the user choose a local video file through the system file picker.
- Start playback in the existing styled player once a file is selected.
- Preserve volume and playback rate across app restarts.
- Keep the original player look and core interactions from the existing assets.

## Non-Goals

- No React frontend.
- No network URL playback.
- No playlist support.
- No playback history, recent files, or resume position.
- No media library, thumbnails, or metadata extraction.
- No codec workarounds beyond what the platform WebView already supports.

## Architecture

### Backend

The Wails Go backend provides desktop-only capabilities:

- `OpenVideoFile()`: opens the system file picker and returns the selected file path.
- File filter: allow common video extensions such as `.mp4`, `.mov`, `.m4v`, `.webm`, `.mkv`, and `.avi`.
- If the user cancels the picker, return an empty result rather than treating it as an error.

The backend does not manage playback state, media controls, or persistence of frontend settings.

### Frontend

The frontend is a minimal Wails web app composed of static HTML plus plain JavaScript:

- A root HTML page initializes the player shell.
- `assets/video-player.css` is loaded as the base visual layer.
- A new app-specific stylesheet adds window layout, empty-state integration details, and lightweight app-level status styling.
- A new app-specific script initializes the player, bridges to Wails runtime calls, and layers desktop behavior on top of the existing asset patterns.

### Asset Strategy

The original asset files remain unchanged:

- `assets/video-player.css`
- `assets/video-player.js`

New files adapt the app for Wails usage. The preferred implementation is:

- Reuse `assets/video-player.css` directly.
- Do not execute `assets/video-player.js` as the main controller for the app.
- Port or mirror only the needed behavior from the asset script into a new desktop-focused script, so the Wails bridge and persistence logic remain explicit and maintainable.

This satisfies the requirement to use the existing assets while keeping the original files intact.

## UI And Interaction Design

### Startup State

On launch, the app shows the player in an empty state:

- The video area is present.
- The central CTA invites the user to open a local video.
- No file is preloaded.
- No playback history is restored.

### File Open Flow

1. User clicks the open button in the player UI.
2. Frontend calls `OpenVideoFile()` through the Wails bridge.
3. If a path is returned, the frontend converts it into a valid video source for the embedded WebView.
4. The video element loads the file and attempts playback.
5. The title area displays the selected file name.

If the picker is canceled:

- The app stays in its current state.
- No error message is shown.

If the selected file cannot be played:

- The app shows a concise inline error message.
- The user can immediately try opening another file.

### Player Controls

The player provides:

- Play and pause.
- Progress display and seeking.
- Current time and total duration.
- Volume adjustment and mute state handling.
- Playback rate switching.
- Fullscreen toggle.
- Auto-hide controls while idle.

The interface should preserve the style and behavior patterns already expressed in the asset files.

### Keyboard Shortcuts

The app preserves keyboard shortcuts:

- `Space`: play or pause.
- `ArrowLeft`: seek backward 5 seconds.
- `ArrowRight`: seek forward 5 seconds.
- `ArrowUp`: increase volume.
- `ArrowDown`: decrease volume.
- `F`: toggle fullscreen.

Shortcut handling must ignore editable targets if focus is on an interactive text-capable element in the future.

## State Management

### Persistent State

Persist in `localStorage`:

- `volume`
- `playbackRate`

On app startup:

- Read stored values.
- Validate them.
- Apply them to the player when the video element initializes.

On user change:

- Save the latest volume value.
- Save the latest playback rate value.

### Ephemeral State

Do not persist:

- Current file path.
- Playback position.
- Playback history.
- Recent files.
- Fullscreen status.

## Wails Integration Details

The project will use a standard Wails application layout with:

- Go app entrypoint and backend method binding.
- A frontend directory served by Wails.
- JS bindings generated by Wails for calling backend methods from the browser context.

The frontend should rely on generated Wails bindings rather than manual ad hoc bridge code where possible.

## File Plan

Expected high-level additions:

- Wails app bootstrap files.
- Backend Go file exposing `OpenVideoFile()`.
- Frontend HTML entrypoint.
- New frontend JavaScript controller for player bootstrapping and desktop behavior.
- New frontend CSS file for app-shell adjustments.
- Wails config and build files required for a runnable desktop app.

The implementation should keep the original `assets` files untouched and reference them from the new frontend entrypoint.

## Error Handling

- Canceling file selection is a normal path, not an error.
- Invalid or unsupported files should produce a short visible error state.
- Persistence failures in `localStorage` should fail silently and not block playback.
- Fullscreen actions should degrade gracefully if not available in the current platform WebView.

## Cross-Platform Considerations

The app is intended to be cross-platform at the Wails layer, but playback support still depends on the platform WebView media stack. The design assumes:

- Common H.264/AAC MP4 playback is the primary happy path.
- Some codecs or containers may fail on specific platforms.
- The app surfaces playback failure but does not attempt transcoding or fallback decoding.

## Testing Strategy

The implementation will verify:

- Wails project compiles successfully.
- Frontend assets load correctly.
- The open-file button triggers the system picker.
- Selecting a valid local file loads it into the player.
- Playback controls operate correctly.
- Keyboard shortcuts work for play/pause, seek, volume, and fullscreen.
- Volume persists after app restart.
- Playback rate persists after app restart.
- Original asset files remain unchanged.

## Acceptance Criteria

- Launching the app shows a local-video player empty state.
- Clicking the open button invokes the system file picker.
- Choosing a valid local video starts playback in the player.
- The file name is shown in the player header.
- Controls for progress, volume, playback rate, and fullscreen work.
- Keyboard shortcuts work as defined.
- Restarting the app preserves volume and playback rate.
- No playback history or recent file list is stored.
- `assets/video-player.js` and `assets/video-player.css` are not modified.

## Risks And Tradeoffs

- Plain DOM code is the right fit for this scope, but it is less extensible than a component-based frontend if the app later grows into playlists, settings pages, or a media library.
- Reusing the existing CSS is low risk; reusing the existing JS as-is is higher risk because it was written for a plain webpage rather than a Wails-integrated desktop app.
- Local file playback behavior can vary by platform because Wails relies on the system WebView.

## Recommended Next Step

After spec approval, create an implementation plan for:

1. Wails project scaffolding.
2. Backend file-picker API.
3. Frontend player shell and asset wiring.
4. Local settings persistence.
5. Keyboard shortcut support.
6. Verification of launch, playback, and persistence behavior.
