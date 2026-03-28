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

# Seed baseline at import so the first collection can compute rates immediately
if _HAS_PSUTIL:
    import psutil as _p

    with contextlib.suppress(Exception):
        _prev_disk_io = _p.disk_io_counters()
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

        # ── Disk I/O rates ──
        try:
            dio = psutil.disk_io_counters()
            if dio and _prev_disk_io is not None and _prev_io_time > 0:
                dt = now - _prev_io_time
                # Require at least 2 seconds between samples to avoid
                # division-by-tiny-dt spikes (normal interval is ~60 s).
                if dt >= 2.0:
                    delta_read = dio.read_bytes - _prev_disk_io.read_bytes
                    delta_write = dio.write_bytes - _prev_disk_io.write_bytes
                    rb = max(0.0, delta_read / dt)
                    wb = max(0.0, delta_write / dt)
                    result["disk_io"] = {
                        "read_rate": _fmt_rate(rb),
                        "write_rate": _fmt_rate(wb),
                        "read_bytes_s": round(rb),
                        "write_bytes_s": round(wb),
                        "read_total_gb": round(dio.read_bytes / 1024**3, 2),
                        "write_total_gb": round(dio.write_bytes / 1024**3, 2),
                    }
                    _prev_disk_io = dio
                # If dt < 2 s, keep the old prev values for next iteration
            else:
                # First sample: seed prev without emitting a rate
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

        if (v := _sysfs(f"{base}/gpu_busy_percent")) is not None:
            gpu["usage_pct"] = int(v)

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
