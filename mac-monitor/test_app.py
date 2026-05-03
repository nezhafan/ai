import unittest
from collections import UserDict
from types import SimpleNamespace

from app import (
    DEFAULTS_SUITE_NAME,
    DEFAULT_ENABLED_METRICS,
    GAP_WIDTH,
    aggregate_network_counters,
    METRIC_ORDER,
    PREFERENCES_KEY,
    STATUS_ITEM_MIN_WIDTH,
    STATUS_ITEM_WIDTH,
    calculate_status_item_width,
    extract_gpu_percentage,
    frame_width_for_metric,
    format_rate,
    layout_columns,
    normalize_enabled_metrics,
    parse_percentage_value,
    read_metrics,
    read_ssd_percentage_from_paths,
    toggle_metric_selection,
    visible_metrics_in_order,
)


class GpuParsingTests(unittest.TestCase):
    def test_parse_percentage_value_accepts_numbers_and_strings(self):
        self.assertEqual(parse_percentage_value(22), 22)
        self.assertEqual(parse_percentage_value(22.4), 22)
        self.assertEqual(parse_percentage_value("37"), 37)
        self.assertEqual(parse_percentage_value("37%"), 37)

    def test_extract_gpu_percentage_prefers_performance_statistics(self):
        sample = [
            {
                "PerformanceStatistics": {
                    "Device Utilization %": 42,
                    "Renderer Utilization %": 11,
                }
            }
        ]

        self.assertEqual(extract_gpu_percentage(sample), 42)

    def test_extract_gpu_percentage_falls_back_to_other_known_keys(self):
        sample = [
            {
                "PerformanceStatistics": {
                    "GPU Activity(%)": "58",
                }
            }
        ]

        self.assertEqual(extract_gpu_percentage(sample), 58)

    def test_extract_gpu_percentage_searches_nested_structures(self):
        sample = [
            {
                "SomeWrapper": {
                    "Children": [
                        {"PerformanceStatistics": {"GPU Activity %": "73%"}},
                    ]
                }
            }
        ]

        self.assertEqual(extract_gpu_percentage(sample), 73)

    def test_extract_gpu_percentage_returns_none_when_missing(self):
        self.assertIsNone(extract_gpu_percentage([{"PerformanceStatistics": {}}]))


class DiskAndNetworkFormattingTests(unittest.TestCase):
    def test_aggregate_network_counters_ignores_loopback_and_tunnel_interfaces(self):
        pernic_counters = {
            "lo0": SimpleNamespace(bytes_sent=5_000_000, bytes_recv=5_000_000),
            "utun0": SimpleNamespace(bytes_sent=3_000_000, bytes_recv=3_000_000),
            "en0": SimpleNamespace(bytes_sent=120_000, bytes_recv=8_400_000),
        }

        self.assertEqual(aggregate_network_counters(pernic_counters), (120_000, 8_400_000))

    def test_read_metrics_uses_filtered_network_counters(self):
        current_counters = (240_000, 16_800_000)

        cpu_text, gpu_text, mem_text, ssd_text, upload_text, download_text, returned_counters = read_metrics(
            previous_counters=(120_000, 8_400_000),
            interval_seconds=2.0,
            network_counters_reader=lambda: current_counters,
            cpu_reader=lambda: 10.0,
            gpu_reader=lambda: "15%",
            memory_reader=lambda: 20.0,
            ssd_reader=lambda: "30%",
        )

        self.assertEqual((cpu_text, gpu_text, mem_text, ssd_text), ("10%", "15%", "20%", "30%"))
        self.assertEqual(upload_text, "▲ 60K")
        self.assertEqual(download_text, "▼ 4.2M")
        self.assertEqual(returned_counters, current_counters)

    def test_read_ssd_percentage_prefers_data_volume_over_root(self):
        usage_by_path = {
            "/": 7.0,
            "/System/Volumes/Data": 67.0,
        }

        self.assertEqual(
            read_ssd_percentage_from_paths(
                ["/", "/System/Volumes/Data"],
                lambda path: usage_by_path[path],
            ),
            "67%",
        )

    def test_read_ssd_percentage_falls_back_when_preferred_path_is_missing(self):
        def fake_reader(path):
            if path == "/System/Volumes/Data":
                raise FileNotFoundError(path)
            return 42.0

        self.assertEqual(
            read_ssd_percentage_from_paths(
                ["/System/Volumes/Data", "/"],
                fake_reader,
            ),
            "42%",
        )

    def test_format_rate_omits_per_second_suffix(self):
        self.assertEqual(format_rate(512), "512B")
        self.assertEqual(format_rate(2048), "2K")
        self.assertEqual(format_rate(12 * 1024 * 1024), "12M")

    def test_format_rate_promotes_1000k_to_1m(self):
        self.assertEqual(format_rate(1_024_000), "1.0M")

    def test_format_rate_keeps_three_digit_kilobytes(self):
        self.assertEqual(format_rate(190_000), "190K")
        self.assertEqual(format_rate(999_999), "999K")

    def test_format_rate_keeps_one_decimal_between_one_and_ten_megabytes(self):
        self.assertEqual(format_rate(4_200_000), "4.2M")
        self.assertEqual(format_rate(9_990_000), "9.9M")

    def test_format_rate_keeps_three_digit_megabytes(self):
        self.assertEqual(format_rate(117_000_000), "117M")


class VisibilityTests(unittest.TestCase):
    def test_normalize_enabled_metrics_uses_defaults_for_missing_or_invalid_values(self):
        self.assertEqual(normalize_enabled_metrics(None), DEFAULT_ENABLED_METRICS)
        self.assertEqual(
            normalize_enabled_metrics({"gpu": True}),
            {
                "cpu": True,
                "gpu": True,
                "mem": True,
                "ssd": False,
                "net": True,
            },
        )
        self.assertEqual(
            normalize_enabled_metrics(
                {
                    "cpu": False,
                    "gpu": False,
                    "mem": False,
                    "ssd": False,
                    "net": False,
                }
            )["cpu"],
            True,
        )

    def test_normalize_enabled_metrics_accepts_mapping_like_values(self):
        objc_like_dict = UserDict({"cpu": False, "gpu": True, "mem": False, "ssd": True, "net": True})
        self.assertEqual(
            normalize_enabled_metrics(objc_like_dict),
            {"cpu": False, "gpu": True, "mem": False, "ssd": True, "net": True},
        )

    def test_preferences_key_is_stable(self):
        self.assertEqual(PREFERENCES_KEY, "enabledMetrics")

    def test_preferences_suite_name_is_stable(self):
        self.assertEqual(DEFAULTS_SUITE_NAME, "com.codex.mac-monitor")

    def test_default_enabled_metrics_leave_gpu_hidden(self):
        self.assertEqual(
            visible_metrics_in_order(DEFAULT_ENABLED_METRICS),
            ["cpu", "mem", "net"],
        )

    def test_visible_metrics_follow_fixed_order(self):
        enabled_metrics = {
            "cpu": False,
            "gpu": True,
            "mem": False,
            "net": True,
        }

        self.assertEqual(visible_metrics_in_order(enabled_metrics), ["gpu", "net"])

    def test_toggle_metric_selection_blocks_disabling_last_enabled_metric(self):
        updated_metrics, changed = toggle_metric_selection(
            {
                "cpu": True,
                "gpu": False,
                "mem": False,
                "ssd": False,
                "net": False,
            },
            "cpu",
        )

        self.assertFalse(changed)
        self.assertTrue(updated_metrics["cpu"])

    def test_toggle_metric_selection_allows_disabling_when_more_than_one_enabled(self):
        updated_metrics, changed = toggle_metric_selection(
            {
                "cpu": True,
                "gpu": False,
                "mem": True,
                "ssd": False,
                "net": False,
            },
            "cpu",
        )

        self.assertTrue(changed)
        self.assertFalse(updated_metrics["cpu"])

    def test_toggle_metric_selection_allows_enabling(self):
        updated_metrics, changed = toggle_metric_selection(DEFAULT_ENABLED_METRICS, "gpu")

        self.assertTrue(changed)
        self.assertTrue(updated_metrics["gpu"])


class LayoutTests(unittest.TestCase):
    def test_first_metric_shifts_left_to_reduce_status_item_padding(self):
        columns = layout_columns(
            calculate_status_item_width(["cpu", "mem", "net"]),
            ["cpu", "mem", "net"],
        )

        self.assertEqual(columns["cpu"]["x"], -2.0)

    def test_net_metric_adds_extra_left_margin(self):
        columns = layout_columns(
            calculate_status_item_width(["cpu", "mem", "net"]),
            ["cpu", "mem", "net"],
        )

        self.assertEqual(
            columns["net"]["x"],
            -2.0 + frame_width_for_metric("cpu") + frame_width_for_metric("mem") + (GAP_WIDTH * 2.0) + 3.0,
        )

    def test_net_metric_reserves_enough_width_for_rate_text(self):
        self.assertGreaterEqual(frame_width_for_metric("net"), 34.0)

    def test_layout_columns_fit_full_status_width(self):
        columns = layout_columns(STATUS_ITEM_WIDTH, METRIC_ORDER)

        self.assertEqual(columns["cpu"]["x"], -2.0)
        self.assertEqual(columns["gpu"]["x"], -2.0 + frame_width_for_metric("cpu") + GAP_WIDTH)
        self.assertEqual(
            columns["mem"]["x"],
            -2.0 + frame_width_for_metric("cpu") + frame_width_for_metric("gpu") + (GAP_WIDTH * 2.0),
        )
        self.assertEqual(
            columns["ssd"]["x"],
            -2.0 + frame_width_for_metric("cpu")
            + frame_width_for_metric("gpu")
            + frame_width_for_metric("mem")
            + (GAP_WIDTH * 3.0),
        )
        self.assertAlmostEqual(
            columns["net"]["x"] + columns["net"]["width"],
            STATUS_ITEM_WIDTH,
        )

    def test_layout_columns_collapse_hidden_metrics_without_gaps(self):
        columns = layout_columns(
            calculate_status_item_width(["cpu", "mem", "net"]),
            ["cpu", "mem", "net"],
        )

        self.assertEqual(columns["cpu"]["x"], -2.0)
        self.assertEqual(columns["mem"]["x"], -2.0 + frame_width_for_metric("cpu") + GAP_WIDTH)
        self.assertEqual(
            columns["net"]["x"],
            -2.0 + frame_width_for_metric("cpu") + frame_width_for_metric("mem") + (GAP_WIDTH * 2.0) + 3.0,
        )

    def test_calculate_status_item_width_has_minimum_for_empty_selection(self):
        self.assertEqual(calculate_status_item_width([]), STATUS_ITEM_MIN_WIDTH)

    def test_default_width_reflects_narrower_gap(self):
        self.assertEqual(calculate_status_item_width(["cpu", "mem", "net"]), 101.0)


if __name__ == "__main__":
    unittest.main()
