"""NVIDIA GPU telemetry collected from nvidia-smi.

The device summary, process memory table, compute-app query, and pmon engine
sample are separate nvidia-smi surfaces. Merge them by PID so the dashboard can
show active GPU work and memory without relying on one lossy query.
"""

from __future__ import annotations

import contextlib
import csv
import re
import subprocess
from io import StringIO
from pathlib import Path

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

_UNSET_VALUES = {"", "-", "N/A", "[N/A]", "[Not Supported]"}
_PMON_ENGINES = ("sm", "mem", "enc", "dec", "jpg", "ofa")
_PROCESS_RE = re.compile(
    r"^\|\s*(?P<gpu>\d+)\s+(?P<gi>\S+)\s+(?P<ci>\S+)\s+(?P<pid>\d+)\s+"
    r"(?P<type>\S+)\s+(?P<name>.*?)\s+(?P<memory>\d+)\s*MiB\s*\|$"
)

_GPU_FIELDS = [
    "index",
    "uuid",
    "name",
    "pci.bus_id",
    "driver_version",
    "vbios_version",
    "pstate",
    "display_active",
    "display_mode",
    "compute_mode",
    "accounting.mode",
    "mig.mode.current",
    "utilization.gpu",
    "utilization.memory",
    "utilization.encoder",
    "utilization.decoder",
    "memory.total",
    "memory.used",
    "memory.free",
    "memory.reserved",
    "temperature.gpu",
    "power.draw",
    "power.limit",
    "enforced.power.limit",
    "clocks.current.graphics",
    "clocks.current.sm",
    "clocks.current.memory",
    "clocks.current.video",
    "clocks.max.graphics",
    "clocks.max.memory",
    "fan.speed",
    "pcie.link.gen.current",
    "pcie.link.gen.max",
    "pcie.link.width.current",
    "pcie.link.width.max",
    "clocks_throttle_reasons.active",
    "encoder.stats.sessionCount",
    "encoder.stats.averageFps",
    "encoder.stats.averageLatency",
]


def _run_nvidia_smi(args: list[str], timeout: float = 4.0) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["nvidia-smi", *args],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except Exception:
        return None


def _csv_rows(output: str) -> list[list[str]]:
    return [
        [cell.strip() for cell in row]
        for row in csv.reader(StringIO(output))
        if any(cell.strip() for cell in row)
    ]


def _clean(value: object) -> str | None:
    text = str(value).strip() if value is not None else ""
    if text in _UNSET_VALUES:
        return None
    if text.startswith("[") and text.endswith("]"):
        return None
    return text


def _to_float(value: object) -> float | None:
    text = _clean(value)
    if text is None:
        return None
    text = (
        text.replace("MiB", "")
        .replace("W", "")
        .replace("%", "")
        .replace(",", "")
        .strip()
    )
    try:
        return float(text)
    except (TypeError, ValueError):
        return None


def _to_int(value: object) -> int | None:
    number = _to_float(value)
    if number is None:
        return None
    return round(number)


def _basename(value: object) -> str | None:
    text = _clean(value)
    if text is None:
        return None
    return Path(text).name or text


def _gpu_field(raw: dict[str, str], key: str) -> str | None:
    return _clean(raw.get(key))


def _collect_device(index: int) -> dict | None:
    result = _run_nvidia_smi(
        [f"--query-gpu={','.join(_GPU_FIELDS)}", "--format=csv,noheader,nounits"],
        timeout=4.0,
    )
    if not result or result.returncode != 0:
        return None

    for row in _csv_rows(result.stdout):
        if len(row) < len(_GPU_FIELDS):
            continue
        raw = dict(zip(_GPU_FIELDS, row, strict=False))
        if (_to_int(raw.get("index")) or 0) != index:
            continue

        gpu: dict = {
            "vendor": "NVIDIA",
            "index": index,
            "name": _gpu_field(raw, "name"),
            "uuid": _gpu_field(raw, "uuid"),
            "pci_bus_id": _gpu_field(raw, "pci.bus_id"),
            "driver_version": _gpu_field(raw, "driver_version"),
            "vbios_version": _gpu_field(raw, "vbios_version"),
            "pstate": _gpu_field(raw, "pstate"),
            "display_active": _gpu_field(raw, "display_active"),
            "display_mode": _gpu_field(raw, "display_mode"),
            "compute_mode": _gpu_field(raw, "compute_mode"),
            "accounting_mode": _gpu_field(raw, "accounting.mode"),
            "mig_mode_current": _gpu_field(raw, "mig.mode.current"),
            "throttle_reasons_active": _gpu_field(raw, "clocks_throttle_reasons.active"),
            "nvidia_smi": raw,
        }

        numeric_fields = {
            "usage_pct": "utilization.gpu",
            "mem_busy_pct": "utilization.memory",
            "query_encoder_util_pct": "utilization.encoder",
            "query_decoder_util_pct": "utilization.decoder",
            "vram_total_mb": "memory.total",
            "vram_used_mb": "memory.used",
            "vram_free_mb": "memory.free",
            "vram_reserved_mb": "memory.reserved",
            "temp_c": "temperature.gpu",
            "power_w": "power.draw",
            "power_limit_w": "power.limit",
            "power_enforced_limit_w": "enforced.power.limit",
            "core_mhz": "clocks.current.graphics",
            "sm_mhz": "clocks.current.sm",
            "mem_mhz": "clocks.current.memory",
            "video_mhz": "clocks.current.video",
            "max_core_mhz": "clocks.max.graphics",
            "max_mem_mhz": "clocks.max.memory",
            "fan_pct": "fan.speed",
            "pcie_gen_current": "pcie.link.gen.current",
            "pcie_gen_max": "pcie.link.gen.max",
            "pcie_width_current": "pcie.link.width.current",
            "pcie_width_max": "pcie.link.width.max",
            "encoder_sessions": "encoder.stats.sessionCount",
            "encoder_avg_fps": "encoder.stats.averageFps",
            "encoder_avg_latency_ms": "encoder.stats.averageLatency",
        }
        for output_key, raw_key in numeric_fields.items():
            value = _to_float(raw.get(raw_key))
            if value is None:
                continue
            gpu[output_key] = round(value, 1) if output_key.endswith("_w") else int(value)

        gpu["pcie"] = {
            "gen_current": gpu.get("pcie_gen_current"),
            "gen_max": gpu.get("pcie_gen_max"),
            "width_current": gpu.get("pcie_width_current"),
            "width_max": gpu.get("pcie_width_max"),
        }
        gpu["clocks"] = {
            "graphics_mhz": gpu.get("core_mhz"),
            "sm_mhz": gpu.get("sm_mhz"),
            "memory_mhz": gpu.get("mem_mhz"),
            "video_mhz": gpu.get("video_mhz"),
            "max_graphics_mhz": gpu.get("max_core_mhz"),
            "max_memory_mhz": gpu.get("max_mem_mhz"),
        }
        return gpu

    return None


def _collect_dmon(index: int) -> dict[str, int]:
    result = _run_nvidia_smi(["dmon", "-s", "u", "-c", "1", "-i", str(index)], timeout=2.0)
    if not result or result.returncode != 0:
        return {}

    samples: list[dict[str, int]] = []
    for line in result.stdout.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        gpu_index = _to_int(parts[0])
        if gpu_index != index:
            continue
        values = {
            "sm": _to_int(parts[1]),
            "mem": _to_int(parts[2]),
            "enc": _to_int(parts[3]),
            "dec": _to_int(parts[4]),
            "jpg": _to_int(parts[5]),
            "ofa": _to_int(parts[6]),
        }
        samples.append({key: value for key, value in values.items() if value is not None})
    return samples[-1] if samples else {}


def _collect_pmon(index: int) -> list[dict]:
    result = _run_nvidia_smi(["pmon", "-c", "1"], timeout=3.0)
    if not result or result.returncode != 0:
        return []

    rows: list[dict] = []
    for line in result.stdout.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        parts = stripped.split(maxsplit=9)
        if len(parts) < 10:
            continue
        gpu_index = _to_int(parts[0])
        pid = _to_int(parts[1])
        if gpu_index != index or pid is None:
            continue

        row = {
            "gpu_index": gpu_index,
            "pid": pid,
            "type": _clean(parts[2]),
            "command": _clean(parts[9]),
            "source": "pmon",
        }
        for engine, value in zip(_PMON_ENGINES, parts[3:9], strict=False):
            row[f"{engine}_pct"] = _to_int(value)
        rows.append(row)
    return rows


def _collect_process_table(index: int) -> list[dict]:
    result = _run_nvidia_smi([], timeout=4.0)
    if not result or result.returncode != 0:
        return []

    rows: list[dict] = []
    in_processes = False
    for line in result.stdout.splitlines():
        if line.startswith("| Processes:"):
            in_processes = True
            continue
        if not in_processes:
            continue
        match = _PROCESS_RE.match(line)
        if not match:
            continue
        gpu_index = _to_int(match.group("gpu"))
        pid = _to_int(match.group("pid"))
        if gpu_index != index or pid is None:
            continue
        rows.append(
            {
                "gpu_index": gpu_index,
                "gi_id": _clean(match.group("gi")),
                "ci_id": _clean(match.group("ci")),
                "pid": pid,
                "type": _clean(match.group("type")),
                "process_name": _clean(match.group("name")),
                "used_memory_mb": _to_int(match.group("memory")),
                "source": "process_table",
            }
        )
    return rows


def _collect_app_query(query_arg: str, source: str, device_uuid: str | None) -> list[dict]:
    result = _run_nvidia_smi([query_arg, "--format=csv,noheader,nounits"], timeout=3.0)
    if not result or result.returncode != 0:
        return []

    rows: list[dict] = []
    for row in _csv_rows(result.stdout):
        if len(row) < 4:
            continue
        pid = _to_int(row[0])
        gpu_uuid = _clean(row[2])
        if pid is None or (device_uuid and gpu_uuid and gpu_uuid != device_uuid):
            continue
        rows.append(
            {
                "pid": pid,
                "process_name": _clean(row[1]),
                "gpu_uuid": gpu_uuid,
                "used_memory_mb": _to_int(row[3]),
                "source": source,
            }
        )
    return rows


def _collect_accounted_apps(device_uuid: str | None) -> list[dict]:
    result = _run_nvidia_smi(
        [
            "--query-accounted-apps=pid,gpu_uuid,gpu_utilization,mem_utilization,max_memory_usage,time",
            "--format=csv,noheader,nounits",
        ],
        timeout=3.0,
    )
    if not result or result.returncode != 0:
        return []

    rows: list[dict] = []
    for row in _csv_rows(result.stdout):
        if len(row) < 6:
            continue
        pid = _to_int(row[0])
        gpu_uuid = _clean(row[1])
        if pid is None or (device_uuid and gpu_uuid and gpu_uuid != device_uuid):
            continue
        rows.append(
            {
                "pid": pid,
                "gpu_uuid": gpu_uuid,
                "gpu_util_pct": _to_int(row[2]),
                "mem_util_pct": _to_int(row[3]),
                "max_memory_mb": _to_int(row[4]),
                "time_ms": _to_int(row[5]),
            }
        )
    return rows


def _psutil_process(pid: int) -> dict:
    if not _HAS_PSUTIL:
        return {}

    try:
        proc = psutil.Process(pid)
    except Exception:
        return {}

    info: dict = {}
    with contextlib.suppress(Exception):
        info["name"] = proc.name()
    with contextlib.suppress(Exception):
        info["exe"] = proc.exe()
    with contextlib.suppress(Exception):
        cmdline = proc.cmdline()
        info["cmd"] = " ".join(cmdline) if cmdline else info.get("name")
    with contextlib.suppress(Exception):
        info["user"] = proc.username().split("\\")[-1]
    with contextlib.suppress(Exception):
        info["status"] = proc.status()
    with contextlib.suppress(Exception):
        info["cpu_pct"] = round(proc.cpu_percent(interval=None), 1)
    with contextlib.suppress(Exception):
        info["ram_mb"] = round(proc.memory_info().rss / 1024**2, 1)
    return info


def _merge_processes(
    index: int,
    device_uuid: str | None,
    vram_total_mb: int | None,
    process_rows: list[dict],
    app_rows: list[dict],
    pmon_rows: list[dict],
) -> list[dict]:
    merged: dict[int, dict] = {}

    def item_for(pid: int) -> dict:
        item = merged.setdefault(pid, {"pid": pid, "gpu_index": index, "sources": []})
        return item

    for row in [*process_rows, *app_rows, *pmon_rows]:
        pid = row.get("pid")
        if not isinstance(pid, int):
            continue
        item = item_for(pid)
        source = row.get("source")
        if source and source not in item["sources"]:
            item["sources"].append(source)
        for key, value in row.items():
            if key == "source" or value is None:
                continue
            if key in {"type", "process_name", "command", "gpu_uuid", "gi_id", "ci_id"}:
                item[key] = value
            elif key == "used_memory_mb":
                item[key] = max(int(value), int(item.get(key) or 0))
            elif key.endswith("_pct"):
                item[key] = value
            else:
                item.setdefault(key, value)

    for item in merged.values():
        item.setdefault("gpu_uuid", device_uuid)
        ps = _psutil_process(item["pid"])
        item.update({key: value for key, value in ps.items() if value not in (None, "")})
        item["name"] = _basename(item.get("name") or item.get("process_name") or item.get("command")) or "unknown"
        item.setdefault("process_name", item["name"])
        item["sources"] = sorted(item["sources"])
        if vram_total_mb and item.get("used_memory_mb") is not None:
            item["gpu_memory_pct"] = round((item["used_memory_mb"] / vram_total_mb) * 100, 1)

    return sorted(
        merged.values(),
        key=lambda proc: (
            -(proc.get("used_memory_mb") or 0),
            -(proc.get("enc_pct") or 0),
            proc.get("pid") or 0,
        ),
    )


def _aggregate_process_engines(processes: list[dict]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for proc in processes:
        for engine in _PMON_ENGINES:
            value = proc.get(f"{engine}_pct")
            if value is None:
                continue
            totals[engine] = min(100, totals.get(engine, 0) + int(value))
    return totals


def _build_engines(device: dict, dmon: dict[str, int], process_engines: dict[str, int]) -> dict[str, int]:
    engines: dict[str, int] = {}
    query_values = {
        "enc": device.get("query_encoder_util_pct"),
        "dec": device.get("query_decoder_util_pct"),
    }
    encoder_sessions = device.get("encoder_sessions") or 0

    for engine in ("enc", "dec", "jpg", "ofa"):
        candidates = [
            value
            for value in (process_engines.get(engine), dmon.get(engine), query_values.get(engine))
            if value is not None
        ]
        if not candidates:
            continue
        value = max(int(candidate) for candidate in candidates)
        if value > 0 or (engine == "enc" and encoder_sessions > 0):
            engines[engine] = value
    return engines


def collect_nvidia_gpu(index: int = 0) -> dict | None:
    """Return a full NVIDIA GPU snapshot for the requested GPU index."""
    device = _collect_device(index)
    if not device:
        return None

    device_uuid = device.get("uuid")
    vram_total_mb = device.get("vram_total_mb")
    process_rows = _collect_process_table(index)
    app_rows = [
        *_collect_app_query(
            "--query-compute-apps=pid,process_name,gpu_uuid,used_memory",
            "compute_apps",
            device_uuid,
        ),
        *_collect_app_query(
            "--query-gpu-apps=pid,process_name,gpu_uuid,used_memory",
            "graphics_apps",
            device_uuid,
        ),
    ]
    pmon_rows = _collect_pmon(index)
    processes = _merge_processes(index, device_uuid, vram_total_mb, process_rows, app_rows, pmon_rows)
    process_engines = _aggregate_process_engines(processes)
    dmon = _collect_dmon(index)
    engines = _build_engines(device, dmon, process_engines)

    device["processes"] = processes
    device["process_count"] = len(processes)
    device["process_memory_mb"] = sum(proc.get("used_memory_mb") or 0 for proc in processes)
    device["process_engine_totals"] = process_engines
    device["process_source"] = "nvidia-smi process table + compute-apps + pmon"
    device["dmon"] = dmon
    if engines:
        device["engines"] = engines
        device["engine_source"] = "nvidia-smi pmon/dmon"

    accounted = _collect_accounted_apps(device_uuid)
    if accounted:
        device["accounted_processes"] = accounted

    return device
