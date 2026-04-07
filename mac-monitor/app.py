from __future__ import annotations

from typing import Tuple

import objc
import psutil
from AppKit import (
    NSApp,
    NSApplication,
    NSApplicationActivationPolicyProhibited,
    NSCenterTextAlignment,
    NSColor,
    NSEventMaskLeftMouseUp,
    NSEventMaskRightMouseUp,
    NSEventTypeRightMouseUp,
    NSFont,
    NSMakeRect,
    NSMenu,
    NSMenuItem,
    NSStatusBar,
    NSTextField,
    NSView,
)
from Foundation import NSObject, NSTimer

STATUS_ITEM_WIDTH = 140.0
STATUS_ITEM_HEIGHT = 22.0
REFRESH_INTERVAL_SECONDS = 2.0
BOTTOM_LABEL_FONT_SIZE = 8.0
VALUE_FONT_SIZE = 11.0
NETWORK_FONT_SIZE = 9.0


def clamp_percentage(value: float) -> int:
    return max(0, min(100, int(round(value))))


def layout_columns(total_width: float) -> Tuple[float, float, float, float, float, float, float]:
    gap = 3.0
    cpu_width = 38.0
    mem_width = 38.0
    net_width = total_width - cpu_width - mem_width - (gap * 2.0)
    cpu_x = 0.0
    mem_x = cpu_x + cpu_width + gap
    net_x = mem_x + mem_width + gap
    return cpu_x, mem_x, net_x, cpu_width, mem_width, net_width, gap


def format_rate(bytes_per_second: float) -> str:
    if bytes_per_second < 1024:
        return f"{int(round(bytes_per_second))}B/s"
    if bytes_per_second < 1024 * 1024:
        return f"{int(round(bytes_per_second / 1024))}K/s"
    return f"{int(round(bytes_per_second / (1024 * 1024)))}M/s"


def read_metrics(
    previous_counters: Tuple[int, int],
    interval_seconds: float,
) -> Tuple[str, str, str, str, Tuple[int, int]]:
    try:
        cpu_text = f"{clamp_percentage(psutil.cpu_percent(interval=None))}%"
    except Exception:
        cpu_text = "--%"

    try:
        mem_text = f"{clamp_percentage(psutil.virtual_memory().percent)}%"
    except Exception:
        mem_text = "--%"

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

    return cpu_text, mem_text, upload_text, download_text, current_counters


def build_quit_menu(target: NSObject | None) -> NSMenu:
    menu = NSMenu.alloc().initWithTitle_("Status Monitor")
    quit_item = NSMenuItem.alloc().initWithTitle_action_keyEquivalent_("Quit", "quit:", "")
    if target is not None:
        quit_item.setTarget_(target)
    menu.addItem_(quit_item)
    return menu


def build_label(frame, font_size: float, weight: float = 0.0) -> NSTextField:
    label = NSTextField.alloc().initWithFrame_(frame)
    label.setBezeled_(False)
    label.setBordered_(False)
    label.setDrawsBackground_(False)
    label.setEditable_(False)
    label.setSelectable_(False)
    label.setAlignment_(NSCenterTextAlignment)
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

        cpu_x, mem_x, net_x, cpu_width, mem_width, net_width, _gap = layout_columns(frame.size.width)
        top_y = 9.0
        top_height = 11.0
        bottom_height = 9.0

        self.cpu_value_label = build_label(
            NSMakeRect(cpu_x, top_y, cpu_width, top_height),
            VALUE_FONT_SIZE,
        )
        self.mem_value_label = build_label(
            NSMakeRect(mem_x, top_y, mem_width, top_height),
            VALUE_FONT_SIZE,
        )
        self.net_up_label = build_label(
            NSMakeRect(net_x, top_y, net_width, top_height),
            NETWORK_FONT_SIZE,
        )
        self.cpu_name_label = build_label(
            NSMakeRect(cpu_x, 0.0, cpu_width, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.mem_name_label = build_label(
            NSMakeRect(mem_x, 0.0, mem_width, bottom_height),
            BOTTOM_LABEL_FONT_SIZE,
        )
        self.net_down_label = build_label(
            NSMakeRect(net_x, 0.0, net_width, bottom_height),
            NETWORK_FONT_SIZE,
        )

        self.cpu_name_label.setStringValue_("CPU")
        self.mem_name_label.setStringValue_("MEM")
        self.updateCpuText_memText_uploadText_downloadText_("--%", "--%", "▲ --", "▼ --")

        self.addSubview_(self.cpu_value_label)
        self.addSubview_(self.mem_value_label)
        self.addSubview_(self.net_up_label)
        self.addSubview_(self.cpu_name_label)
        self.addSubview_(self.mem_name_label)
        self.addSubview_(self.net_down_label)
        return self

    def updateCpuText_memText_uploadText_downloadText_(
        self,
        cpu_text: str,
        mem_text: str,
        upload_text: str,
        download_text: str,
    ) -> None:
        self.cpu_value_label.setStringValue_(cpu_text)
        self.mem_value_label.setStringValue_(mem_text)
        self.net_up_label.setStringValue_(upload_text)
        self.net_down_label.setStringValue_(download_text)


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

        button_bounds = self.status_button.bounds()
        self.status_view = StatusBarView.alloc().initWithFrame_(button_bounds)
        self.status_button.addSubview_(self.status_view)
        self.menu = build_quit_menu(self)
        self.timer = None

        psutil.cpu_percent(interval=None)
        try:
            counters = psutil.net_io_counters()
            self.last_net_counters = (counters.bytes_sent, counters.bytes_recv)
        except Exception:
            self.last_net_counters = (0, 0)
        return self

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
        cpu_text, mem_text, upload_text, download_text, self.last_net_counters = read_metrics(
            self.last_net_counters,
            REFRESH_INTERVAL_SECONDS,
        )
        self.status_view.updateCpuText_memText_uploadText_downloadText_(
            cpu_text,
            mem_text,
            upload_text,
            download_text,
        )

    def handleClick_(self, _sender) -> None:
        event = NSApp().currentEvent()
        if event is not None and event.type() == NSEventTypeRightMouseUp:
            self.status_item.popUpStatusItemMenu_(self.menu)

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
