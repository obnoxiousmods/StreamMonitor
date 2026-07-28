from __future__ import annotations

import asyncio
import json
import unittest
from collections import deque
from unittest.mock import patch

import routes.public as public


class PublicApiTests(unittest.TestCase):
    def test_public_summary_includes_categories_availability_and_recent_history(self):
        fake_services = {
            "alpha": {"name": "Alpha", "category": "streaming"},
            "beta": {"name": "Beta", "category": "automation"},
        }
        fake_categories = {"streaming": "Streaming", "automation": "Automation"}
        fake_cur = {
            "alpha": {
                "name": "Alpha",
                "ok": True,
                "latency_ms": 42,
                "category": "streaming",
                "timestamp": "2026-04-21T19:00:40Z",
            },
            "beta": {
                "name": "Beta",
                "ok": False,
                "latency_ms": 310,
                "category": "automation",
                "timestamp": "2026-04-21T19:00:50Z",
            },
        }
        fake_hist = {
            "alpha": deque(
                [
                    {"ok": True},
                    {"ok": True},
                    {"ok": False},
                    {"ok": True},
                ],
                maxlen=120,
            ),
            "beta": deque(
                [
                    {"ok": False},
                    {"ok": False},
                ],
                maxlen=120,
            ),
        }

        with (
            patch.dict(public.cfg.SERVICES, fake_services, clear=True),
            patch.dict(public.cfg.CATEGORIES, fake_categories, clear=True),
            patch.object(public._health, "cur", fake_cur),
            patch.object(public._health, "hist", fake_hist),
            patch.object(public._health, "HISTORY_LEN", 120),
            patch.object(public._health, "CHECK_INTERVAL", 15),
        ):
            response = asyncio.run(public.api_public(None))

        payload = json.loads(response.body.decode())

        self.assertEqual(payload["total"], 2)
        self.assertEqual(payload["up"], 1)
        self.assertEqual(payload["down"], 1)
        self.assertEqual(payload["updated_at"], "2026-04-21T19:00:50Z")
        self.assertEqual(payload["window_minutes"], 30.0)
        self.assertEqual(payload["availability_pct"], 50.0)

        self.assertEqual(payload["services"]["alpha"]["history"], [True, True, False, True])
        self.assertEqual(payload["services"]["alpha"]["availability_pct"], 75.0)
        self.assertEqual(payload["services"]["beta"]["availability_pct"], 0.0)
        self.assertEqual(payload["categories"]["streaming"]["availability_pct"], 75.0)
        self.assertEqual(payload["categories"]["automation"]["availability_pct"], 0.0)
        self.assertEqual(payload["categories"]["streaming"]["services"], ["alpha"])
        self.assertEqual(payload["categories"]["automation"]["services"], ["beta"])


if __name__ == "__main__":
    unittest.main()
