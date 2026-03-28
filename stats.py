"""API statistics collectors for StreamMonitor."""
from __future__ import annotations

import asyncio
import os
import platform
import re
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

STATS_INTERVAL   = 60   # seconds between stats refreshes
GITHUB_INTERVAL  = 21600  # 6 hours between GitHub version checks

# ── API keys (env overrides defaults from ~/.apikeys) ─────────────────────────
_PROWLARR_KEY    = os.environ.get("PROWLARR_API_KEY",    "")
_RADARR_KEY      = os.environ.get("RADARR_API_KEY",      "")
_SONARR_KEY      = os.environ.get("SONARR_API_KEY",      "")
_LIDARR_KEY      = os.environ.get("LIDARR_API_KEY",      "")
_JACKETT_KEY     = os.environ.get("JACKETT_API_KEY",     "")
_BAZARR_KEY      = os.environ.get("BAZARR_API_KEY",      "")
_JELLYFIN_KEY    = os.environ.get("JELLYFIN_API_KEY",    "")
_JELLYSEERR_KEY  = os.environ.get("JELLYSEERR_API_KEY",  "")
_DISPATCHARR_USER = os.environ.get("DISPATCHARR_USER",  "admin")
_DISPATCHARR_PASS = os.environ.get("DISPATCHARR_PASS",  "")
_PLEX_TOKEN      = os.environ.get("PLEX_TOKEN",          "")
_GITHUB_TOKEN    = os.environ.get("GITHUB_TOKEN",        "")
_ZILEAN_KEY      = os.environ.get("ZILEAN_API_KEY",      "")
_STREMTHRU_USER  = os.environ.get("STREMTHRU_USER",      "admin")
_STREMTHRU_PASS  = os.environ.get("STREMTHRU_PASS",      "")

# Try to read Plex token from Preferences.xml if not set
if not _PLEX_TOKEN:
    _plex_prefs = Path("/var/lib/plex/Plex Media Server/Preferences.xml")
    try:
        if _plex_prefs.exists():
            m = re.search(r'PlexOnlineToken="([^"]+)"', _plex_prefs.read_text())
            if m:
                _PLEX_TOKEN = m.group(1)
    except Exception:
        pass

# ── Shared state ──────────────────────────────────────────────────────────────
service_stats:    dict[str, dict] = {}
stats_updated_at: dict[str, str]  = {}
github_versions:  dict[str, dict] = {}   # {sid: {"latest": "v1.2.3", "published_at": "...", "fetched_at": float}}

# GitHub repo mapping
GITHUB_REPOS: dict[str, str] = {
    "comet":          "g0ldyy/comet",
    "mediafusion":    "mhdzumair/MediaFusion",
    "stremthru":      "MunifTanjim/stremthru",
    "zilean":         "iPromKnight/zilean",
    "aiostreams":     "Viren070/AIOStreams",
    "jackett":        "Jackett/Jackett",
    "prowlarr":       "Prowlarr/Prowlarr",
    "radarr":         "Radarr/Radarr",
    "sonarr":         "Sonarr/Sonarr",
    "lidarr":         "Lidarr/Lidarr",
    "bazarr":         "morpheus65535/bazarr",
    "jellyfin":       "jellyfin/jellyfin",
    "jellyseerr":     "fallenbagel/jellyseerr",
    "plex":           "plexinc/pms-docker",
    "dispatcharr":    "dispatcharr/dispatcharr",
    "mediaflow":      "mhdzumair/mediaflow-proxy",
    "flaresolverr":   "FlareSolverr/FlareSolverr",
    "pgbouncer":      "pgbouncer/pgbouncer",
    "qbittorrent":    "qbittorrent/qBittorrent",
}

# ── JWT token cache for Dispatcharr ───────────────────────────────────────────
_dispatcharr_token: str = ""
_dispatcharr_token_expiry: float = 0.0


async def _get_dispatcharr_token() -> str:
    global _dispatcharr_token, _dispatcharr_token_expiry
    if _dispatcharr_token and time.monotonic() < _dispatcharr_token_expiry:
        return _dispatcharr_token
    if not _DISPATCHARR_PASS:
        return ""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.post(
                "http://127.0.0.1:9191/api/accounts/token/",
                json={"username": _DISPATCHARR_USER, "password": _DISPATCHARR_PASS},
            )
            if r.status_code == 200:
                token = r.json().get("access", "")
                if token:
                    _dispatcharr_token = token
                    _dispatcharr_token_expiry = time.monotonic() + 3600  # 1h
                    return token
    except Exception:
        pass
    return ""


# ── HTTP helpers ──────────────────────────────────────────────────────────────

async def _get(
    client: httpx.AsyncClient,
    url: str,
    headers: dict | None = None,
    *,
    timeout: float = 8.0,
) -> dict | list | None:
    """GET JSON, return None on any failure (including non-200)."""
    try:
        r = await client.get(url, headers=headers or {}, timeout=timeout)
        if r.status_code == 200:
            ct = r.headers.get("content-type", "")
            if "json" in ct or r.text.strip().startswith(("{", "[")):
                return r.json()
    except Exception:
        pass
    return None


async def _get_xml(
    client: httpx.AsyncClient,
    url: str,
    headers: dict | None = None,
) -> str | None:
    """GET XML/text, return raw text or None."""
    try:
        r = await client.get(url, headers=headers or {}, timeout=8)
        if r.status_code == 200:
            return r.text
    except Exception:
        pass
    return None


# ── GitHub version checker ────────────────────────────────────────────────────

async def fetch_github_version(sid: str, repo: str) -> None:
    h: dict[str, str] = {}
    if _GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {_GITHUB_TOKEN}"
    h["Accept"] = "application/vnd.github+json"
    h["X-GitHub-Api-Version"] = "2022-11-28"
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            data = await _get(c, f"https://api.github.com/repos/{repo}/releases/latest", h)
        if data and isinstance(data, dict):
            tag = data.get("tag_name", "")
            github_versions[sid] = {
                "latest":       tag,
                "name":         data.get("name", tag),
                "published_at": data.get("published_at", ""),
                "fetched_at":   time.time(),
                "prerelease":   data.get("prerelease", False),
            }
    except Exception:
        pass


async def refresh_github_versions() -> None:
    tasks = [fetch_github_version(sid, repo) for sid, repo in GITHUB_REPOS.items()]
    await asyncio.gather(*tasks, return_exceptions=True)


# ── System stats collector ────────────────────────────────────────────────────

def _read_sysfs(path: str) -> str | None:
    try:
        return Path(path).read_text().strip()
    except Exception:
        return None


def _collect_system_sync() -> dict:
    result: dict = {}

    # ── OS info ──
    try:
        result["os_name"] = platform.system()
        result["os_release"] = platform.release()
        # Try /etc/os-release for distro name
        os_release = Path("/etc/os-release")
        if os_release.exists():
            txt = os_release.read_text()
            m = re.search(r'^PRETTY_NAME="([^"]+)"', txt, re.MULTILINE)
            if m:
                result["os_distro"] = m.group(1)
    except Exception:
        pass

    if _HAS_PSUTIL:
        # ── CPU ──
        try:
            cpu_info = {}
            cpu_info["physical_cores"] = psutil.cpu_count(logical=False) or 0
            cpu_info["logical_cores"] = psutil.cpu_count(logical=True) or 0
            # cpu_percent with interval=0 returns since last call (non-blocking)
            cpu_info["usage_pct"] = psutil.cpu_percent(interval=None)
            freq = psutil.cpu_freq()
            if freq:
                cpu_info["freq_mhz"] = round(freq.current)
                cpu_info["freq_max_mhz"] = round(freq.max)
            # CPU model from /proc/cpuinfo
            try:
                cpuinfo = Path("/proc/cpuinfo").read_text()
                m = re.search(r"model name\s*:\s*(.+)", cpuinfo)
                if m:
                    cpu_info["model"] = m.group(1).strip()
            except Exception:
                pass
            # Load average
            try:
                load = os.getloadavg()
                cpu_info["load_1m"] = round(load[0], 2)
                cpu_info["load_5m"] = round(load[1], 2)
                cpu_info["load_15m"] = round(load[2], 2)
            except Exception:
                pass
            result["cpu"] = cpu_info
        except Exception:
            pass

        # ── RAM ──
        try:
            mem = psutil.virtual_memory()
            result["ram"] = {
                "total_gb":     round(mem.total / 1024**3, 1),
                "used_gb":      round(mem.used / 1024**3, 1),
                "available_gb": round(mem.available / 1024**3, 1),
                "percent":      mem.percent,
            }
        except Exception:
            pass

        # ── Swap ──
        try:
            swap = psutil.swap_memory()
            if swap.total > 0:
                result["swap"] = {
                    "total_gb": round(swap.total / 1024**3, 1),
                    "used_gb":  round(swap.used / 1024**3, 1),
                    "percent":  swap.percent,
                }
        except Exception:
            pass

        # ── Disk ──
        try:
            drives = []
            seen = set()
            for part in psutil.disk_partitions(all=False):
                if part.device in seen:
                    continue
                seen.add(part.device)
                # Skip small/virtual partitions
                skip_fs = {"tmpfs", "devtmpfs", "squashfs", "overlay", "aufs",
                           "proc", "sysfs", "cgroup", "devpts", "debugfs"}
                if part.fstype in skip_fs:
                    continue
                try:
                    usage = psutil.disk_usage(part.mountpoint)
                    total_tb = usage.total / 1024**4
                    free_tb  = usage.free  / 1024**4
                    # Show TB if >= 0.1 TB, else GB
                    if total_tb >= 0.1:
                        drives.append({
                            "mount":    part.mountpoint,
                            "device":   part.device,
                            "total":    round(total_tb, 2),
                            "free":     round(free_tb, 2),
                            "unit":     "TB",
                            "percent":  usage.percent,
                        })
                    else:
                        drives.append({
                            "mount":    part.mountpoint,
                            "device":   part.device,
                            "total":    round(usage.total / 1024**3, 1),
                            "free":     round(usage.free  / 1024**3, 1),
                            "unit":     "GB",
                            "percent":  usage.percent,
                        })
                except (PermissionError, OSError):
                    pass
            if drives:
                result["disks"] = drives
        except Exception:
            pass

        # ── Processes / uptime ──
        try:
            result["process_count"] = len(psutil.pids())
        except Exception:
            pass

        try:
            bt = psutil.boot_time()
            uptime_sec = time.time() - bt
            days = int(uptime_sec // 86400)
            hours = int((uptime_sec % 86400) // 3600)
            mins  = int((uptime_sec % 3600) // 60)
            result["uptime"] = f"{days}d {hours}h {mins}m" if days else f"{hours}h {mins}m"
        except Exception:
            pass

    # ── AMD GPU via sysfs ──
    try:
        gpu_base = "/sys/class/drm/card1/device"
        hwmon_base = "/sys/class/drm/card1/device/hwmon/hwmon1"
        gpu = {}

        # GPU name from PCI device
        vendor = _read_sysfs(f"{gpu_base}/vendor")
        gpu_name_candidates = [
            "/sys/class/drm/card1/device/label",
        ]
        # Try to get name from hwmon
        hwmon_name = _read_sysfs(f"{hwmon_base}/name")
        if hwmon_name:
            gpu["driver"] = hwmon_name

        busy = _read_sysfs(f"{gpu_base}/gpu_busy_percent")
        if busy is not None:
            gpu["usage_pct"] = int(busy)

        mem_busy = _read_sysfs(f"{gpu_base}/mem_busy_percent")
        if mem_busy is not None:
            gpu["mem_busy_pct"] = int(mem_busy)

        vram_total = _read_sysfs(f"{gpu_base}/mem_info_vram_total")
        vram_used  = _read_sysfs(f"{gpu_base}/mem_info_vram_used")
        if vram_total and vram_used:
            gpu["vram_total_mb"] = round(int(vram_total) / 1024**2)
            gpu["vram_used_mb"]  = round(int(vram_used)  / 1024**2)

        temp = _read_sysfs(f"{hwmon_base}/temp1_input")
        if temp:
            gpu["temp_c"] = round(int(temp) / 1000)

        power = _read_sysfs(f"{hwmon_base}/power1_input")
        if power:
            gpu["power_w"] = round(int(power) / 1_000_000)

        fan = _read_sysfs(f"{hwmon_base}/fan1_input")
        if fan:
            gpu["fan_rpm"] = int(fan)

        freq_gpu = _read_sysfs(f"{hwmon_base}/freq1_input")
        if freq_gpu:
            gpu["core_mhz"] = round(int(freq_gpu) / 1_000_000)

        freq_mem = _read_sysfs(f"{hwmon_base}/freq2_input")
        if freq_mem:
            gpu["mem_mhz"] = round(int(freq_mem) / 1_000_000)

        # Try /proc/cpuinfo-style name from PCI
        try:
            pci_id = Path(f"{gpu_base}/uevent").read_text()
            m = re.search(r"PCI_ID=(\w+):(\w+)", pci_id)
            # Hardcode known name for this system
            gpu["name"] = "AMD Radeon RX 580"
        except Exception:
            pass

        if gpu:
            result["gpu"] = gpu
    except Exception:
        pass

    return result


async def collect_system() -> dict:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _collect_system_sync)


# ── Per-service stats collectors ──────────────────────────────────────────────

async def collect_comet() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        manifest, metrics, connections = await asyncio.gather(
            _get(c, "http://127.0.0.1:8070/manifest.json"),
            _get(c, "http://127.0.0.1:8070/admin/api/metrics"),
            _get(c, "http://127.0.0.1:8070/admin/api/connections"),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(manifest, dict):
        result["version"] = manifest.get("version", "")
        result["name"]    = manifest.get("name", "")
        result["types"]   = manifest.get("types", [])
    if isinstance(metrics, dict):
        result["torrents_total"]    = metrics.get("torrents_total", 0)
        result["searches_24h"]      = metrics.get("searches_24h", 0)
        result["searches_7d"]       = metrics.get("searches_7d", 0)
        result["debrid_cache_hits"] = metrics.get("debrid_cache_hits", 0)
    if isinstance(connections, dict):
        result["active_streams"] = connections.get("active_streams", 0)
        result["bandwidth_mbps"] = connections.get("bandwidth_mbps", 0)
    return result


async def collect_mediafusion() -> dict:
    async with httpx.AsyncClient(verify=False, timeout=10) as c:
        info, manifest = await asyncio.gather(
            _get(c, "https://127.0.0.1:8090/api/v1/instance/info"),
            _get(c, "https://127.0.0.1:8090/manifest.json"),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(info, dict):
        result.update({
            "version":          info.get("version", ""),
            "is_public":        info.get("is_public", False),
            "setup_required":   info.get("setup_required", False),
            "requires_api_key": info.get("requires_api_key", False),
        })
    if isinstance(manifest, dict):
        result["addon_name"]    = manifest.get("name", "")
        result["addon_version"] = manifest.get("version", "")
    return result


async def collect_stremthru() -> dict:
    import base64
    basic = base64.b64encode(f"{_STREMTHRU_USER}:{_STREMTHRU_PASS}".encode()).decode()
    auth_h = {"Authorization": f"Basic {basic}"}

    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
        health, mfest, store_user = await asyncio.gather(
            _get(c, "http://127.0.0.1:8080/v0/health"),
            _get(c, "http://127.0.0.1:8080/stremio/store/manifest.json"),
            _get(c, "http://127.0.0.1:8080/v0/store/user", auth_h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(health, dict):
        result["status"] = health.get("data", {}).get("status", "")
    if isinstance(mfest, dict):
        result["version"] = mfest.get("version", "")
        result["name"]    = mfest.get("name", "")
    if isinstance(store_user, dict):
        data = store_user.get("data", {})
        if isinstance(data, dict):
            result["store_name"]     = data.get("name", "")
            result["subscription"]   = data.get("subscription_status", "")
            result["email"]          = data.get("email", "")
    return result


async def collect_zilean() -> dict:
    h = {"X-Api-Key": _ZILEAN_KEY} if _ZILEAN_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        ping, dmm_count = await asyncio.gather(
            _get(c, "http://127.0.0.1:8181/healthchecks/ping", h),
            _get(c, "http://127.0.0.1:8181/dmm/on-disk-dmmhashcount", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(ping, dict):
        result["responding"] = True
        result["status"] = ping.get("status", "")
    elif isinstance(ping, str) and "OK" in ping.upper():
        result["responding"] = True
        result["status"] = "ok"
    if isinstance(dmm_count, dict):
        count = dmm_count.get("count") or dmm_count.get("hashCount") or dmm_count.get("total")
        if count is not None:
            result["hash_count"] = count
    elif isinstance(dmm_count, int):
        result["hash_count"] = dmm_count
    return result


async def collect_aiostreams() -> dict:
    async with httpx.AsyncClient(timeout=8, follow_redirects=True) as c:
        manifest = await _get(c, "http://127.0.0.1:7070/stremio/manifest.json")
        if not isinstance(manifest, dict):
            # Fallback: just check if responding
            try:
                r = await c.get("http://127.0.0.1:7070/")
                return {"responding": r.status_code < 500, "status_code": r.status_code}
            except Exception:
                return {}
    return {
        "responding": True,
        "version":    manifest.get("version", ""),
        "name":       manifest.get("name", ""),
    }


async def collect_flaresolverr() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        health = await _get(c, "http://127.0.0.1:8191/health")
    if isinstance(health, dict):
        return {
            "status":  health.get("status", ""),
            "version": health.get("version", ""),
        }
    return {}


async def collect_jackett() -> dict:
    base = "http://127.0.0.1:9117"
    result: dict = {}
    # Count indexers from filesystem
    indexer_dir = Path("/var/lib/jackett/Indexers")
    if indexer_dir.exists():
        indexer_files = list(indexer_dir.glob("*.json"))
        result["indexers_configured"] = len(indexer_files)
    # Use Torznab endpoint to verify responding
    async with httpx.AsyncClient(timeout=10) as c:
        r = await _get(c, f"{base}/api/v2.0/indexers/all/results?apikey={_JACKETT_KEY}&Query=test&Limit=1")
    if isinstance(r, dict):
        result["results_count"] = len(r.get("Results", []))
        result["responding"]    = True
    return result


async def collect_prowlarr() -> dict:
    base = "http://127.0.0.1:9696"
    h = {"X-Api-Key": _PROWLARR_KEY}
    async with httpx.AsyncClient(timeout=10) as c:
        status, indexers, health, istats = await asyncio.gather(
            _get(c, f"{base}/api/v1/system/status", h),
            _get(c, f"{base}/api/v1/indexer", h),
            _get(c, f"{base}/api/v1/health", h),
            _get(c, f"{base}/api/v1/indexerstats", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(indexers, list):
        result["indexers_total"]   = len(indexers)
        result["indexers_enabled"] = sum(1 for i in indexers if i.get("enable"))
    if isinstance(health, list):
        result["health_errors"]   = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(istats, dict):
        idxs = istats.get("indexers", [])
        result["total_queries"]        = sum(i.get("numberOfQueries", 0) for i in idxs)
        result["total_grabs"]          = sum(i.get("numberOfGrabs", 0) for i in idxs)
        result["total_failed_queries"] = sum(i.get("numberOfFailedQueries", 0) for i in idxs)
        result["avg_response_ms"]      = istats.get("averageResponseTime")
    return result


async def collect_radarr() -> dict:
    base = "http://127.0.0.1:7878"
    h = {"X-Api-Key": _RADARR_KEY}
    async with httpx.AsyncClient(timeout=20) as c:
        status, movies, queue, health, disk = await asyncio.gather(
            _get(c, f"{base}/api/v3/system/status", h),
            _get(c, f"{base}/api/v3/movie", h, timeout=15.0),
            _get(c, f"{base}/api/v3/queue", h),
            _get(c, f"{base}/api/v3/health", h),
            _get(c, f"{base}/api/v3/diskspace", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(movies, list):
        result["total"]       = len(movies)
        result["monitored"]   = sum(1 for m in movies if m.get("monitored"))
        result["downloaded"]  = sum(1 for m in movies if m.get("hasFile"))
        result["missing"]     = sum(1 for m in movies if m.get("monitored") and not m.get("hasFile"))
        result["unmonitored"] = sum(1 for m in movies if not m.get("monitored"))
    if isinstance(queue, dict):
        recs = queue.get("records", [])
        result["queue"]        = queue.get("totalRecords", len(recs))
        result["queue_errors"] = sum(1 for r in recs
                                     if r.get("status") in ("warning", "error") or r.get("errorMessage"))
    if isinstance(health, list):
        result["health_errors"]   = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"]  = round(sum(d.get("freeSpace",  0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    return result


async def collect_sonarr() -> dict:
    base = "http://127.0.0.1:8989"
    h = {"X-Api-Key": _SONARR_KEY}
    async with httpx.AsyncClient(timeout=20) as c:
        status, series, queue, health, disk, wanted = await asyncio.gather(
            _get(c, f"{base}/api/v3/system/status", h),
            _get(c, f"{base}/api/v3/series", h, timeout=15.0),
            _get(c, f"{base}/api/v3/queue", h),
            _get(c, f"{base}/api/v3/health", h),
            _get(c, f"{base}/api/v3/diskspace", h),
            _get(c, f"{base}/api/v3/wanted/missing?pageSize=1", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(series, list):
        result["total"]     = len(series)
        result["monitored"] = sum(1 for s in series if s.get("monitored"))
        stats_list = [s.get("statistics", {}) for s in series]
        result["episodes_total"]      = sum(s.get("totalEpisodeCount", 0) for s in stats_list)
        result["episodes_downloaded"] = sum(s.get("episodeFileCount",  0) for s in stats_list)
        result["episodes_monitored"]  = sum(s.get("episodeCount",      0) for s in stats_list)
    if isinstance(queue, dict):
        result["queue"] = queue.get("totalRecords", 0)
    if isinstance(health, list):
        result["health_errors"]   = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"]  = round(sum(d.get("freeSpace",  0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    if isinstance(wanted, dict):
        result["missing_episodes"] = wanted.get("totalRecords", 0)
    return result


async def collect_lidarr() -> dict:
    base = "http://127.0.0.1:8686"
    h = {"X-Api-Key": _LIDARR_KEY}
    async with httpx.AsyncClient(timeout=20) as c:
        status, artists, queue, health, disk = await asyncio.gather(
            _get(c, f"{base}/api/v1/system/status", h),
            _get(c, f"{base}/api/v1/artist", h, timeout=15.0),
            _get(c, f"{base}/api/v1/queue", h),
            _get(c, f"{base}/api/v1/health", h),
            _get(c, f"{base}/api/v1/diskspace", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"] = status.get("version", "")
    if isinstance(artists, list):
        result["artists"]   = len(artists)
        result["monitored"] = sum(1 for a in artists if a.get("monitored"))
        stats_list = [a.get("statistics", {}) for a in artists]
        result["albums_total"]  = sum(s.get("albumCount",      0) for s in stats_list)
        result["track_count"]   = sum(s.get("trackFileCount",  0) for s in stats_list)
    if isinstance(queue, dict):
        result["queue"] = queue.get("totalRecords", 0)
    if isinstance(health, list):
        result["health_errors"]   = sum(1 for h in health if h.get("type") == "error")
        result["health_warnings"] = sum(1 for h in health if h.get("type") == "warning")
        result["health_messages"] = [h.get("message", "") for h in health if h.get("type") == "error"][:3]
    if isinstance(disk, list) and disk:
        result["disk_free_gb"]  = round(sum(d.get("freeSpace",  0) for d in disk) / 1024**3, 1)
        result["disk_total_gb"] = round(sum(d.get("totalSpace", 0) for d in disk) / 1024**3, 1)
    return result


async def collect_bazarr() -> dict:
    base = "http://127.0.0.1:6767"
    h = {"X-Api-Key": _BAZARR_KEY}
    async with httpx.AsyncClient(timeout=10) as c:
        status, movies, episodes = await asyncio.gather(
            _get(c, f"{base}/api/system/status", h),
            _get(c, f"{base}/api/movies", h),
            _get(c, f"{base}/api/episodes", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"]        = status.get("bazarr_version", "")
        result["python_version"] = status.get("python_version", "")
    if isinstance(movies, dict):
        result["movies_total"]   = movies.get("total", 0)
        result["movies_missing"] = movies.get("total_missing", 0)
    if isinstance(episodes, dict):
        result["episodes_total"]   = episodes.get("total", 0)
        result["episodes_missing"] = episodes.get("total_missing", 0)
    return result


async def collect_jellyfin() -> dict:
    base = "http://127.0.0.1:8096"
    h = {"X-Emby-Token": _JELLYFIN_KEY} if _JELLYFIN_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        pub_info, info, sessions, counts = await asyncio.gather(
            _get(c, f"{base}/System/Info/Public"),
            _get(c, f"{base}/System/Info", h),
            _get(c, f"{base}/Sessions", h),
            _get(c, f"{base}/Items/Counts", h),
            return_exceptions=True,
        )
    result: dict = {}
    # Use public info as fallback (no auth needed)
    if isinstance(pub_info, dict):
        result["version"]     = pub_info.get("Version", "")
        result["server_name"] = pub_info.get("ServerName", "")
    if isinstance(info, dict):
        result["version"]     = info.get("Version", result.get("version", ""))
        result["server_name"] = info.get("ServerName", result.get("server_name", ""))
        result["os"]          = info.get("OperatingSystem", "")
    if isinstance(sessions, list):
        active = [s for s in sessions if s.get("NowPlayingItem")]
        result["sessions_total"]  = len(sessions)
        result["sessions_active"] = len(active)
        result["now_playing"] = [
            f"{s['NowPlayingItem'].get('SeriesName', '')}: {s['NowPlayingItem'].get('Name', '')}"
            if s["NowPlayingItem"].get("SeriesName")
            else s["NowPlayingItem"].get("Name", "")
            for s in active[:3]
        ]
    if isinstance(counts, dict):
        result["movies"]   = counts.get("MovieCount",   0)
        result["series"]   = counts.get("SeriesCount",  0)
        result["episodes"] = counts.get("EpisodeCount", 0)
        result["songs"]    = counts.get("SongCount",    0)
        result["albums"]   = counts.get("AlbumCount",   0)
    return result


async def collect_plex() -> dict:
    base = "http://127.0.0.1:32400"
    h: dict[str, str] = {}
    if _PLEX_TOKEN:
        h["X-Plex-Token"] = _PLEX_TOKEN
    result: dict = {}
    async with httpx.AsyncClient(timeout=10) as c:
        identity_text, sessions_text, sections_text = await asyncio.gather(
            _get_xml(c, f"{base}/identity"),
            _get_xml(c, f"{base}/status/sessions", h),
            _get_xml(c, f"{base}/library/sections", h),
            return_exceptions=True,
        )
    if isinstance(identity_text, str):
        m = re.search(r'version="([^"]+)"', identity_text)
        if m:
            result["version"] = m.group(1)
        m2 = re.search(r'machineIdentifier="([^"]+)"', identity_text)
        if m2:
            result["machine_id"] = m2.group(1)[:16] + "…"
    if isinstance(sessions_text, str):
        m = re.search(r'size="(\d+)"', sessions_text)
        result["sessions_active"] = int(m.group(1)) if m else 0
    if isinstance(sections_text, str):
        try:
            from xml.etree import ElementTree as ET
            tree = ET.fromstring(sections_text)
            libs: list[dict] = []
            for d in tree.findall(".//Directory"):
                libs.append({
                    "title": d.get("title", ""),
                    "type":  d.get("type", ""),
                    "count": int(d.get("count", "0") or "0"),
                })
            result["libraries"]  = libs
            result["movies"]     = sum(l["count"] for l in libs if l["type"] == "movie")
            result["series"]     = sum(l["count"] for l in libs if l["type"] == "show")
        except Exception:
            pass
    return result


async def collect_jellyseerr() -> dict:
    base = "http://127.0.0.1:5055"
    h = {"X-Api-Key": _JELLYSEERR_KEY} if _JELLYSEERR_KEY else {}
    async with httpx.AsyncClient(timeout=10) as c:
        status, req_count = await asyncio.gather(
            _get(c, f"{base}/api/v1/status", h),
            _get(c, f"{base}/api/v1/request/count", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(status, dict):
        result["version"]           = status.get("version", "")
        result["update_available"]  = status.get("updateAvailable", False)
        result["commits_behind"]    = status.get("commitsBehind", 0)
    if isinstance(req_count, dict):
        result["requests_total"]     = req_count.get("total", 0)
        result["requests_movie"]     = req_count.get("movie", 0)
        result["requests_tv"]        = req_count.get("tv", 0)
        result["requests_pending"]   = req_count.get("pending", 0)
        result["requests_approved"]  = req_count.get("approved", 0)
        result["requests_available"] = req_count.get("available", 0)
    return result


async def collect_dispatcharr() -> dict:
    tok = await _get_dispatcharr_token()
    h: dict[str, str] = {"Authorization": f"Bearer {tok}"} if tok else {}

    base = "http://127.0.0.1:9191"
    async with httpx.AsyncClient(timeout=15) as c:
        ver, streams_pg, channels, epg_src, m3u_accs = await asyncio.gather(
            _get(c, f"{base}/api/core/version/", h),
            _get(c, f"{base}/api/channels/streams/?limit=1", h),
            _get(c, f"{base}/api/channels/channels/", h),
            _get(c, f"{base}/api/epg/sources/", h),
            _get(c, f"{base}/api/m3u/accounts/", h),
            return_exceptions=True,
        )
    result: dict = {}
    if isinstance(ver, dict):
        result["version"] = ver.get("version", "")
    if isinstance(streams_pg, dict):
        result["total_streams"] = streams_pg.get("count", 0)
    if isinstance(channels, list):
        result["total_channels"] = len(channels)
    elif isinstance(channels, dict):
        result["total_channels"] = channels.get("count", 0)
    if isinstance(epg_src, list):
        result["epg_sources"]  = len(epg_src)
        result["epg_errors"]   = sum(1 for s in epg_src if s.get("status") == "error")
        result["epg_ok"]       = sum(1 for s in epg_src if s.get("status") == "success")
        updated = [s.get("updated_at", "") for s in epg_src if s.get("updated_at")]
        if updated:
            result["epg_last_updated"] = max(updated)
    if isinstance(m3u_accs, list):
        result["m3u_accounts"]        = len(m3u_accs)
        result["m3u_accounts_active"] = sum(1 for a in m3u_accs if a.get("is_active", True))
    return result


async def collect_mediaflow() -> dict:
    async with httpx.AsyncClient(timeout=8) as c:
        health = await _get(c, "http://127.0.0.1:8888/health")
    if isinstance(health, dict):
        return {"status": health.get("status", "")}
    return {}


async def collect_qbittorrent() -> dict:
    base = "http://127.0.0.1:10000"
    result: dict = {}
    async with httpx.AsyncClient(timeout=8) as c:
        try:
            r = await c.get(f"{base}/api/v2/app/version", timeout=5)
            if r.status_code == 200:
                result["version"]    = r.text.strip()
                result["responding"] = True
        except Exception:
            pass
    return result


# ── Collector dispatch ────────────────────────────────────────────────────────

_COLLECTORS: dict[str, any] = {
    "comet":        collect_comet,
    "mediafusion":  collect_mediafusion,
    "stremthru":    collect_stremthru,
    "zilean":       collect_zilean,
    "aiostreams":   collect_aiostreams,
    "flaresolverr": collect_flaresolverr,
    "jackett":      collect_jackett,
    "prowlarr":     collect_prowlarr,
    "radarr":       collect_radarr,
    "sonarr":       collect_sonarr,
    "lidarr":       collect_lidarr,
    "bazarr":       collect_bazarr,
    "jellyfin":     collect_jellyfin,
    "jellyseerr":   collect_jellyseerr,
    "plex":         collect_plex,
    "dispatcharr":  collect_dispatcharr,
    "mediaflow":    collect_mediaflow,
    "qbittorrent":  collect_qbittorrent,
    "system":       collect_system,
}


async def _collect_one(sid: str) -> None:
    fn = _COLLECTORS.get(sid)
    if not fn:
        return
    try:
        data = await fn()
        service_stats[sid]    = data or {}
        stats_updated_at[sid] = datetime.now(timezone.utc).isoformat()
    except Exception:
        service_stats.setdefault(sid, {})


async def stats_loop() -> None:
    """Background loop: stagger startup, then refresh every STATS_INTERVAL seconds."""
    for i, sid in enumerate(_COLLECTORS):
        asyncio.create_task(_collect_one(sid))
        await asyncio.sleep(0.25)
    asyncio.create_task(refresh_github_versions())

    last_github = time.monotonic()
    while True:
        await asyncio.sleep(STATS_INTERVAL)
        await asyncio.gather(
            *[_collect_one(sid) for sid in _COLLECTORS],
            return_exceptions=True,
        )
        if time.monotonic() - last_github > GITHUB_INTERVAL:
            asyncio.create_task(refresh_github_versions())
            last_github = time.monotonic()
