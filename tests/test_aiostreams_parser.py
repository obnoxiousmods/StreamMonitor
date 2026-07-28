"""Regression tests for the AIOStreams (pino) log parser."""

import unittest

from routes.aiostreams import _parse_logs

# Real-shape journalctl short-iso + pino pretty lines.
SAMPLE = """\
2026-07-18T05:12:47-07:00 lucy corepack[1712]: [05:12:47.220] INFO: received request for manifest
2026-07-18T05:12:47-07:00 lucy corepack[1712]:     module: "server"
2026-07-18T05:12:47-07:00 lucy corepack[1712]: [05:12:47.984] INFO: Handling stream request for Torznab
2026-07-18T05:12:47-07:00 lucy corepack[1712]:     module: "torznab"
2026-07-18T05:12:47-07:00 lucy corepack[1712]:     requestType: "series"
2026-07-18T05:12:47-07:00 lucy corepack[1712]:     requestId: "tt21993130:2:3"
2026-07-18T05:12:48-07:00 lucy corepack[1712]: [05:12:48.139] INFO: Completed search for StremThru in 5.00ms
2026-07-18T05:12:48-07:00 lucy corepack[1712]:     module: "torznab"
2026-07-18T05:12:48-07:00 lucy corepack[1712]:     results: 42
2026-07-18T05:12:48-07:00 lucy corepack[1712]: [05:12:48.151] INFO: Applied basic filters in 145.00ms, removed 3 streams
2026-07-18T05:12:48-07:00 lucy corepack[1712]:     module: "filterer"
2026-07-18T05:12:52-07:00 lucy corepack[1712]: [05:12:52.987] WARN: addon fetch failed
2026-07-18T05:12:52-07:00 lucy corepack[1712]:     addon: "STorz TB | RD | AD"
2026-07-18T05:12:52-07:00 lucy corepack[1712]:     took: 5002
2026-07-18T05:12:53-07:00 lucy corepack[1712]: [05:12:53.001] ERROR: Error processing torrents for realdebrid:
2026-07-18T05:12:53-07:00 lucy corepack[1712]:     module: "debrid"
""".splitlines()


class AioStreamsParserTests(unittest.TestCase):
    def setUp(self):
        self.res = _parse_logs(SAMPLE)

    def test_contract_keys(self):
        for k in ("log_lines", "time_range", "summary", "addons", "errors",
                  "recent_requests", "pipeline", "http_requests"):
            self.assertIn(k, self.res)
        for k in ("total_requests", "avg_response_time_s", "avg_streams",
                  "fastest_s", "slowest_s", "total_addon_errors"):
            self.assertIn(k, self.res["summary"])

    def test_stream_request_grouped_by_request_id(self):
        self.assertEqual(self.res["summary"]["total_requests"], 1)
        req = self.res["recent_requests"][0]
        self.assertEqual(req["content_id"], "tt21993130:2:3")
        self.assertEqual(req["type"], "series")
        self.assertTrue(any(a["name"] == "Torznab" for a in req["addons"]))

    def test_completed_search_counts_streams_and_success(self):
        st = self.res["addons"]["StremThru"]
        self.assertEqual(st["successes"], 1)
        self.assertEqual(st["total_streams"], 42)
        self.assertIsNotNone(st["avg_time_s"])

    def test_addon_fetch_failed_tallied(self):
        self.assertIn("addon fetch failed: STorz TB | RD | AD", self.res["errors"])
        self.assertEqual(self.res["addons"]["STorz TB | RD | AD"]["failures"], 1)

    def test_error_lines_counted(self):
        self.assertTrue(any("Error processing torrents" in k for k in self.res["errors"]))
        self.assertGreaterEqual(self.res["summary"]["total_addon_errors"], 2)

    def test_pipeline_filter_stage(self):
        self.assertTrue(any(p["stage"] == "FILTERER" for p in self.res["pipeline"]))

    def test_time_range_has_full_date(self):
        self.assertTrue(self.res["time_range"]["start"].startswith("2026-07-18T05:12:47"))


if __name__ == "__main__":
    unittest.main()
