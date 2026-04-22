from __future__ import annotations

import plistlib
import shutil
import subprocess
from collections.abc import Mapping
from typing import Any, Tuple

import objc
import psutil
from AppKit import (
    NSApp,
    NSApplication,
    NSApplicationActivationPolicyProhibited,
    NSCenterTextAlignment,
    NSColor,
    NSControlStateValueOff,
    NSControlStateValueOn,
    NSEventMaskLeftMouseUp,
    NSEventMaskRightMouseUp,
    NSEventTypeRightMouseUp,
    NSFont,
    NSLeftTextAlignment,
    NSMakeRect,
    NSMenu,
    NSMenuItem,
    NSStatusBar,
    NSTextField,
    NSView,
)
from Foundation import NSObject, NSTimer, NSUserDefaults

STATUS_ITEM_HEIGHT = 22.0
REFRESH_INTERVAL_SECONDS = 2.0
BOTTOM_LABEL_FONT_SIZE = 8.0
VALUE_FONT_SIZE = 11.0
NETWORK_FONT_SIZE = 9.0
GAP_WIDTH = 2.0
STATUS_ITEM_MIN_WIDTH = 16.0
PREFERENCES_KEY = "enabledMetrics"
DEFAULTS_SUITE_NAME = "com.codex.mac-monitor"
SSD_USAGE_PATHS = ("/System/Volumes/Data", "/Users", "/")
METRIC_ORDER = ("cpu", "gpu", "mem", "ssd", "net")
METRIC_TITLES = {
    "cpu": "CPU",
    "gpu": "GPU",
    "mem": "MEM",
    "ssd": "SSD",
    "net": "NET",
}
METRIC_WIDTHS = {
    "cpu": 34.0,
    "gpu": 34.0,
    "mem": 34.0,
    "ssd": 34.0,
    "net": 36.0,
}
DEFAULT_ENABLED_METRICS = {
    "cpu": True,
    "gpu": False,
    "mem": True,
    "ssd": False,
    "net": True,
}
GPU_IOREG_COMMAND = ("/usr/sbin/ioreg", "-ar", "-d", "1", "-c", "IOAccelerator")
GPU_USAGE_KEYS = (
    "Device Utilization %",
    "GPU Activity(%)",
    "GPU Activity %",
    "GPU Usage %",
    "GPU Utilization %",
)


def clamp_percentage(value: float) -> int:
    return max(0, min(100, int(round(value))))


def frame_width_for_metric(metric_key: str) -> float:
    return METRIC_WIDTHS[metric_key]


def visible_metrics_in_order(enabled_metrics: dict[str, bool]) -> list[str]:
    return [metric_key for metric_key in METRIC_ORDER if enabled_metrics.get(metric_key, False)]


def normalize_enabled_metrics(raw_enabled_metrics: Any) -> dict[str, bool]:
    normalized_metrics = dict(DEFAULT_ENABLED_METRICS)
    if isinstance(raw_enabled_metrics, dict):
        source_metrics = raw_enabled_metrics
    elif isinstance(raw_enabled_metrics, Mapping):
        source_metrics = dict(raw_enabled_metrics)
    else:
        return normalized_metrics

    for metric_key in METRIC_ORDER:
        if metric_key in source_metrics:
            normalized_metrics[metric_key] = bool(source_metrics[metric_key])

    if not any(normalized_metrics.values()):
        normalized_metrics["cpu"] = True

    return normalized_metrics


def toggle_metric_selection(enabled_metrics: dict[str, bool], metric_key: str) -> tuple[dict[str, bool], bool]:
    if metric_key not in enabled_metrics:
        return enabled_metrics, False

    if enabled_metrics[metric_key]:
        enabled_count = sum(1 for key in METRIC_ORDER if enabled_metrics.get(key, False))
        if enabled_count <= 1:
            return enabled_metrics, False

    updated_metrics = dict(enabled_metrics)
    updated_metrics[metric_key] = not enabled_metrics[metric_key]
    return updated_metrics, True


def preferences_defaults() -> NSUserDefaults:
    defaults = NSUserDefaults.alloc().initWithSuiteName_(DEFAULTS_SUITE_NAME)
    if defaults is None:
        return NSUserDefaults.standardUserDefaults()
    return defaults


def calculate_status_item_width(visible_metrics: list[str]) -> float:
    if not visible_metrics:
        return STATUS_ITEM_MIN_WIDTH

    total_width = sum(frame_width_for_metric(metric_key) for metric_key in visible_metrics)
    total_width += GAP_WIDTH * (len(visible_metrics) - 1)
    return total_width


STATUS_ITEM_WIDTH = calculate_status_item_width(list(METRIC_ORDER))


def layout_columns(total_width: float, visible_metrics: Tuple[str, ...] | list[str]) -> dict[str, dict[str, float]]:
    columns: dict[str, dict[str, float]] = {}
    current_x = 0.0

    for index, metric_key in enumerate(visible_metrics):
        width = frame_width_for_metric(metric_key)
        columns[metric_key] = {"x": current_x, "width": width}
        current_x += width
        if index < len(visible_metrics) - 1:
            current_x += GAP_WIDTH

    if visible_metrics and "net" in columns:
        columns["net"]["width"] = max(0.0, total_width - columns["net"]["x"])

    return columns


def format_rate(bytes_per_second: float) -> str:
    if bytes_per_second < 1024:
        return f"{int(round(bytes_per_second))}B"
    if bytes_per_second < 1024 * 1024:
        return f"{int(round(bytes_per_second / 1024))}K"
    return f"{int(round(bytes_per_second / (1024 * 1024)))}M"


def parse_percentage_value(value: Any) -> int | None:
    if isinstance(value, (int, float)):
        return clamp_percentage(value)

    if isinstance(value, str):
        cleaned = value.strip().rstrip("%").strip()
        if not cleaned:
            return None
        try:
            return clamp_percentage(float(cleaned))
        except ValueError:
            return None

    return None


def extract_gpu_percentage(node: Any) -> int | None:
    if isinstance(node, dict):
        performance_statistics = node.get("PerformanceStatistics")
        if isinstance(performance_statistics, dict):
            for key in GPU_USAGE_KEYS:
                parsed_value = parse_percentage_value(performance_statistics.get(key))
                if parsed_value is not None:
                    return parsed_value

        for value in node.values():
            parsed_value = extract_gpu_percentage(value)
            if parsed_value is not None:
                return parsed_value

    if isinstance(node, list):
        for item in node:
            parsed_value = extract_gpu_percentage(item)
            if parsed_value is not None:
                return parsed_value

    return None


def read_gpu_percentage() -> str:
    if shutil.which("ioreg") is None:
        return "--%"

    try:
        result = subprocess.run(
            GPU_IOREG_COMMAND,
            capture_output=True,
            check=True,
            text=False,
            timeout=1.0,
        )
        utilization = extract_gpu_percentage(plistlib.loads(result.stdout))
    except Exception:
        return "--%"

    if utilization is None:
        return "--%"

    return f"{utilization}%"


def read_ssd_percentage_from_paths(
    candidate_paths: Tuple[str, ...] | list[str],
    usage_reader,
) -> str:
    sorted_paths = sorted(
        candidate_paths,
        key=lambda path: SSD_USAGE_PATHS.index(path) if path in SSD_USAGE_PATHS else len(SSD_USAGE_PATHS),
    )

    for path in sorted_paths:
        try:
            return f"{clamp_percentage(usage_reader(path))}%"
        except Exception:
            continue

    return "--%"


def read_ssd_percentage() -> str:
    return read_ssd_percentage_from_paths(
        SSD_USAGE_PATHS,
        lambda path: psutil.disk_usage(path).percent,
    )


def read_metrics(
    previous_counters: Tuple[int, int],
    interval_seconds: float,
) -> Tuple[str, str, str, str, str, str, Tuple[int, int]]:
    try:
        cpu_text = f"{clamp_percentage(psutil.cpu_percent(interval=None))}%"
    except Exception:
        cpu_text = "--%"

    gpu_text = read_gpu_percentage()

    try:
        mem_text = f"{clamp_percentage(psutil.virtual_memory().percent)}%"
    except Exception:
        mem_text = "--%"

    ssd_text = read_ssd_percentage()

    try:
        counters = psutil.net_io_counters()
        current_counters = (counters.bytes_sent, counters.bytes_recv)
        sent_delta = max(0, current_counters[0] - previous_counters[0])
        recv_delta = max(0, current_counters[1] - previous_counters[1])
        upload_text = f"▲ {format_rate(sent_delta / interval_seconds)}"
        download_text = f"▼ {format_rate(recv_delta / interval_seconds)}"
    except Exception:
        current_counters = previous_counters
        upload_text = "▲ --"
        download_text = "▼ --"

    return cpu_text, gpu_text, mem_text, ssd_text, upload_text, download_text, current_counters


def build_label(frame, font_size: float, weight: float = 0.0, alignment: int = NSCenterTextAlignment) -> NSTextField:
    label = NSTextField.alloc().initWithFrame_(frame)
    label.setBezeled_(False)
    label.setBordered_(False)
    label.setDrawsBackground_(False)
    label.setEditable_(False)
    label.setSelectable_(False)
    label.setAlignment_(alignment)
    label.setTextColor_(NSColor.labelColor())
    if weight:
        label.setFont_(NSFont.systemFontOfSize_weight_(font_size, weight))
    else:
        label.setFont_(NSFont.systemFontOfSize_(font_size))
    return label


class StatusBarView(NSView):
    def initWithFrame_(self, frame):
        self = objc.super(StatusBarView, self).initWithFrame_(frame)
        if self is None:
            return None

        top_y = 9.0
        top_height = 11.0
        bottom_height = 9.0

        self.cpu_value_label = build_label(
            NSMakeRect(0.0, top_y, 0.0, top_height),
            VALUE_FONT_SIZE,
        )
        self.gpu_value_label = build_label(
            NSMakeRect(0.0, top_y, 0.0, top_height),
            VALUE_FONT_SIZE,
        )
        self.mem_value_label = build_label(
            NSMakeRect(0.0, top_y, 0.0, top_height),
            VALUE_FONT_SIZE,
        )
        self.ssd_value_label = build_label(
            NSMakeRect(0.0, top_y, 0.0, top_height),
            VALUE_FONT_SIZE,
        )
        self.net_up_label = build_label(
            NSMakeRect(0.0, top_y, 0.0, top_height),
            NETWORK_FONT_SIZE,
            alignment=NSLeftTextAlignment,
        )
        self.cpu_name_label = build_label(
            NSMakeRect(0.0, 0.0, 0.0, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.gpu_name_label = build_label(
            NSMakeRect(0.0, 0.0, 0.0, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.mem_name_label = build_label(
            NSMakeRect(0.0, 0.0, 0.0, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.ssd_name_label = build_label(
            NSMakeRect(0.0, 0.0, 0.0, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.net_down_label = build_label(
            NSMakeRect(0.0, 0.0, 0.0, bottom_height),
            NETWORK_FONT_SIZE,
            alignment=NSLeftTextAlignment,
        )

        self.metric_views = {
            "cpu": (self.cpu_value_label, self.cpu_name_label),
            "gpu": (self.gpu_value_label, self.gpu_name_label),
            "mem": (self.mem_value_label, self.mem_name_label),
            "ssd": (self.ssd_value_label, self.ssd_name_label),
            "net": (self.net_up_label, self.net_down_label),
        }
        self.cpu_name_label.setStringValue_(METRIC_TITLES["cpu"])
        self.gpu_name_label.setStringValue_(METRIC_TITLES["gpu"])
        self.mem_name_label.setStringValue_(METRIC_TITLES["mem"])
        self.ssd_name_label.setStringValue_(METRIC_TITLES["ssd"])
        self.updateCpuText_gpuText_memText_ssdText_uploadText_downloadText_("--%", "--%", "--%", "--%", "▲ --", "▼ --")

        self.addSubview_(self.cpu_value_label)
        self.addSubview_(self.gpu_value_label)
        self.addSubview_(self.mem_value_label)
        self.addSubview_(self.ssd_value_label)
        self.addSubview_(self.net_up_label)
        self.addSubview_(self.cpu_name_label)
        self.addSubview_(self.gpu_name_label)
        self.addSubview_(self.mem_name_label)
        self.addSubview_(self.ssd_name_label)
        self.addSubview_(self.net_down_label)
        self.applyLayoutWithFrame_enabledMetrics_(frame, DEFAULT_ENABLED_METRICS)
        return self

    def updateCpuText_gpuText_memText_ssdText_uploadText_downloadText_(
        self,
        cpu_text: str,
        gpu_text: str,
        mem_text: str,
        ssd_text: str,
        upload_text: str,
        download_text: str,
    ) -> None:
        self.cpu_value_label.setStringValue_(cpu_text)
        self.gpu_value_label.setStringValue_(gpu_text)
        self.mem_value_label.setStringValue_(mem_text)
        self.ssd_value_label.setStringValue_(ssd_text)
        self.net_up_label.setStringValue_(upload_text)
        self.net_down_label.setStringValue_(download_text)

    def applyLayoutWithFrame_enabledMetrics_(self, frame, enabled_metrics: dict[str, bool]) -> None:
        self.setFrame_(frame)
        visible_metrics = visible_metrics_in_order(enabled_metrics)
        columns = layout_columns(frame.size.width, visible_metrics)
        top_y = 9.0
        top_height = 11.0
        bottom_height = 9.0

        for metric_key in METRIC_ORDER:
            views = self.metric_views[metric_key]
            if metric_key not in columns:
                for view in views:
                    view.setHidden_(True)
                continue

            x = columns[metric_key]["x"]
            width = columns[metric_key]["width"]
            if metric_key == "net":
                views[0].setFrame_(NSMakeRect(x, top_y, width, top_height))
                views[1].setFrame_(NSMakeRect(x, 0.0, width, bottom_height))
            else:
                views[0].setFrame_(NSMakeRect(x, top_y, width, top_height))
                views[1].setFrame_(NSMakeRect(x, 0.0, width, bottom_height))

            for view in views:
                view.setHidden_(False)


class StatusMonitorApp(NSObject):
    def init(self):
        self = objc.super(StatusMonitorApp, self).init()
        if self is None:
            return None

        self.status_item = NSStatusBar.systemStatusBar().statusItemWithLength_(STATUS_ITEM_WIDTH)
        self.status_button = self.status_item.button()
        self.status_button.setTitle_("")
        self.status_button.setTarget_(self)
        self.status_button.setAction_("handleClick:")
        self.status_button.sendActionOn_(NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp)
        self.enabled_metrics = self.loadEnabledMetrics()
        self.latest_texts = {
            "cpu": "--%",
            "gpu": "--%",
            "mem": "--%",
            "ssd": "--%",
            "upload": "▲ --",
            "download": "▼ --",
        }

        button_bounds = self.status_button.bounds()
        self.status_view = StatusBarView.alloc().initWithFrame_(button_bounds)
        self.status_button.addSubview_(self.status_view)
        self.menu = self.buildMenu()
        self.timer = None

        psutil.cpu_percent(interval=None)
        try:
            counters = psutil.net_io_counters()
            self.last_net_counters = (counters.bytes_sent, counters.bytes_recv)
        except Exception:
            self.last_net_counters = (0, 0)
        self.applyMetricVisibility()
        return self

    def buildMenu(self) -> NSMenu:
        menu = NSMenu.alloc().initWithTitle_("Status Monitor")
        self.metric_menu_items = {}

        for metric_key in METRIC_ORDER:
            item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_(
                METRIC_TITLES[metric_key],
                "toggleMetric:",
                "",
            )
            item.setTarget_(self)
            item.setRepresentedObject_(metric_key)
            menu.addItem_(item)
            self.metric_menu_items[metric_key] = item

        menu.addItem_(NSMenuItem.separatorItem())
        quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Quit", "quit:", "")
        quit_item.setTarget_(self)
        menu.addItem_(quit_item)
        self.updateMenuItemStates()
        return menu

    def updateMenuItemStates(self) -> None:
        for metric_key, item in self.metric_menu_items.items():
            item.setState_(NSControlStateValueOn if self.enabled_metrics.get(metric_key, False) else NSControlStateValueOff)

    def applyMetricVisibility(self) -> None:
        visible_metrics = visible_metrics_in_order(self.enabled_metrics)
        self.status_item.setLength_(calculate_status_item_width(visible_metrics))
        button_bounds = self.status_button.bounds()
        self.status_view.applyLayoutWithFrame_enabledMetrics_(button_bounds, self.enabled_metrics)
        self.status_view.updateCpuText_gpuText_memText_ssdText_uploadText_downloadText_(
            self.latest_texts["cpu"],
            self.latest_texts["gpu"],
            self.latest_texts["mem"],
            self.latest_texts["ssd"],
            self.latest_texts["upload"],
            self.latest_texts["download"],
        )

    def loadEnabledMetrics(self) -> dict[str, bool]:
        defaults = preferences_defaults()
        stored_metrics = defaults.dictionaryForKey_(PREFERENCES_KEY)
        return normalize_enabled_metrics(stored_metrics)

    def saveEnabledMetrics(self) -> None:
        defaults = preferences_defaults()
        metrics_to_store = {metric_key: bool(self.enabled_metrics.get(metric_key, False)) for metric_key in METRIC_ORDER}
        defaults.setObject_forKey_(metrics_to_store, PREFERENCES_KEY)
        defaults.synchronize()

    def start(self) -> None:
        self.refreshMetrics_(None)
        self.timer = NSTimer.scheduledTimerWithTimeInterval_target_selector_userInfo_repeats_(
            REFRESH_INTERVAL_SECONDS,
            self,
            "refreshMetrics:",
            None,
            True,
        )

    def refreshMetrics_(self, _timer) -> None:
        cpu_text, gpu_text, mem_text, ssd_text, upload_text, download_text, self.last_net_counters = read_metrics(
            self.last_net_counters,
            REFRESH_INTERVAL_SECONDS,
        )
        self.latest_texts = {
            "cpu": cpu_text,
            "gpu": gpu_text,
            "mem": mem_text,
            "ssd": ssd_text,
            "upload": upload_text,
            "download": download_text,
        }
        self.applyMetricVisibility()

    def handleClick_(self, _sender) -> None:
        event = NSApp().currentEvent()
        if event is not None and event.type() == NSEventTypeRightMouseUp:
            self.status_item.popUpStatusItemMenu_(self.menu)

    def toggleMetric_(self, sender) -> None:
        metric_key = str(sender.representedObject())
        updated_metrics, changed = toggle_metric_selection(self.enabled_metrics, metric_key)
        if not changed:
            self.updateMenuItemStates()
            return

        self.enabled_metrics = updated_metrics
        self.saveEnabledMetrics()
        self.updateMenuItemStates()
        self.applyMetricVisibility()

    def quit_(self, _sender) -> None:
        NSApp().terminate_(None)


def main() -> None:
    app = NSApplication.sharedApplication()
    app.setActivationPolicy_(NSApplicationActivationPolicyProhibited)
    delegate = StatusMonitorApp.alloc().init()
    NSApp().setDelegate_(delegate)
    delegate.start()
    app.run()


if __name__ == "__main__":
    main()
