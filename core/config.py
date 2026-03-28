"""Configuration: API keys, service definitions, categories."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

# ── Key store (loaded at import, mutated at runtime via /api/settings/keys) ──
_KEY_FILE = Path(__file__).parent.parent / "data" / "apikeys.json"


def _load_keys() -> dict[str, str]:
    """Load saved keys from data/apikeys.json, falling back to ~/.apikeys."""
    saved: dict[str, str] = {}
    # Load JSON override file
    try:
        if _KEY_FILE.exists():
            saved = json.loads(_KEY_FILE.read_text())
    except Exception:
        pass
    # Parse ~/.apikeys as fallback
    home_keys: dict[str, str] = {}
    try:
        home_file = Path.home() / ".apikeys"
        if home_file.exists():
            for line in home_file.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, _, v = line.partition("=")
                    home_keys[k.strip()] = v.strip()
    except Exception:
        pass
    return {**home_keys, **saved}  # saved overrides home


_stored = _load_keys()


def _k(env_var: str, home_key: str, default: str = "") -> str:
    return os.environ.get(env_var) or _stored.get(home_key) or default


def save_keys(updates: dict[str, str]) -> None:
    """Persist key updates to data/apikeys.json and reload."""
    global _stored
    _KEY_FILE.parent.mkdir(exist_ok=True)
    try:
        current = json.loads(_KEY_FILE.read_text()) if _KEY_FILE.exists() else {}
    except Exception:
        current = {}
    current.update(updates)
    _KEY_FILE.write_text(json.dumps(current, indent=2))
    _stored = _load_keys()


def reload_keys() -> None:
    global _stored
    _stored = _load_keys()


# ── API Keys ─────────────────────────────────────────────────────────────────
PROWLARR_KEY = _k("PROWLARR_API_KEY", "prowlarr", "")
RADARR_KEY = _k("RADARR_API_KEY", "radarr", "")
SONARR_KEY = _k("SONARR_API_KEY", "sonarr", "")
LIDARR_KEY = _k("LIDARR_API_KEY", "lidarr", "")
JACKETT_KEY = _k("JACKETT_API_KEY", "jackett", "")
BAZARR_KEY = _k("BAZARR_API_KEY", "bazarr", "")
JELLYFIN_KEY = _k("JELLYFIN_API_KEY", "jellyfin", "")
JELLYSEERR_KEY = _k("JELLYSEERR_API_KEY", "jellyseerr", "")
ZILEAN_KEY = _k("ZILEAN_API_KEY", "zilean", "")
DISPATCHARR_USER = os.environ.get("DISPATCHARR_USER", "admin")
DISPATCHARR_PASS = _k("DISPATCHARR_PASS", "dispatcharr_pass", "")
PLEX_TOKEN = _k("PLEX_TOKEN", "plex_token", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")
QBT_USER = _k("QBT_USER", "qbt_user", "admin")
QBT_PASS = _k("QBT_PASS", "qbt_pass", "")
STREMTHRU_USER = _k("STREMTHRU_USER", "stremthru_user", "admin")
STREMTHRU_PASS = _k("STREMTHRU_PASS", "stremthru_pass", "")
COMET_ADMIN_PASS = _k("COMET_ADMIN_PASS", "comet_admin_password", "")
MEDIAFUSION_PASS = _k("MEDIAFUSION_PASS", "mediafusion_api_password", "")
MEDIAFUSION_EMAIL = _k("MEDIAFUSION_EMAIL", "mediafusion_email", "")
MEDIAFUSION_USER_PASS = _k("MEDIAFUSION_USER_PASS", "mediafusion_password", "")
AIOSTREAMS_SECRET = _k("AIOSTREAMS_SECRET", "aiostreams_secret", "")

# Keys that are surfaced in the Settings UI (name → current value, masked in display)
KEY_REGISTRY: dict[str, dict] = {
    "prowlarr": {"label": "Prowlarr API Key", "attr": "PROWLARR_KEY", "group": "Indexers"},
    "jackett": {"label": "Jackett API Key", "attr": "JACKETT_KEY", "group": "Indexers"},
    "radarr": {"label": "Radarr API Key", "attr": "RADARR_KEY", "group": "Arr Suite"},
    "sonarr": {"label": "Sonarr API Key", "attr": "SONARR_KEY", "group": "Arr Suite"},
    "lidarr": {"label": "Lidarr API Key", "attr": "LIDARR_KEY", "group": "Arr Suite"},
    "bazarr": {"label": "Bazarr API Key", "attr": "BAZARR_KEY", "group": "Arr Suite"},
    "jellyfin": {"label": "Jellyfin API Key", "attr": "JELLYFIN_KEY", "group": "Media Servers"},
    "jellyseerr": {"label": "Jellyseerr API Key", "attr": "JELLYSEERR_KEY", "group": "Media Servers"},
    "zilean": {"label": "Zilean API Key", "attr": "ZILEAN_KEY", "group": "Streaming"},
    "stremthru_pass": {"label": "StremThru Password", "attr": "STREMTHRU_PASS", "group": "Streaming"},
    "comet_admin_password": {"label": "Comet Admin Password", "attr": "COMET_ADMIN_PASS", "group": "Streaming"},
    "mediafusion_api_password": {"label": "MediaFusion Password", "attr": "MEDIAFUSION_PASS", "group": "Streaming"},
    "aiostreams_secret": {"label": "AIOStreams Secret", "attr": "AIOSTREAMS_SECRET", "group": "Streaming"},
    "dispatcharr_pass": {"label": "Dispatcharr Password", "attr": "DISPATCHARR_PASS", "group": "Dispatching"},
    "qbt_pass": {"label": "qBittorrent Password", "attr": "QBT_PASS", "group": "Downloads"},
    "qbt_user": {"label": "qBittorrent Username", "attr": "QBT_USER", "group": "Downloads"},
}

# URLs surfaced in the Settings UI
URL_REGISTRY: dict[str, dict] = {
    "comet_url": {"label": "Comet", "attr": "COMET_URL", "group": "Streaming"},
    "mediafusion_url": {"label": "MediaFusion", "attr": "MEDIAFUSION_URL", "group": "Streaming"},
    "stremthru_url": {"label": "StremThru", "attr": "STREMTHRU_URL", "group": "Streaming"},
    "zilean_url": {"label": "Zilean", "attr": "ZILEAN_URL", "group": "Streaming"},
    "aiostreams_url": {"label": "AIOStreams", "attr": "AIOSTREAMS_URL", "group": "Streaming"},
    "jackett_url": {"label": "Jackett", "attr": "JACKETT_URL", "group": "Indexers"},
    "prowlarr_url": {"label": "Prowlarr", "attr": "PROWLARR_URL", "group": "Indexers"},
    "flaresolverr_url": {"label": "FlareSolverr", "attr": "FLARESOLVERR_URL", "group": "Indexers"},
    "byparr_url": {"label": "Byparr", "attr": "BYPARR_URL", "group": "Indexers"},
    "radarr_url": {"label": "Radarr", "attr": "RADARR_URL", "group": "Arr Suite"},
    "sonarr_url": {"label": "Sonarr", "attr": "SONARR_URL", "group": "Arr Suite"},
    "lidarr_url": {"label": "Lidarr", "attr": "LIDARR_URL", "group": "Arr Suite"},
    "bazarr_url": {"label": "Bazarr", "attr": "BAZARR_URL", "group": "Arr Suite"},
    "jellyfin_url": {"label": "Jellyfin", "attr": "JELLYFIN_URL", "group": "Media Servers"},
    "plex_url": {"label": "Plex", "attr": "PLEX_URL", "group": "Media Servers"},
    "jellyseerr_url": {"label": "Jellyseerr", "attr": "JELLYSEERR_URL", "group": "Media Servers"},
    "dispatcharr_url": {"label": "Dispatcharr", "attr": "DISPATCHARR_URL", "group": "Dispatching"},
    "dispatcharr_api_url": {
        "label": "Dispatcharr API",
        "attr": "DISPATCHARR_API_URL",
        "group": "Dispatching",
    },
    "mediaflow_url": {"label": "MediaFlow Proxy", "attr": "MEDIAFLOW_URL", "group": "Dispatching"},
    "qbittorrent_url": {"label": "qBittorrent", "attr": "QBITTORRENT_URL", "group": "Downloads"},
}

# Maps service IDs to (URL attr, health-check path suffix) for URL rebuilds.
_SERVICE_URL_PATHS: dict[str, tuple[str, str]] = {
    "comet": ("COMET_URL", "/manifest.json"),
    "mediafusion": ("MEDIAFUSION_URL", "/health"),
    "stremthru": ("STREMTHRU_URL", "/v0/health"),
    "zilean": ("ZILEAN_URL", "/healthchecks/ping"),
    "aiostreams": ("AIOSTREAMS_URL", "/stremio/manifest.json"),
    "jackett": ("JACKETT_URL", None),  # special — rebuilt in get_live_headers
    "prowlarr": ("PROWLARR_URL", "/api/v1/system/status"),
    "flaresolverr": ("FLARESOLVERR_URL", "/health"),
    "byparr": ("BYPARR_URL", "/"),
    "radarr": ("RADARR_URL", "/api/v3/system/status"),
    "sonarr": ("SONARR_URL", "/api/v3/system/status"),
    "lidarr": ("LIDARR_URL", "/api/v1/system/status"),
    "bazarr": ("BAZARR_URL", "/api/system/status"),
    "jellyfin": ("JELLYFIN_URL", "/System/Info/Public"),
    "plex": ("PLEX_URL", "/identity"),
    "jellyseerr": ("JELLYSEERR_URL", "/api/v1/status"),
    "dispatcharr": ("DISPATCHARR_URL", "/"),
    "mediaflow": ("MEDIAFLOW_URL", "/health"),
    "qbittorrent": ("QBITTORRENT_URL", "/"),
}


def _rebuild_service_urls() -> None:
    """Rebuild SERVICES health-check URLs and WEB_URLS from current module attrs."""
    for sid, (attr, path) in _SERVICE_URL_PATHS.items():
        base = globals().get(attr, "")
        if not base:
            continue
        if sid == "jackett":
            key_val = globals().get("JACKETT_KEY", "")
            SERVICES[sid]["url"] = f"{base}/api/v2.0/indexers/all/results?apikey={key_val}&Query=health&Limit=1"
        elif path is not None:
            SERVICES[sid]["url"] = f"{base}{path}"
        # Update WEB_URLS
        if sid == "plex":
            WEB_URLS[sid] = f"{base}/web"
        elif sid in WEB_URLS:
            WEB_URLS[sid] = base


def save_urls(updates: dict[str, str]) -> None:
    """Persist URL updates to data/urls.json and update live module attrs + SERVICES."""
    global _stored_urls
    _URL_FILE.parent.mkdir(exist_ok=True)
    try:
        current = json.loads(_URL_FILE.read_text()) if _URL_FILE.exists() else {}
    except Exception:
        current = {}
    current.update(updates)
    _URL_FILE.write_text(json.dumps(current, indent=2))
    _stored_urls = _load_urls()
    # Update module-level URL attributes
    for k, v in updates.items():
        meta = URL_REGISTRY.get(k)
        if meta:
            attr = meta["attr"]
            globals()[attr] = v
    # Rebuild SERVICES dict URLs and WEB_URLS
    _rebuild_service_urls()


def is_valid_url(value: str) -> bool:
    """Basic URL validation."""
    try:
        r = urlparse(value)
        return r.scheme in ("http", "https") and bool(r.netloc)
    except Exception:
        return False


# Try to read Plex token from Preferences.xml
PLEX_PREFS_PATH = os.environ.get("PLEX_PREFS_PATH", "/var/lib/plex/Plex Media Server/Preferences.xml")
if not PLEX_TOKEN:
    try:
        _plex_prefs = Path(PLEX_PREFS_PATH)
        if _plex_prefs.exists() and (m := re.search(r'PlexOnlineToken="([^"]+)"', _plex_prefs.read_text())):
            PLEX_TOKEN = m.group(1)
    except Exception:
        pass

# ── URL store (loaded at import, mutated at runtime via /api/settings/urls) ──
_URL_FILE = Path(__file__).parent.parent / "data" / "urls.json"


def _load_urls() -> dict[str, str]:
    """Load saved URLs from data/urls.json."""
    try:
        if _URL_FILE.exists():
            return json.loads(_URL_FILE.read_text())
    except Exception:
        pass
    return {}


_stored_urls = _load_urls()


def _url(env_var: str, registry_key: str, default: str) -> str:
    """Resolve a URL: env var > saved urls.json > default."""
    return os.environ.get(env_var) or _stored_urls.get(registry_key) or default


# ── Service Base URLs ────────────────────────────────────────────────────────
# Override any of these via environment variables or the Settings UI.
COMET_URL = _url("COMET_URL", "comet_url", "http://127.0.0.1:8070")
MEDIAFUSION_URL = _url("MEDIAFUSION_URL", "mediafusion_url", "https://127.0.0.1:8090")
STREMTHRU_URL = _url("STREMTHRU_URL", "stremthru_url", "http://127.0.0.1:8080")
ZILEAN_URL = _url("ZILEAN_URL", "zilean_url", "http://127.0.0.1:8181")
AIOSTREAMS_URL = _url("AIOSTREAMS_URL", "aiostreams_url", "http://127.0.0.1:7070")
JACKETT_URL = _url("JACKETT_URL", "jackett_url", "http://127.0.0.1:9117")
PROWLARR_URL = _url("PROWLARR_URL", "prowlarr_url", "http://127.0.0.1:9696")
FLARESOLVERR_URL = _url("FLARESOLVERR_URL", "flaresolverr_url", "http://127.0.0.1:8191")
BYPARR_URL = _url("BYPARR_URL", "byparr_url", "http://127.0.0.1:8192")
RADARR_URL = _url("RADARR_URL", "radarr_url", "http://127.0.0.1:7878")
SONARR_URL = _url("SONARR_URL", "sonarr_url", "http://127.0.0.1:8989")
LIDARR_URL = _url("LIDARR_URL", "lidarr_url", "http://127.0.0.1:8686")
BAZARR_URL = _url("BAZARR_URL", "bazarr_url", "http://127.0.0.1:6767")
JELLYFIN_URL = _url("JELLYFIN_URL", "jellyfin_url", "http://127.0.0.1:8096")
PLEX_URL = _url("PLEX_URL", "plex_url", "http://127.0.0.1:32400")
JELLYSEERR_URL = _url("JELLYSEERR_URL", "jellyseerr_url", "http://127.0.0.1:5055")
DISPATCHARR_URL = _url("DISPATCHARR_URL", "dispatcharr_url", "http://127.0.0.1:8001")
DISPATCHARR_API_URL = _url("DISPATCHARR_API_URL", "dispatcharr_api_url", "http://127.0.0.1:9191")
MEDIAFLOW_URL = _url("MEDIAFLOW_URL", "mediaflow_url", "http://127.0.0.1:8060")
QBITTORRENT_URL = _url("QBITTORRENT_URL", "qbittorrent_url", "http://127.0.0.1:10000")

# ── Data / File Paths ────────────────────────────────────────────────────────
COMET_CHANGELOG = os.environ.get("COMET_CHANGELOG", "/home/comet/comet/CHANGELOG.md")
STREMTHRU_DB = os.environ.get("STREMTHRU_DB", "/home/stremthru/stremthru/data/stremthru.db")
AIOSTREAMS_DB = os.environ.get("AIOSTREAMS_DB", "/home/s/AIOStreams/data/db.sqlite")
JACKETT_INDEXER_DIR = os.environ.get("JACKETT_INDEXER_DIR", "/var/lib/jackett/Indexers")
PLEX_LOG_DIR = os.environ.get("PLEX_LOG_DIR", "/var/lib/plex/Plex Media Server/Logs")

# ── Speed Test ───────────────────────────────────────────────────────────────
SPEEDTEST_DIRECT_URL = os.environ.get("SPEEDTEST_DIRECT_URL", "")
SPEEDTEST_DIRECT_NAME = os.environ.get("SPEEDTEST_DIRECT_NAME", "Direct")
SPEEDTEST_CF_URL = os.environ.get("SPEEDTEST_CF_URL", "")
SPEEDTEST_CF_NAME = os.environ.get("SPEEDTEST_CF_NAME", "Cloudflare")

# ── Benchmark Endpoint Configs ───────────────────────────────────────────────
# Base64-encoded Stremio addon config tokens for the benchmark feature.
BENCH_COMET_CONFIG = os.environ.get("BENCH_COMET_CONFIG", "")
BENCH_MEDIAFUSION_CONFIG = os.environ.get("BENCH_MEDIAFUSION_CONFIG", "")
BENCH_STREMTHRU_CONFIG = os.environ.get("BENCH_STREMTHRU_CONFIG", "")
BENCH_AIOSTREAMS_CONFIG = os.environ.get("BENCH_AIOSTREAMS_CONFIG", "")
BENCH_TORRENTIO_RD_KEY = os.environ.get("BENCH_TORRENTIO_RD_KEY", "")

# ── Service Definitions ───────────────────────────────────────────────────────
SERVICES: dict[str, dict] = {
    "comet": {
        "name": "Comet",
        "unit": "comet",
        "url": f"{COMET_URL}/manifest.json",
        "ok": [200],
        "category": "streaming",
    },
    "mediafusion": {
        "name": "MediaFusion",
        "unit": "mediafusion",
        "url": f"{MEDIAFUSION_URL}/health",
        "ok": [200, 307],
        "ssl": False,
        "category": "streaming",
    },
    "stremthru": {
        "name": "StremThru",
        "unit": "stremthru",
        "url": f"{STREMTHRU_URL}/v0/health",
        "ok": [200],
        "category": "streaming",
    },
    "zilean": {
        "name": "Zilean",
        "unit": "zilean",
        "url": f"{ZILEAN_URL}/healthchecks/ping",
        "ok": [200],
        "category": "streaming",
    },
    "aiostreams": {
        "name": "AIOStreams",
        "unit": "aiostreams",
        "url": f"{AIOSTREAMS_URL}/stremio/manifest.json",
        "ok": [200, 301, 302],
        "follow_redirects": True,
        "category": "streaming",
    },
    "jackett": {
        "name": "Jackett",
        "unit": "jackett",
        "url": f"{JACKETT_URL}/api/v2.0/indexers/all/results?apikey={JACKETT_KEY}&Query=health&Limit=1",
        "ok": [200],
        "category": "indexers",
    },
    "prowlarr": {
        "name": "Prowlarr",
        "unit": "prowlarr",
        "url": f"{PROWLARR_URL}/api/v1/system/status",
        "ok": [200],
        "headers": {"X-Api-Key": PROWLARR_KEY},
        "category": "indexers",
    },
    "flaresolverr": {
        "name": "FlareSolverr",
        "unit": "flaresolverr",
        "url": f"{FLARESOLVERR_URL}/health",
        "ok": [200],
        "category": "indexers",
    },
    "byparr": {
        "name": "Byparr",
        "unit": "byparr",
        "url": f"{BYPARR_URL}/",
        "ok": [200, 301, 302],
        "follow_redirects": False,
        "category": "indexers",
    },
    "radarr": {
        "name": "Radarr",
        "unit": "radarr",
        "url": f"{RADARR_URL}/api/v3/system/status",
        "ok": [200],
        "headers": {"X-Api-Key": RADARR_KEY},
        "category": "arr",
    },
    "sonarr": {
        "name": "Sonarr",
        "unit": "sonarr",
        "url": f"{SONARR_URL}/api/v3/system/status",
        "ok": [200],
        "headers": {"X-Api-Key": SONARR_KEY},
        "category": "arr",
    },
    "lidarr": {
        "name": "Lidarr",
        "unit": "lidarr",
        "url": f"{LIDARR_URL}/api/v1/system/status",
        "ok": [200],
        "headers": {"X-Api-Key": LIDARR_KEY},
        "category": "arr",
    },
    "bazarr": {
        "name": "Bazarr",
        "unit": "bazarr",
        "url": f"{BAZARR_URL}/api/system/status",
        "ok": [200],
        "headers": {"X-Api-Key": BAZARR_KEY},
        "category": "arr",
    },
    "jellyfin": {
        "name": "Jellyfin",
        "unit": "jellyfin",
        "url": f"{JELLYFIN_URL}/System/Info/Public",
        "ok": [200],
        "category": "media",
    },
    "plex": {
        "name": "Plex",
        "unit": "plexmediaserver",
        "url": f"{PLEX_URL}/identity",
        "ok": [200],
        "category": "media",
    },
    "jellyseerr": {
        "name": "Jellyseerr",
        "unit": "jellyseerr",
        "url": f"{JELLYSEERR_URL}/api/v1/status",
        "ok": [200],
        "headers": {"X-Api-Key": JELLYSEERR_KEY},
        "follow_redirects": True,
        "category": "media",
    },
    "dispatcharr": {
        "name": "Dispatcharr",
        "unit": "dispatcharr",
        "url": f"{DISPATCHARR_URL}/",
        "ok": [200],
        "category": "dispatch",
    },
    "mediaflow": {
        "name": "MediaFlow Proxy",
        "unit": "mediaflow-proxy",
        "url": f"{MEDIAFLOW_URL}/health",
        "ok": [200],
        "category": "dispatch",
    },
    "qbittorrent": {
        "name": "qBittorrent",
        "unit": "qbittorrent-nox",
        "url": f"{QBITTORRENT_URL}/",
        "ok": [200],
        "follow_redirects": True,
        "category": "downloads",
    },
    "pgbouncer": {"name": "PgBouncer", "unit": "pgbouncer", "url": None, "category": "infra"},
    "postgresql": {"name": "PostgreSQL", "unit": "postgresql", "url": None, "category": "infra"},
    "redis": {"name": "Redis / Valkey", "unit": "valkey", "url": None, "category": "infra"},
    "system": {"name": "System", "unit": None, "url": None, "category": "system"},
}

# ── Dynamic header resolution ────────────────────────────────────────────────
# Maps service IDs to their key attribute names for live header resolution.
# This ensures health checks always use current key values, even after
# keys are updated via the Settings UI at runtime.
_SERVICE_KEY_ATTRS: dict[str, str] = {
    "prowlarr": "PROWLARR_KEY",
    "radarr": "RADARR_KEY",
    "sonarr": "SONARR_KEY",
    "lidarr": "LIDARR_KEY",
    "bazarr": "BAZARR_KEY",
    "jellyseerr": "JELLYSEERR_KEY",
}


def get_live_headers(sid: str) -> dict[str, str]:
    """Return current headers for a service, resolving API keys at call time."""
    base = dict(SERVICES.get(sid, {}).get("headers", {}))
    key_attr = _SERVICE_KEY_ATTRS.get(sid)
    if key_attr:
        key_val = globals().get(key_attr, "")
        if key_val:
            base["X-Api-Key"] = key_val
    # Jackett uses query param, not header — handle URL refresh
    if sid == "jackett":
        key_val = globals().get("JACKETT_KEY", "")
        if key_val:
            SERVICES["jackett"]["url"] = (
                f"{JACKETT_URL}/api/v2.0/indexers/all/results?apikey={key_val}&Query=health&Limit=1"
            )
    return base


# Web panel URLs for the frontend (may differ from API base URLs)
WEB_URLS: dict[str, str] = {
    "comet": COMET_URL,
    "mediafusion": MEDIAFUSION_URL,
    "stremthru": STREMTHRU_URL,
    "zilean": ZILEAN_URL,
    "aiostreams": AIOSTREAMS_URL,
    "jackett": JACKETT_URL,
    "prowlarr": PROWLARR_URL,
    "flaresolverr": FLARESOLVERR_URL,
    "byparr": BYPARR_URL,
    "radarr": RADARR_URL,
    "sonarr": SONARR_URL,
    "lidarr": LIDARR_URL,
    "bazarr": BAZARR_URL,
    "jellyfin": JELLYFIN_URL,
    "plex": f"{PLEX_URL}/web",
    "jellyseerr": JELLYSEERR_URL,
    "dispatcharr": DISPATCHARR_URL,
    "mediaflow": MEDIAFLOW_URL,
    "qbittorrent": QBITTORRENT_URL,
}

CATEGORIES: dict[str, str] = {
    "system": "System",
    "streaming": "Streaming Stack",
    "indexers": "Indexers",
    "arr": "Arr Suite",
    "media": "Media Servers",
    "dispatch": "Dispatching",
    "downloads": "Downloads",
    "infra": "Infrastructure",
}

GITHUB_REPOS: dict[str, str] = {
    "comet": "g0ldyy/comet",
    "mediafusion": "mhdzumair/MediaFusion",
    "stremthru": "MunifTanjim/stremthru",
    "zilean": "iPromKnight/zilean",
    "aiostreams": "Viren070/AIOStreams",
    "jackett": "Jackett/Jackett",
    "prowlarr": "Prowlarr/Prowlarr",
    "radarr": "Radarr/Radarr",
    "sonarr": "Sonarr/Sonarr",
    "lidarr": "Lidarr/Lidarr",
    "bazarr": "morpheus65535/bazarr",
    "jellyfin": "jellyfin/jellyfin",
    "jellyseerr": "fallenbagel/jellyseerr",
    # plex omitted — pms-docker tags are helm-chart versions, not Plex versions
    "dispatcharr": "dispatcharr/dispatcharr",
    "mediaflow": "mhdzumair/mediaflow-proxy",
    "flaresolverr": "FlareSolverr/FlareSolverr",
    "byparr": "ThePhaseless/Byparr",
    "pgbouncer": "pgbouncer/pgbouncer",
    "qbittorrent": "qbittorrent/qBittorrent",
}
