"""System stats collector (CPU, RAM, GPU, disk, network IO, OS)."""

from __future__ import annotations

import asyncio
import contextlib
import os
import platform
import re
import subprocess
import time
from pathlib import Path

from stats.gpu_nvidia import collect_nvidia_gpu
from stats.process_metrics import collect_process_lists

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

# ── Package count cache (5-minute TTL, read-only counts — fast) ──────────────
_pkg_cache: dict = {}
_pkg_cache_ts: float = 0.0
_PKG_TTL = 300  # 5 minutes


def _get_pkg_counts() -> dict:
    """Return cached native/AUR package counts.  Refreshes every 5 minutes."""
    global _pkg_cache, _pkg_cache_ts
    now = time.time()
    if _pkg_cache and now - _pkg_cache_ts < _PKG_TTL:
        return _pkg_cache
    try:
        native = subprocess.run(
            ["pacman", "-Qn"], capture_output=True, text=True, timeout=10
        )
        aur = subprocess.run(
            ["pacman", "-Qm"], capture_output=True, text=True, timeout=10
        )
        _pkg_cache = {
            "native_total": len([line for line in native.stdout.splitlines() if line.strip()]),
            "aur_total": len([line for line in aur.stdout.splitlines() if line.strip()]),
        }
        _pkg_cache_ts = now
    except Exception:
        pass
    return _pkg_cache

# ── Rate tracking (previous sample values) ───────────────────────────────────
_prev_disk_io: object = None
_prev_net_io: object = None
_prev_io_time: float = 0.0

# GPU fdinfo tracking — delta-based engine utilization
_prev_gpu_engines: dict[str, int] = {}  # engine_name -> total_ns
_prev_gpu_time: float = 0.0


def _get_gpu_fdinfo_usage() -> dict[str, int]:
    """Read GPU engine utilization from /proc/*/fdinfo/* (drm-engine-* fields).

    Returns dict of engine_name -> usage_percent (0-100) based on ns delta
    since last call. Returns empty dict on first call or error.
    """
    global _prev_gpu_engines, _prev_gpu_time

    now = time.time()
    engine_totals: dict[str, int] = {}

    try:
        proc = Path("/proc")
        for pid_dir in proc.iterdir():
            if not pid_dir.name.isdigit():
                continue
            fdinfo_dir = pid_dir / "fdinfo"
            if not fdinfo_dir.is_dir():
                continue
            try:
                for fd_file in fdinfo_dir.iterdir():
                    try:
                        content = fd_file.read_text()
                        if "drm-engine-" not in content:
                            continue
                        for line in content.splitlines():
                            if line.startswith("drm-engine-"):
                                parts = line.split(":\t")
                                if len(parts) == 2:
                                    engine = parts[0].removeprefix("drm-engine-")
                                    ns_str = parts[1].strip().removesuffix(" ns")
                                    engine_totals[engine] = engine_totals.get(engine, 0) + int(ns_str)
                    except (PermissionError, OSError, ValueError):
                        continue
            except (PermissionError, OSError):
                continue
    except Exception:
        return {}

    if not engine_totals:
        return {}

    dt = now - _prev_gpu_time if _prev_gpu_time > 0 else 0
    result: dict[str, int] = {}

    if dt >= 2.0 and _prev_gpu_engines:
        dt_ns = dt * 1_000_000_000
        for engine, total_ns in engine_totals.items():
            prev_ns = _prev_gpu_engines.get(engine, 0)
            delta = total_ns - prev_ns
            if delta >= 0:
                pct = min(round(delta / dt_ns * 100), 100)
                if pct > 0:
                    result[engine] = pct

    _prev_gpu_engines = engine_totals
    _prev_gpu_time = now
    return result

# Seed baseline at import so the first collection can compute rates immediately
if _HAS_PSUTIL:
    import psutil as _p

    with contextlib.suppress(Exception):
        _pd = _p.disk_io_counters(perdisk=True)
        _PART_SEED = re.compile(r"(sd[a-z]+|nvme\d+n\d+)$")
        _wd = {k: v for k, v in _pd.items() if _PART_SEED.match(k)}
        if _wd:
            _prev_disk_io = type(
                "DIO",
                (),
                {
                    "read_bytes": sum(v.read_bytes for v in _wd.values()),
                    "write_bytes": sum(v.write_bytes for v in _wd.values()),
                },
            )()
    try:
        _VIRT_INIT = re.compile(r"^(lo|docker|veth|br-|virbr|tun|tap)")
        _nic_init = _p.net_io_counters(pernic=True)
        _phys_init = [(n, c) for n, c in _nic_init.items() if not _VIRT_INIT.match(n)]
        if _phys_init:
            _rb = sum(c.bytes_recv for _, c in _phys_init)
            _sb = sum(c.bytes_sent for _, c in _phys_init)
            _prev_net_io = type("N", (), {"bytes_recv": _rb, "bytes_sent": _sb})()
    except Exception:
        pass
    _prev_io_time = time.time()


def _sysfs(path: str) -> str | None:
    try:
        return Path(path).read_text().strip()
    except Exception:
        return None


def _fmt_rate(bps: float) -> str:
    """Return human-readable rate string (B/s, KB/s, MB/s, GB/s)."""
    if bps < 1024:
        return f"{bps:.0f} B/s"
    if bps < 1024**2:
        return f"{bps / 1024:.1f} KB/s"
    if bps < 1024**3:
        return f"{bps / 1024**2:.1f} MB/s"
    return f"{bps / 1024**3:.2f} GB/s"


def _gib(value: int | float) -> float:
    return round(value / 1024**3, 1)


def _collect_swap() -> dict | None:
    """Read swap directly from kernel meminfo.

    SwapCached is still allocated in swap, but the page is also resident in RAM.
    Exposing both allocated and active swap makes the dashboard match the
    different conventions used by tools like free, htop, and btop.
    """
    try:
        meminfo: dict[str, int] = {}
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, raw = line.split(":", 1)
            parts = raw.strip().split()
            if parts and parts[0].isdigit():
                meminfo[key] = int(parts[0]) * 1024

        total = meminfo.get("SwapTotal", 0)
        if total <= 0:
            return None

        free = meminfo.get("SwapFree", 0)
        cached = meminfo.get("SwapCached", 0)
        used = max(0, total - free)
        active = max(0, used - cached)

        return {
            "total_gb": _gib(total),
            "used_gb": _gib(used),
            "active_gb": _gib(active),
            "cached_gb": _gib(cached),
            "free_gb": _gib(free),
            "percent": round((used / total) * 100, 1),
            "active_percent": round((active / total) * 100, 1),
        }
    except Exception:
        return None


def _nvidia_float(value: str) -> float | None:
    value = value.strip()
    if not value or value in {"-", "N/A", "[Not Supported]"}:
        return None
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _collect_nvidia_dmon_util(index: int = 0) -> dict[str, int]:
    """Sample NVIDIA engine busy percentages from dmon."""
    try:
        r = subprocess.run(
            ["nvidia-smi", "dmon", "-s", "u", "-c", "2", "-i", str(index)],
            capture_output=True,
            text=True,
            timeout=4,
        )
        if r.returncode != 0:
            return {}

        samples: list[dict[str, int]] = []
        for line in r.stdout.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) < 7:
                continue
            try:
                gpu_index = int(parts[0])
            except ValueError:
                continue
            if gpu_index != index:
                continue

            values = {
                "enc": _nvidia_float(parts[3]),
                "dec": _nvidia_float(parts[4]),
                "jpg": _nvidia_float(parts[5]),
                "ofa": _nvidia_float(parts[6]),
            }
            samples.append({key: int(value) for key, value in values.items() if value is not None})

        return samples[-1] if samples else {}
    except Exception:
        return {}


def _collect_gpu_nvidia() -> dict | None:
    """Collect NVIDIA GPU stats via the full nvidia-smi parser."""
    return collect_nvidia_gpu()


def _collect_gpu_amd(card_path: str) -> dict | None:
    """Collect AMD GPU stats via sysfs."""
    base = f"{card_path}/device"
    # Find hwmon sub-directory
    hwmon = ""
    for hw in Path(f"{base}/hwmon").glob("hwmon*"):
        hwmon = str(hw)
        break

    gpu: dict = {}

    # Human-readable GPU name: try multiple sysfs paths
    for name_path in [
        f"{card_path}/device/product_name",
        f"{base}/label",
    ]:
        if (v := _sysfs(name_path)) is not None and v.strip():
            gpu["name"] = v.strip()
            break
    if not gpu.get("name"):
        try:
            uevent = Path(f"{base}/uevent").read_text()
            for line in uevent.splitlines():
                if line.startswith("PCI_ID="):
                    gpu["name"] = f"AMD GPU ({line.split('=', 1)[1].strip()})"
                    break
        except Exception:
            pass
    if not gpu.get("name"):
        gpu["name"] = "AMD GPU"

    # Prefer fdinfo-based engine usage, fall back to sysfs gpu_busy_percent
    fdinfo_usage = _get_gpu_fdinfo_usage()
    if fdinfo_usage:
        gpu["usage_pct"] = max(fdinfo_usage.values(), default=0)
        gpu["engines"] = fdinfo_usage
    elif (v := _sysfs(f"{base}/gpu_busy_percent")) is not None:
        gpu["usage_pct"] = int(v)

    if (v := _sysfs(f"{base}/mem_busy_percent")) is not None:
        gpu["mem_busy_pct"] = int(v)
    if (vt := _sysfs(f"{base}/mem_info_vram_total")) and (vu := _sysfs(f"{base}/mem_info_vram_used")):
        gpu["vram_total_mb"] = round(int(vt) / 1024**2)
        gpu["vram_used_mb"]  = round(int(vu) / 1024**2)
    if hwmon:
        if (v := _sysfs(f"{hwmon}/temp1_input")):
            gpu["temp_c"] = round(int(v) / 1000)
        if (v := _sysfs(f"{hwmon}/power1_input")):
            gpu["power_w"] = round(int(v) / 1_000_000)
        if (v := _sysfs(f"{hwmon}/fan1_input")):
            gpu["fan_rpm"] = int(v)
        if (v := _sysfs(f"{hwmon}/freq1_input")):
            gpu["core_mhz"] = round(int(v) / 1_000_000)
        if (v := _sysfs(f"{hwmon}/freq2_input")):
            gpu["mem_mhz"] = round(int(v) / 1_000_000)
    return gpu or None


def _collect_gpu_intel(card_path: str) -> dict | None:
    """Collect Intel Arc/UHD GPU stats via sysfs + fdinfo."""
    base = f"{card_path}/device"
    gpu: dict = {}

    # Try to get a real device name from modalias/uevent
    try:
        uevent = Path(f"{base}/uevent").read_text()
        for line in uevent.splitlines():
            if line.startswith("PCI_ID="):
                pci_id = line.split("=", 1)[1].strip()
                gpu["name"] = f"Intel GPU ({pci_id})"
                break
    except Exception:
        pass
    if not gpu.get("name"):
        gpu["name"] = "Intel GPU"

    # GT frequency — xe driver: card/gt/gt0/freq0/cur_freq or rps_cur_freq_mhz
    #                i915 driver: card/gt_cur_freq_mhz
    for freq_path in [
        f"{card_path}/gt/gt0/freq0/cur_freq",
        f"{card_path}/gt/gt0/rps_cur_freq_mhz",
        f"{card_path}/gt_cur_freq_mhz",
    ]:
        if (v := _sysfs(freq_path)) is not None:
            try:
                gpu["core_mhz"] = int(v)
                break
            except ValueError:
                pass

    # Max freq for reference
    for max_path in [
        f"{card_path}/gt/gt0/freq0/max_freq",
        f"{card_path}/gt/gt0/rps_max_freq_mhz",
        f"{card_path}/gt_max_freq_mhz",
    ]:
        if (v := _sysfs(max_path)) is not None:
            try:
                gpu["core_max_mhz"] = int(v)
                break
            except ValueError:
                pass

    # VRAM (xe driver exposes memory region info)
    for _vram_path in [
        f"{base}/drm/renderD128/memory_info",
        f"{card_path}/gt/gt0/lmem0/io_start",
    ]:
        pass  # placeholder — xe VRAM not reliably available via simple sysfs reads

    # hwmon: temp + power (i915/xe both expose these)
    for hw in Path(f"{base}/hwmon").glob("hwmon*"):
        if (v := _sysfs(f"{hw}/temp1_input")):
            with contextlib.suppress(ValueError):
                gpu["temp_c"] = round(int(v) / 1000)
        if (v := _sysfs(f"{hw}/power1_input")):
            with contextlib.suppress(ValueError):
                gpu["power_w"] = round(int(v) / 1_000_000)
        break

    # Per-engine utilization via fdinfo (drm-engine-* — works for xe/i915 kernel 6.2+)
    fdinfo = _get_gpu_fdinfo_usage()
    if fdinfo:
        # Map Intel engine names to friendly labels
        intel_engines = {}
        for eng, pct in fdinfo.items():
            # Intel engines: "render", "copy", "video", "video enhance", "compute"
            intel_engines[eng] = pct
        if intel_engines:
            gpu["engines"] = intel_engines
            gpu["usage_pct"] = max(intel_engines.values())

    return gpu if len(gpu) > 1 else None


def _collect_system_sync() -> dict:
    global _prev_disk_io, _prev_net_io, _prev_io_time
    result: dict = {}

    # ── OS ──
    try:
        result["os_name"] = platform.system()
        result["os_release"] = platform.release()
        osr = Path("/etc/os-release")
        if osr.exists() and (m := re.search(r'^PRETTY_NAME="([^"]+)"', osr.read_text(), re.MULTILINE)):
            result["os_distro"] = m.group(1)
    except Exception:
        pass

    if _HAS_PSUTIL:
        now = time.time()

        # ── CPU ──
        try:
            cpu: dict = {
                "physical_cores": psutil.cpu_count(logical=False) or 0,
                "logical_cores": psutil.cpu_count(logical=True) or 0,
                "usage_pct": psutil.cpu_percent(interval=0.5),
            }
            freq = psutil.cpu_freq()
            if freq:
                cpu["freq_mhz"] = round(freq.current)
                cpu["freq_max_mhz"] = round(freq.max)
            try:
                txt = Path("/proc/cpuinfo").read_text()
                if m := re.search(r"model name\s*:\s*(.+)", txt):
                    cpu["model"] = m.group(1).strip()
            except Exception:
                pass
            try:
                ld = os.getloadavg()
                cpu["load_1m"] = round(ld[0], 2)
                cpu["load_5m"] = round(ld[1], 2)
                cpu["load_15m"] = round(ld[2], 2)
            except Exception:
                pass
            result["cpu"] = cpu
        except Exception:
            pass

        # ── RAM ──
        try:
            mem = psutil.virtual_memory()
            result["ram"] = {
                "total_gb": round(mem.total / 1024**3, 1),
                "used_gb": round(mem.used / 1024**3, 1),
                "available_gb": round(mem.available / 1024**3, 1),
                "percent": mem.percent,
            }
        except Exception:
            pass

        # ── Swap ──
        try:
            swap_info = _collect_swap()
            if swap_info is None:
                swap = psutil.swap_memory()
                if swap.total > 0:
                    swap_info = {
                        "total_gb": _gib(swap.total),
                        "used_gb": _gib(swap.used),
                        "active_gb": _gib(swap.used),
                        "cached_gb": 0,
                        "free_gb": _gib(swap.free),
                        "percent": swap.percent,
                        "active_percent": swap.percent,
                    }
            if swap_info:
                result["swap"] = swap_info
        except Exception:
            pass

        # ── Disk partitions ──
        try:
            skip_fs = {
                "tmpfs",
                "devtmpfs",
                "squashfs",
                "overlay",
                "aufs",
                "proc",
                "sysfs",
                "cgroup",
                "devpts",
                "debugfs",
                "efivarfs",
            }
            drives, seen = [], set()
            for part in psutil.disk_partitions(all=False):
                if part.device in seen or part.fstype in skip_fs:
                    continue
                seen.add(part.device)
                try:
                    u = psutil.disk_usage(part.mountpoint)
                    total_tb = u.total / 1024**4
                    drives.append(
                        {
                            "mount": part.mountpoint,
                            "device": part.device,
                            "total": round(total_tb if total_tb >= 0.1 else u.total / 1024**3, 2),
                            "free": round((u.free / 1024**4) if total_tb >= 0.1 else (u.free / 1024**3), 2),
                            "unit": "TB" if total_tb >= 0.1 else "GB",
                            "percent": u.percent,
                        }
                    )
                except (PermissionError, OSError):
                    pass
            if drives:
                result["disks"] = drives
        except Exception:
            pass

        # ── Disk I/O rates (whole disks only, skip partitions to avoid double-counting) ──
        try:
            per_disk = psutil.disk_io_counters(perdisk=True)
            # Filter to whole-disk devices only (e.g. sda, nvme0n1 — not sda1, nvme0n1p2)
            _PART_RE = re.compile(r"(sd[a-z]+|nvme\d+n\d+)$")
            whole = {k: v for k, v in per_disk.items() if _PART_RE.match(k)}
            if whole:
                total_read = sum(v.read_bytes for v in whole.values())
                total_write = sum(v.write_bytes for v in whole.values())
                dio = type("DIO", (), {"read_bytes": total_read, "write_bytes": total_write})()
                if _prev_disk_io is not None and _prev_io_time > 0:
                    dt = now - _prev_io_time
                    if dt >= 2.0:
                        rb = max(0.0, (dio.read_bytes - _prev_disk_io.read_bytes) / dt)
                        wb = max(0.0, (dio.write_bytes - _prev_disk_io.write_bytes) / dt)
                        result["disk_io"] = {
                            "read_rate": _fmt_rate(rb),
                            "write_rate": _fmt_rate(wb),
                            "read_bytes_s": round(rb),
                            "write_bytes_s": round(wb),
                            "read_total_gb": round(dio.read_bytes / 1024**3, 2),
                            "write_total_gb": round(dio.write_bytes / 1024**3, 2),
                        }
                        _prev_disk_io = dio
                else:
                    _prev_disk_io = dio
        except Exception:
            pass

        # ── Network I/O rates (physical NIC only, exclude docker/veth/lo) ──
        try:
            _VIRT_PAT = re.compile(r"^(lo|docker|veth|br-|virbr|tun|tap)")
            per_nic = psutil.net_io_counters(pernic=True)
            nic_stats = psutil.net_if_stats()
            phys = [(n, c) for n, c in per_nic.items() if not _VIRT_PAT.match(n)]
            if phys:
                recv_b = sum(c.bytes_recv for _, c in phys)
                sent_b = sum(c.bytes_sent for _, c in phys)
                net_io_now = type("N", (), {"bytes_recv": recv_b, "bytes_sent": sent_b})()

                # Link speed: max speed of active physical NICs
                speeds = [nic_stats[n].speed for n, _ in phys if n in nic_stats and nic_stats[n].speed > 0]
                link_mbps = max(speeds) if speeds else 0

                if _prev_net_io and _prev_io_time:
                    dt = now - _prev_io_time
                    if dt > 0:
                        r_rate = max(0, (recv_b - _prev_net_io.bytes_recv) / dt)
                        s_rate = max(0, (sent_b - _prev_net_io.bytes_sent) / dt)
                        link_bps = link_mbps * 125_000  # Mbps → bytes/s
                        result["net_io"] = {
                            "recv_rate": _fmt_rate(r_rate),
                            "sent_rate": _fmt_rate(s_rate),
                            "link_rate": _fmt_rate(link_bps) if link_bps else "",
                            "recv_bytes_s": round(r_rate),
                            "sent_bytes_s": round(s_rate),
                            "recv_total_gb": round(recv_b / 1024**3, 2),
                            "sent_total_gb": round(sent_b / 1024**3, 2),
                            "recv_pct": round(r_rate / link_bps * 100, 1) if link_bps else 0,
                            "sent_pct": round(s_rate / link_bps * 100, 1) if link_bps else 0,
                        }
                _prev_net_io = net_io_now
        except Exception:
            pass

        _prev_io_time = now

        # ── Processes & uptime ──
        with contextlib.suppress(Exception):
            result["process_count"] = len(psutil.pids())
        try:
            uptime_sec = time.time() - psutil.boot_time()
            d = int(uptime_sec // 86400)
            h = int((uptime_sec % 86400) // 3600)
            mn = int((uptime_sec % 3600) // 60)
            result["uptime"] = f"{d}d {h}h {mn}m" if d else f"{h}h {mn}m"
        except Exception:
            pass

        # ── Top processes by CPU and RAM ──
        try:
            proc_lists = collect_process_lists(cpu_limit=10, memory_limit=10, process_limit=30)
            if proc_lists["top_cpu"]:
                result["top_processes"] = proc_lists["top_cpu"]
            if proc_lists["top_memory"]:
                result["top_memory_processes"] = proc_lists["top_memory"]
        except Exception:
            pass

    # ── GPU auto-detection (NVIDIA / AMD / Intel Arc) ──────────────────────
    try:
        gpu: dict | None = None

        # Detect GPU vendor by scanning /sys/class/drm/card* device vendor IDs
        for card_path in sorted(Path("/sys/class/drm").glob("card[0-9]*")):
            if "-" in card_path.name:
                continue  # skip cardN-* (connector entries)
            vendor_file = card_path / "device" / "vendor"
            if not vendor_file.exists():
                continue
            vendor_id = vendor_file.read_text().strip().lower()

            if vendor_id == "0x10de":  # NVIDIA
                gpu = _collect_gpu_nvidia()
                if gpu:
                    break

            elif vendor_id == "0x1002":  # AMD
                gpu = _collect_gpu_amd(str(card_path))
                if gpu:
                    break

            elif vendor_id == "0x8086":  # Intel Arc
                gpu = _collect_gpu_intel(str(card_path))
                if gpu:
                    break

        if gpu:
            result["gpu"] = gpu
    except Exception:
        pass

    # ── CPU temperatures via hwmon (direct sysfs) ──
    try:
        hwmon_base = Path("/sys/class/hwmon")
        if hwmon_base.is_dir():
            for hwmon_dir in hwmon_base.iterdir():
                name_file = hwmon_dir / "name"
                if name_file.exists():
                    driver = name_file.read_text().strip()
                    if driver in ("coretemp", "k10temp", "zenpower"):
                        cores: list[int] = []
                        for i in range(1, 32):
                            temp_file = hwmon_dir / f"temp{i}_input"
                            if temp_file.exists():
                                with contextlib.suppress(ValueError, OSError):
                                    cores.append(int(temp_file.read_text().strip()) // 1000)
                        if cores:
                            result["temps"] = {
                                "cpu": round(sum(cores) / len(cores)),
                                "cores": cores,
                            }
                        break
    except Exception:
        pass

    # ── Temperatures & fans (psutil) ──
    if _HAS_PSUTIL:
        try:
            psu_temps = psutil.sensors_temperatures()
            fans = psutil.sensors_fans()
            sensors: dict = {}

            if "coretemp" in psu_temps:
                pkg = next((e for e in psu_temps["coretemp"] if "Package" in e.label), None)
                if pkg:
                    tc = pkg.current
                    sensors["cpu_package"] = {
                        "temp": round(tc, 1),
                        "high": round(pkg.high) if pkg.high else None,
                        "crit": round(pkg.critical) if pkg.critical else None,
                    }
                cores_psutil = [e.current for e in psu_temps["coretemp"] if "Core" in e.label]
                if cores_psutil:
                    sensors["cpu_cores"] = {
                        "min": round(min(cores_psutil), 1),
                        "max": round(max(cores_psutil), 1),
                        "avg": round(sum(cores_psutil) / len(cores_psutil), 1),
                        "count": len(cores_psutil),
                    }

            if "nvme" in psu_temps:
                nvme_e = next((e for e in psu_temps["nvme"] if 0 < e.current < 105), None)
                if nvme_e:
                    sensors["nvme"] = {
                        "temp": round(nvme_e.current, 1),
                        "high": round(nvme_e.high) if nvme_e.high else None,
                        "crit": round(nvme_e.critical) if nvme_e.critical else None,
                    }

            if "nct6793" in psu_temps:
                for e in psu_temps["nct6793"]:
                    if e.label == "AUXTIN0" and 5 < e.current < 60:
                        sensors["ambient"] = {"temp": round(e.current, 1)}

            fan_list = []
            for source, entries in fans.items():
                for fan in entries:
                    if fan.current > 0:
                        fan_list.append({"source": source, "rpm": int(fan.current)})
            if fan_list:
                sensors["fans"] = fan_list

            if sensors:
                result["sensors"] = sensors
        except Exception:
            pass

    # ── Packages ──────────────────────────────────────────────────────────────
    try:
        counts = _get_pkg_counts()
        if counts:
            pkg: dict = {
                "native_total": counts.get("native_total", 0),
                "aur_total":    counts.get("aur_total", 0),
            }
            # Pull outdated counts from the packages route cache if available
            try:
                from routes.packages import _cache as _pkg_update_cache
                if _pkg_update_cache:
                    pkg["outdated_native"] = _pkg_update_cache.get("native", {}).get("outdated", 0)
                    pkg["outdated_aur"]    = _pkg_update_cache.get("aur",    {}).get("outdated", 0)
            except Exception:
                pass
            result["packages"] = pkg
    except Exception:
        pass

    return result


async def collect_system() -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, _collect_system_sync)
