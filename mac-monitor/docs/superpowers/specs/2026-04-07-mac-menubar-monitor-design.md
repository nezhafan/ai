# Mac Menu Bar Monitor Design

**Goal:** Build a macOS menu bar utility in Python that shows live CPU and memory usage directly in the status bar as two aligned vertical tiles, without using a dropdown menu.

## Scope

This utility is a single-purpose macOS status bar app. It will:

- Display two side-by-side tiles in the menu bar.
- Show the current percentage value on the top line of each tile.
- Show `CPU` and `MEM` labels on the bottom line of each tile.
- Refresh every 2 seconds.
- Avoid clipping or overflowing the menu bar area by using a fixed, compact width.

It will not:

- Show a dropdown menu for metrics.
- Persist history.
- Draw charts or sparklines.
- Support non-macOS platforms.

## Architecture

The app will use Python with PyObjC to create a native `NSStatusItem`. Instead of relying on a simple text title, it will attach a custom `NSView` to the status item button so the menu bar content can be laid out as two vertical tiles.

Metric collection will be handled in Python on a repeating 2-second timer. The timer callback will read CPU and memory usage and update the custom view's labels on the main thread.

## UI Layout

The status item will contain one horizontal container with two equal-width tiles:

- Left tile: CPU metric
- Right tile: memory metric

Each tile will contain:

- Top text: a centered percentage string such as `18%`
- Bottom text: a centered label, either `CPU` or `MEM`

Layout rules:

- Top and bottom text must stay vertically aligned across both tiles.
- Bottom labels use a smaller font size than the percentage values.
- Bottom labels use the same foreground color as the main value text.
- The component width is fixed to a compact value so it remains visible and avoids truncation under normal menu bar usage.
- The tile spacing and padding are symmetric so the two blocks feel balanced.

## Styling

- Use native text rendering through AppKit controls.
- Percentage text uses a larger semibold system font.
- `CPU` and `MEM` labels use a smaller system font.
- Colors follow the default menu bar foreground appearance so the text remains readable in light and dark mode.
- No borders, backgrounds, or dropdown affordances are required in the first version.

## Data Flow

1. App launches and creates `NSApplication`.
2. App creates an `NSStatusItem` with a fixed width.
3. App mounts a custom view with four text fields:
   - CPU value
   - CPU label
   - MEM value
   - MEM label
4. A repeating timer fires every 2 seconds.
5. The timer callback reads system CPU and memory usage.
6. The callback formats percentages as whole numbers and updates the text fields.

## Metric Collection

CPU and memory usage will be collected from the local machine at runtime. The implementation should prefer a well-supported Python API such as `psutil` for reliable sampling.

Metric formatting rules:

- CPU is shown as an integer percentage.
- Memory is shown as an integer percentage of used physical memory.
- Values are clamped to sensible bounds if needed before display.

## Error Handling

- If one metric read fails, the app should continue running and display a fallback such as `--%` for that metric.
- Timer failures must not terminate the app loop.
- If the required dependency is missing, startup instructions should clearly describe how to install it.

## Testing

Given the UI-heavy nature of a menu bar app, validation will focus on:

- Static verification that the app launches successfully.
- Manual confirmation that both tiles render in the menu bar.
- Manual confirmation that top and bottom text remain aligned.
- Manual confirmation that values refresh every 2 seconds.
- Manual confirmation that the width stays compact and does not visibly overflow or clip under normal menu bar conditions.

## Deliverables

- A minimal Python app entry point.
- A dependency file documenting required packages.
- A short README with install and run instructions for macOS.
