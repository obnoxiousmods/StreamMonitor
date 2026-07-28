from __future__ import annotations

import asyncio
import unittest
from unittest.mock import patch

import core.errors as errors


class ErrorScannerTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        errors.error_history.clear()
        errors._seen_keys.clear()
        errors._scan_lock = None
        errors.last_scan_ts = 0.0
        errors.last_scan_started_ts = 0.0
        errors.last_scan_finished_ts = 0.0
        errors.last_scan_duration_ms = None
        errors.last_scan_new_count = 0
        errors.last_scan_checked_units = 0
        errors.last_scan_failed_units = 0
        errors.last_scan_error = None
        errors.skipped_scan_count = 0
        errors.scan_count = 0

    async def test_scan_all_is_single_flight(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def slow_scan_unit(sid: str, unit: str, since: str) -> list[dict]:
            started.set()
            await release.wait()
            return [{"sid": sid, "unit": unit, "line": "ERROR first failure", "severity": "error", "ts": 1.0}]

        async def no_plex(since: float) -> list[dict]:
            return []

        with (
            patch.dict(errors.cfg.SERVICES, {"alpha": {"unit": "alpha.service"}}, clear=True),
            patch.object(errors, "_scan_unit", slow_scan_unit),
            patch.object(errors, "_scan_plex_files", no_plex),
        ):
            first = asyncio.create_task(errors.scan_all())
            await started.wait()
            second = await errors.scan_all()
            release.set()
            first_result = await first

        self.assertTrue(first_result["started"])
        self.assertTrue(second["skipped"])
        self.assertEqual(errors.skipped_scan_count, 1)
        self.assertEqual(errors.scan_count, 1)
        self.assertEqual(len(errors.error_history), 1)

    async def test_scan_all_reports_metrics(self):
        async def fake_scan_unit(sid: str, unit: str, since: str) -> list[dict]:
            return [{"sid": sid, "unit": unit, "line": "ERROR recurring failure", "severity": "error", "ts": 2.0}]

        async def no_plex(since: float) -> list[dict]:
            return []

        with (
            patch.dict(
                errors.cfg.SERVICES,
                {"alpha": {"unit": "alpha.service"}, "beta": {"unit": "beta.service"}},
                clear=True,
            ),
            patch.object(errors, "_scan_unit", fake_scan_unit),
            patch.object(errors, "_scan_plex_files", no_plex),
        ):
            result = await errors.scan_all()

        self.assertTrue(result["ok"])
        self.assertEqual(result["checked_units"], 2)
        self.assertEqual(result["failed_units"], 0)
        self.assertEqual(result["new"], 2)
        self.assertIsInstance(result["duration_ms"], int)
        self.assertEqual(result["status"]["checked_units"], 2)


if __name__ == "__main__":
    unittest.main()
