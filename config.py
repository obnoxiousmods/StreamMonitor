"""Configuration: API keys, service definitions, categories."""
from __future__ import annotations

import json
import os
import re
from pathlib import Path

# ── Key store (loaded at import, mutated at runtime via /api/settings/keys) ──
_KEY_FILE = Path(__file__).parent / "data" / "apikeys.json"

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
PROWLARR_KEY    = _k("PROWLARR_API_KEY",    "prowlarr",         "")
RADARR_KEY      = _k("RADARR_API_KEY",      "radarr",           "")
SONARR_KEY      = _k("SONARR_API_KEY",      "sonarr",           "")
LIDARR_KEY      = _k("LIDARR_API_KEY",      "lidarr",           "")
JACKETT_KEY     = _k("JACKETT_API_KEY",     "jackett",          "")
BAZARR_KEY      = _k("BAZARR_API_KEY",      "bazarr",           "")
JELLYFIN_KEY    = _k("JELLYFIN_API_KEY",    "jellyfin",         "")
JELLYSEERR_KEY  = _k("JELLYSEERR_API_KEY",  "jellyseerr",       "")
ZILEAN_KEY      = _k("ZILEAN_API_KEY",      "zilean",           "")
DISPATCHARR_USER = os.environ.get("DISPATCHARR_USER", "admin")
DISPATCHARR_PASS = _k("DISPATCHARR_PASS",  "dispatcharr_pass", "")
PLEX_TOKEN      = _k("PLEX_TOKEN",          "plex_token",       "")
GITHUB_TOKEN    = os.environ.get("GITHUB_TOKEN", "")
QBT_USER        = _k("QBT_USER",           "qbt_user",         "admin")
QBT_PASS        = _k("QBT_PASS",           "qbt_pass",         "")
STREMTHRU_USER  = "admin"
STREMTHRU_PASS  = _k("STREMTHRU_PASS",      "stremthru_pass",   "")
COMET_ADMIN_PASS = _k("COMET_ADMIN_PASS",   "comet_admin_password", "")
MEDIAFUSION_PASS      = _k("MEDIAFUSION_PASS",      "mediafusion_api_password", "")
MEDIAFUSION_EMAIL     = _k("MEDIAFUSION_EMAIL",     "mediafusion_email",        "")
MEDIAFUSION_USER_PASS = _k("MEDIAFUSION_USER_PASS", "mediafusion_password",     "")
AIOSTREAMS_SECRET = _k("AIOSTREAMS_SECRET", "aiostreams_secret", "")

# Keys that are surfaced in the Settings UI (name → current value, masked in display)
KEY_REGISTRY: dict[str, dict] = {
    "prowlarr":             {"label": "Prowlarr API Key",          "attr": "PROWLARR_KEY",    "group": "Indexers"},
    "jackett":              {"label": "Jackett API Key",           "attr": "JACKETT_KEY",     "group": "Indexers"},
    "radarr":               {"label": "Radarr API Key",            "attr": "RADARR_KEY",      "group": "Arr Suite"},
    "sonarr":               {"label": "Sonarr API Key",            "attr": "SONARR_KEY",      "group": "Arr Suite"},
    "lidarr":               {"label": "Lidarr API Key",            "attr": "LIDARR_KEY",      "group": "Arr Suite"},
    "bazarr":               {"label": "Bazarr API Key",            "attr": "BAZARR_KEY",      "group": "Arr Suite"},
    "jellyfin":             {"label": "Jellyfin API Key",          "attr": "JELLYFIN_KEY",    "group": "Media Servers"},
    "jellyseerr":           {"label": "Jellyseerr API Key",        "attr": "JELLYSEERR_KEY",  "group": "Media Servers"},
    "zilean":               {"label": "Zilean API Key",            "attr": "ZILEAN_KEY",      "group": "Streaming"},
    "stremthru_pass":       {"label": "StremThru Password",        "attr": "STREMTHRU_PASS",  "group": "Streaming"},
    "comet_admin_password": {"label": "Comet Admin Password",      "attr": "COMET_ADMIN_PASS","group": "Streaming"},
    "mediafusion_api_password": {"label": "MediaFusion Password",  "attr": "MEDIAFUSION_PASS","group": "Streaming"},
    "aiostreams_secret":    {"label": "AIOStreams Secret",         "attr": "AIOSTREAMS_SECRET","group": "Streaming"},
    "dispatcharr_pass":     {"label": "Dispatcharr Password",      "attr": "DISPATCHARR_PASS","group": "Dispatching"},
    "qbt_pass":             {"label": "qBittorrent Password",      "attr": "QBT_PASS",        "group": "Downloads"},
    "qbt_user":             {"label": "qBittorrent Username",      "attr": "QBT_USER",        "group": "Downloads"},
}

# Try to read Plex token from Preferences.xml
if not PLEX_TOKEN:
    _plex_prefs = Path("/var/lib/plex/Plex Media Server/Preferences.xml")
    try:
        if _plex_prefs.exists():
            m = re.search(r'PlexOnlineToken="([^"]+)"', _plex_prefs.read_text())
            if m:
                PLEX_TOKEN = m.group(1)
    except Exception:
        pass

# ── Service Definitions ───────────────────────────────────────────────────────
SERVICES: dict[str, dict] = {
    "comet":       {"name": "Comet",          "unit": "comet",
                    "url":  "http://127.0.0.1:8070/manifest.json",   "ok": [200], "category": "streaming"},
    "mediafusion": {"name": "MediaFusion",    "unit": "mediafusion",
                    "url":  "https://127.0.0.1:8090/health",          "ok": [200,307], "ssl": False, "category": "streaming"},
    "stremthru":   {"name": "StremThru",      "unit": "stremthru",
                    "url":  "http://127.0.0.1:8080/v0/health",        "ok": [200], "category": "streaming"},
    "zilean":      {"name": "Zilean",         "unit": "zilean",
                    "url":  "http://127.0.0.1:8181/healthchecks/ping", "ok": [200], "category": "streaming"},
    "aiostreams":  {"name": "AIOStreams",      "unit": "aiostreams",
                    "url":  "http://127.0.0.1:7070/stremio/manifest.json", "ok": [200,301,302],
                    "follow_redirects": True, "category": "streaming"},
    "jackett":     {"name": "Jackett",        "unit": "jackett",
                    "url":  f"http://127.0.0.1:9117/api/v2.0/indexers/all/results?apikey={JACKETT_KEY}&Query=health&Limit=1",
                    "ok": [200], "category": "indexers"},
    "prowlarr":    {"name": "Prowlarr",       "unit": "prowlarr",
                    "url":  "http://127.0.0.1:9696/api/v1/system/status",
                    "ok": [200], "headers": {"X-Api-Key": PROWLARR_KEY}, "category": "indexers"},
    "flaresolverr":{"name": "FlareSolverr",   "unit": "flaresolverr",
                    "url":  "http://127.0.0.1:8191/health",            "ok": [200], "category": "indexers"},
    "byparr":      {"name": "Byparr",         "unit": "byparr",
                    "url":  "http://127.0.0.1:8192/",                  "ok": [200, 301, 302],
                    "follow_redirects": False, "category": "indexers"},
    "radarr":      {"name": "Radarr",         "unit": "radarr",
                    "url":  "http://127.0.0.1:7878/api/v3/system/status",
                    "ok": [200], "headers": {"X-Api-Key": RADARR_KEY}, "category": "arr"},
    "sonarr":      {"name": "Sonarr",         "unit": "sonarr",
                    "url":  "http://127.0.0.1:8989/api/v3/system/status",
                    "ok": [200], "headers": {"X-Api-Key": SONARR_KEY}, "category": "arr"},
    "lidarr":      {"name": "Lidarr",         "unit": "lidarr",
                    "url":  "http://127.0.0.1:8686/api/v1/system/status",
                    "ok": [200], "headers": {"X-Api-Key": LIDARR_KEY}, "category": "arr"},
    "bazarr":      {"name": "Bazarr",         "unit": "bazarr",
                    "url":  "http://127.0.0.1:6767/api/system/status",
                    "ok": [200], "headers": {"X-Api-Key": BAZARR_KEY}, "category": "arr"},
    "jellyfin":    {"name": "Jellyfin",       "unit": "jellyfin",
                    "url":  "http://127.0.0.1:8096/System/Info/Public", "ok": [200], "category": "media"},
    "plex":        {"name": "Plex",           "unit": "plexmediaserver",
                    "url":  "http://127.0.0.1:32400/identity",          "ok": [200], "category": "media"},
    "jellyseerr":  {"name": "Jellyseerr",     "unit": "jellyseerr",
                    "url":  "http://127.0.0.1:5055/api/v1/status",
                    "ok": [200], "headers": {"X-Api-Key": JELLYSEERR_KEY},
                    "follow_redirects": True, "category": "media"},
    "dispatcharr": {"name": "Dispatcharr",    "unit": "dispatcharr",
                    "url":  "http://127.0.0.1:8001/",                   "ok": [200], "category": "dispatch"},
    "mediaflow":   {"name": "MediaFlow Proxy","unit": "mediaflow-proxy",
                    "url":  "http://127.0.0.1:8060/health",             "ok": [200], "category": "dispatch"},
    "qbittorrent": {"name": "qBittorrent",    "unit": "qbittorrent-nox",
                    "url":  "http://127.0.0.1:10000/",                  "ok": [200],
                    "follow_redirects": True, "category": "downloads"},
    "pgbouncer":   {"name": "PgBouncer",      "unit": "pgbouncer",      "url": None, "category": "infra"},
    "postgresql":  {"name": "PostgreSQL",     "unit": "postgresql",     "url": None, "category": "infra"},
    "redis":       {"name": "Redis / Valkey", "unit": "valkey",         "url": None, "category": "infra"},
    "system":      {"name": "System",         "unit": None,             "url": None, "category": "system"},
}

CATEGORIES: dict[str, str] = {
    "system":    "System",
    "streaming": "Streaming Stack",
    "indexers":  "Indexers",
    "arr":       "Arr Suite",
    "media":     "Media Servers",
    "dispatch":  "Dispatching",
    "downloads": "Downloads",
    "infra":     "Infrastructure",
}

GITHUB_REPOS: dict[str, str] = {
    "comet":       "g0ldyy/comet",
    "mediafusion": "mhdzumair/MediaFusion",
    "stremthru":   "MunifTanjim/stremthru",
    "zilean":      "iPromKnight/zilean",
    "aiostreams":  "Viren070/AIOStreams",
    "jackett":     "Jackett/Jackett",
    "prowlarr":    "Prowlarr/Prowlarr",
    "radarr":      "Radarr/Radarr",
    "sonarr":      "Sonarr/Sonarr",
    "lidarr":      "Lidarr/Lidarr",
    "bazarr":      "morpheus65535/bazarr",
    "jellyfin":    "jellyfin/jellyfin",
    "jellyseerr":  "fallenbagel/jellyseerr",
    # plex omitted — pms-docker tags are helm-chart versions, not Plex versions
    "dispatcharr": "dispatcharr/dispatcharr",
    "mediaflow":   "mhdzumair/mediaflow-proxy",
    "flaresolverr":"FlareSolverr/FlareSolverr",
    "byparr":      "ThePhaseless/Byparr",
    "pgbouncer":   "pgbouncer/pgbouncer",
    "qbittorrent": "qbittorrent/qBittorrent",
}
