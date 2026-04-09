# App Icon Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a formal app icon matching the approved CPU/MEM + network-line concept and ship it inside the packaged macOS `.app`.

**Architecture:** Store the approved PNG icon source inside the workspace, render a macOS `.iconset` from that PNG, convert it into `.icns`, and keep the PyInstaller bundle pointed at the generated icon. Rebuild the app bundle and verify the icon resource is embedded in the final `.app`.

**Tech Stack:** PNG asset, macOS `sips`, macOS `iconutil`, PyInstaller

---

### Task 1: Create icon source and generated `.icns`

**Files:**
- Create: `assets/app-icon-source.png`
- Create: `assets/app-icon.iconset/*`
- Create: `assets/app-icon.icns`

### Task 2: Wire the bundle icon into packaging

**Files:**
- Modify: `menubar_monitor.spec`
- Modify: `README.md`

### Task 3: Rebuild and verify the packaged app

**Files:**
- Test: `dist/Mac Menu Bar Monitor.app`
