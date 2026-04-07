# Mac Menu Bar Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python macOS menu bar app that displays CPU and memory usage as two aligned vertical tiles directly in the status bar and refreshes every 2 seconds.

**Architecture:** Use PyObjC to create a native `NSApplication` and `NSStatusItem`, then attach a custom AppKit view to the status bar button for precise two-row layout. Use `psutil` to sample CPU and memory usage on a repeating timer, and update four native text fields while keeping a compact fixed width so the status item stays aligned and avoids clipping.

**Tech Stack:** Python 3, PyObjC, psutil, AppKit/Foundation

---

### Task 1: Scaffold project files and dependency metadata

**Files:**
- Create: `app.py`
- Create: `requirements.txt`
- Create: `README.md`

- [ ] **Step 1: Write the failing dependency manifest**

```text
pyobjc
psutil
```

- [ ] **Step 2: Save the dependency manifest**

Run: `python3 -m compileall app.py`
Expected: FAIL with `Can't list 'app.py'`

- [ ] **Step 3: Create the initial app entry point**

```python
from AppKit import NSApplication


def main() -> None:
    app = NSApplication.sharedApplication()
    app.run()


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Add the initial README**

```markdown
# Mac Menu Bar Monitor

Python macOS status bar app that shows CPU and memory usage directly in the menu bar.

## Requirements

- macOS
- Python 3
- PyObjC
- psutil

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python3 app.py
```
```

- [ ] **Step 5: Run a syntax check on the scaffold**

Run: `python3 -m compileall app.py`
Expected: PASS with a `Compiling 'app.py'...` line

- [ ] **Step 6: Commit the scaffold**

```bash
git add requirements.txt app.py README.md
git commit -m "chore: scaffold mac menu bar monitor"
```

### Task 2: Add metric sampling with explicit fallback handling

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Add a failing metric smoke test via command-line execution**

Run: `python3 -c "from app import read_metrics; print(read_metrics())"`
Expected: FAIL with `ImportError` or `cannot import name 'read_metrics'`

- [ ] **Step 2: Add metric sampling helpers**

```python
from typing import Tuple

import psutil


def clamp_percentage(value: float) -> int:
    return max(0, min(100, int(round(value))))


def read_metrics() -> Tuple[str, str]:
    try:
        cpu_value = clamp_percentage(psutil.cpu_percent(interval=None))
        cpu_text = f"{cpu_value}%"
    except Exception:
        cpu_text = "--%"

    try:
        memory_value = clamp_percentage(psutil.virtual_memory().percent)
        mem_text = f"{memory_value}%"
    except Exception:
        mem_text = "--%"

    return cpu_text, mem_text
```

- [ ] **Step 3: Run the metric smoke test**

Run: `python3 -c "from app import read_metrics; print(read_metrics())"`
Expected: PASS with output similar to `('18%', '62%')`

- [ ] **Step 4: Commit the metric helpers**

```bash
git add app.py
git commit -m "feat: add cpu and memory sampling helpers"
```

### Task 3: Build the custom status bar view with aligned two-row tiles

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Add a failing UI construction check**

Run: `python3 -c "from app import StatusBarView; print(StatusBarView)" `
Expected: FAIL with `cannot import name 'StatusBarView'`

- [ ] **Step 2: Add the custom view and text field factory**

```python
from AppKit import (
    NSCenterTextAlignment,
    NSColor,
    NSFont,
    NSMakeRect,
    NSNoBorder,
    NSTextField,
    NSView,
)


STATUS_ITEM_WIDTH = 92.0
STATUS_ITEM_HEIGHT = 22.0
TILE_WIDTH = STATUS_ITEM_WIDTH / 2.0


def build_label(frame, font_size: float, weight: float = 0.0) -> NSTextField:
    label = NSTextField.alloc().initWithFrame_(frame)
    label.setBezeled_(False)
    label.setBordered_(False)
    label.setDrawsBackground_(False)
    label.setEditable_(False)
    label.setSelectable_(False)
    label.setAlignment_(NSCenterTextAlignment)
    if weight:
        label.setFont_(NSFont.systemFontOfSize_weight_(font_size, weight))
    else:
        label.setFont_(NSFont.systemFontOfSize_(font_size))
    label.setTextColor_(NSColor.labelColor())
    return label


class StatusBarView(NSView):
    def initWithFrame_(self, frame):
        self = super().initWithFrame_(frame)
        if self is None:
            return None

        self.cpu_value_label = build_label(NSMakeRect(0, 9, TILE_WIDTH, 11), 11.0, 0.4)
        self.cpu_name_label = build_label(NSMakeRect(0, 0, TILE_WIDTH, 9), 8.0)
        self.mem_value_label = build_label(NSMakeRect(TILE_WIDTH, 9, TILE_WIDTH, 11), 11.0, 0.4)
        self.mem_name_label = build_label(NSMakeRect(TILE_WIDTH, 0, TILE_WIDTH, 9), 8.0)

        self.cpu_name_label.setStringValue_("CPU")
        self.mem_name_label.setStringValue_("MEM")
        self.cpu_value_label.setStringValue_("--%")
        self.mem_value_label.setStringValue_("--%")

        self.addSubview_(self.cpu_value_label)
        self.addSubview_(self.cpu_name_label)
        self.addSubview_(self.mem_value_label)
        self.addSubview_(self.mem_name_label)
        return self

    def updateMetrics_cpu_memory_(self, cpu_text: str, mem_text: str) -> None:
        self.cpu_value_label.setStringValue_(cpu_text)
        self.mem_value_label.setStringValue_(mem_text)
```

- [ ] **Step 3: Run the UI construction check**

Run: `python3 -c "from app import StatusBarView, STATUS_ITEM_WIDTH, STATUS_ITEM_HEIGHT; print(StatusBarView.alloc().initWithFrame_(((0, 0), (STATUS_ITEM_WIDTH, STATUS_ITEM_HEIGHT))) is not None)"`
Expected: PASS with `True`

- [ ] **Step 4: Commit the custom view**

```bash
git add app.py
git commit -m "feat: add custom aligned status bar view"
```

### Task 4: Wire the NSStatusItem, timer refresh, and lifecycle

**Files:**
- Modify: `app.py`

- [ ] **Step 1: Add a failing app bootstrap check**

Run: `python3 -c "from app import StatusMonitorApp; print(StatusMonitorApp)" `
Expected: FAIL with `cannot import name 'StatusMonitorApp'`

- [ ] **Step 2: Add the status item controller**

```python
from Foundation import NSObject, NSTimer
from AppKit import NSStatusBar, NSVariableStatusItemLength


class StatusMonitorApp(NSObject):
    def init(self):
        self = super().init()
        if self is None:
            return None

        self.status_item = NSStatusBar.systemStatusBar().statusItemWithLength_(STATUS_ITEM_WIDTH)
        button = self.status_item.button()
        button.setTitle_("")
        self.status_view = StatusBarView.alloc().initWithFrame_(NSMakeRect(0, 0, STATUS_ITEM_WIDTH, STATUS_ITEM_HEIGHT))
        button.addSubview_(self.status_view)
        self.timer = None
        return self

    def start(self) -> None:
        self.refreshMetrics_(None)
        self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            2.0,
            self,
            "refreshMetrics:",
            None,
            True,
        )

    def refreshMetrics_(self, _timer) -> None:
        cpu_text, mem_text = read_metrics()
        self.status_view.updateMetrics_cpu_memory_(cpu_text, mem_text)
```

- [ ] **Step 3: Update the main entry point to launch the controller**

```python
def main() -> None:
    app = NSApplication.sharedApplication()
    delegate = StatusMonitorApp.alloc().init()
    delegate.start()
    app.run()
```

- [ ] **Step 4: Run the bootstrap syntax check**

Run: `python3 -m compileall app.py`
Expected: PASS with a `Compiling 'app.py'...` line

- [ ] **Step 5: Commit the status item lifecycle**

```bash
git add app.py
git commit -m "feat: wire menu bar status item refresh loop"
```

### Task 5: Tighten launch instructions and manual verification steps

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a failing documentation check**

Run: `rg "2 seconds|CPU|MEM|PyObjC" README.md`
Expected: FAIL because one or more lines are missing

- [ ] **Step 2: Expand the README with exact run and validation notes**

```markdown
# Mac Menu Bar Monitor

Python macOS status bar app that shows CPU and memory usage directly in the menu bar as two aligned vertical tiles.

## Requirements

- macOS
- Python 3
- PyObjC
- psutil

## Install

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Run

```bash
python3 app.py
```

## Behavior

- Refreshes every 2 seconds
- Shows CPU and MEM directly in the menu bar
- Uses a two-line layout with smaller `CPU` and `MEM` labels

## Manual verification

1. Launch the app with `python3 app.py`.
2. Confirm that the menu bar shows two aligned tiles.
3. Confirm that the top row shows percentages and the bottom row shows `CPU` and `MEM`.
4. Confirm that the labels are smaller than the percentages.
5. Confirm that values change every 2 seconds.
6. Confirm that the status item stays compact and does not visibly clip.
```

- [ ] **Step 3: Run the documentation check**

Run: `rg "2 seconds|CPU|MEM|PyObjC" README.md`
Expected: PASS with matching lines printed from `README.md`

- [ ] **Step 4: Commit the documentation updates**

```bash
git add README.md
git commit -m "docs: add usage and manual verification steps"
```

### Task 6: Verify the implementation end to end

**Files:**
- Test: `app.py`
- Test: `README.md`
- Test: `requirements.txt`

- [ ] **Step 1: Run the final syntax verification**

Run: `python3 -m compileall app.py`
Expected: PASS with a `Compiling 'app.py'...` line

- [ ] **Step 2: Run the metric helper smoke test**

Run: `python3 -c "from app import read_metrics; print(read_metrics())"`
Expected: PASS with a tuple containing two percentage strings

- [ ] **Step 3: Launch the app for manual verification**

Run: `python3 app.py`
Expected: App stays running and the macOS menu bar shows aligned CPU and MEM tiles that refresh every 2 seconds

- [ ] **Step 4: Commit the verified implementation**

```bash
git add app.py README.md requirements.txt
git commit -m "feat: add mac menu bar cpu and memory monitor"
```
