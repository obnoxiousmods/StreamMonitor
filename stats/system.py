"""System stats collector (CPU, RAM, GPU, disk, network IO, OS)."""

from __future__ import annotations

import asyncio
import contextlib
import os
import platform
import re
import time
from pathlib import Path

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

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
            swap = psutil.swap_memory()
            if swap.total > 0:
                result["swap"] = {
                    "total_gb": round(swap.total / 1024**3, 1),
                    "used_gb": round(swap.used / 1024**3, 1),
                    "percent": swap.percent,
                }
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

    # ── AMD GPU via sysfs ──
    try:
        base = "/sys/class/drm/card1/device"
        hwmon = "/sys/class/drm/card1/device/hwmon/hwmon1"
        gpu: dict = {}

        gpu["name"] = "AMD Radeon RX 580"

        # gpu_busy_percent only tracks 3D/compute, not video encode/decode.
        # Supplement with fdinfo-based per-engine utilization.
        sysfs_busy = _sysfs(f"{base}/gpu_busy_percent")
        fdinfo_usage = _get_gpu_fdinfo_usage()
        if fdinfo_usage:
            # Use the max of any engine as the headline usage
            gpu["usage_pct"] = max(fdinfo_usage.values(), default=0)
            gpu["engines"] = fdinfo_usage
        elif sysfs_busy is not None:
            gpu["usage_pct"] = int(sysfs_busy)

        if (v := _sysfs(f"{base}/mem_busy_percent")) is not None:
            gpu["mem_busy_pct"] = int(v)

        if (vt := _sysfs(f"{base}/mem_info_vram_total")) and (vu := _sysfs(f"{base}/mem_info_vram_used")):
            gpu["vram_total_mb"] = round(int(vt) / 1024**2)
            gpu["vram_used_mb"] = round(int(vu) / 1024**2)

        if v := _sysfs(f"{hwmon}/temp1_input"):
            gpu["temp_c"] = round(int(v) / 1000)

        if v := _sysfs(f"{hwmon}/power1_input"):
            gpu["power_w"] = round(int(v) / 1_000_000)

        if v := _sysfs(f"{hwmon}/fan1_input"):
            gpu["fan_rpm"] = int(v)

        if v := _sysfs(f"{hwmon}/freq1_input"):
            gpu["core_mhz"] = round(int(v) / 1_000_000)

        if v := _sysfs(f"{hwmon}/freq2_input"):
            gpu["mem_mhz"] = round(int(v) / 1_000_000)

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

    return result


async def collect_system() -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, _collect_system_sync)
