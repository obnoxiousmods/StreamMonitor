"""Permissions scanner and fixer for service directories and media libraries."""

from __future__ import annotations

import asyncio
import grp
import pwd
import stat
from pathlib import Path

# (label, path, expected_user, expected_group, expected_mode_octal, group_section)
SCAN_TARGETS: list[tuple[str, str, str, str, int, str]] = [
    # ── Streaming services ────────────────────────────────────────────────────
    ("Comet", "/home/comet/comet", "comet", "media", 0o774, "Streaming"),
    ("StreamMonitor", "/home/comet/streammonitor", "comet", "media", 0o774, "Streaming"),
    ("MediaFusion", "/home/mediafusion/MediaFusion", "mediafusion", "media", 0o774, "Streaming"),
    ("StremThru", "/home/stremthru", "stremthru", "media", 0o774, "Streaming"),
    ("Zilean", "/home/zilean", "zilean", "media", 0o774, "Streaming"),
    ("MediaFlow", "/home/mediaflow", "mediaflow", "media", 0o774, "Streaming"),
    ("AIOStreams", "/home/s", "s", "media", 0o774, "Streaming"),
    # ── Indexers ─────────────────────────────────────────────────────────────
    ("Prowlarr", "/var/lib/prowlarr", "prowlarr", "media", 0o774, "Indexers"),
    ("Jackett", "/var/lib/jackett", "jackett", "media", 0o774, "Indexers"),
    ("FlareSolverr", "/home/flaresolverr", "flaresolverr", "media", 0o774, "Indexers"),
    # ── Arr suite ─────────────────────────────────────────────────────────────
    ("Radarr", "/var/lib/radarr", "radarr", "media", 0o774, "Arr Suite"),
    ("Sonarr", "/var/lib/sonarr", "sonarr", "media", 0o774, "Arr Suite"),
    ("Lidarr", "/var/lib/lidarr", "lidarr", "media", 0o774, "Arr Suite"),
    ("Bazarr", "/var/lib/bazarr", "bazarr", "media", 0o774, "Arr Suite"),
    ("Bazarr (opt)", "/opt/bazarr", "bazarr", "media", 0o774, "Arr Suite"),
    # ── Media servers ─────────────────────────────────────────────────────────
    ("Jellyfin", "/var/lib/jellyfin", "jellyfin", "media", 0o774, "Media Servers"),
    ("Plex", "/var/lib/plex", "plex", "media", 0o774, "Media Servers"),
    ("Jellyseerr", "/home/jellyseerr", "jellyseerr", "media", 0o774, "Media Servers"),
    # ── Dispatching & requests ────────────────────────────────────────────────
    ("Dispatcharr", "/home/dispatcharr/dispatcharr", "dispatcharr", "media", 0o774, "Dispatching"),
    ("Requestrr", "/home/requestrr", "requestrr", "media", 0o774, "Dispatching"),
    ("Wizarr", "/home/wizarr", "wizarr", "media", 0o774, "Dispatching"),
    # ── Music / slskd ─────────────────────────────────────────────────────────
    ("slskd (data)", "/var/lib/slskd", "slskd", "media", 0o774, "Music"),
    ("slskd (dl)", "/1TB4/slskd", "slskd", "media", 0o774, "Music"),
    ("Soularr", "/home/soularr", "soularr", "media", 0o774, "Music"),
    ("SoulSync", "/home/soulsync", "soulsync", "media", 0o774, "Music"),
    # ── Downloads ────────────────────────────────────────────────────────────
    ("qBittorrent", "/var/lib/qbittorrent", "qbt", "media", 0o774, "Downloads"),
    ("qBt data /1TB4", "/1TB4/data", "qbt", "media", 0o774, "Downloads"),
    ("qBt /10TB", "/10TB/qbt", "qbt", "media", 0o774, "Downloads"),
    ("qBt /10TB2", "/10TB2/qbt", "qbt", "media", 0o774, "Downloads"),
    # ── Movies libraries ─────────────────────────────────────────────────────
    ("Movies /1TB", "/1TB/movies", "radarr", "media", 0o774, "Movies"),
    ("Movies /1TB2", "/1TB2/movies", "radarr", "media", 0o774, "Movies"),
    ("Movies /1TB3", "/1TB3/movies", "radarr", "media", 0o774, "Movies"),
    ("Movies /1TB4", "/1TB4/movies", "radarr", "media", 0o774, "Movies"),
    ("Movies /10TB", "/10TB/movies", "radarr", "media", 0o774, "Movies"),
    ("Movies /10TB2", "/10TB2/movies", "radarr", "media", 0o774, "Movies"),
    # ── TV libraries ─────────────────────────────────────────────────────────
    ("TV /1TB", "/1TB/tvShows", "sonarr", "media", 0o774, "TV Shows"),
    ("TV /1TB2", "/1TB2/tvShows", "sonarr", "media", 0o774, "TV Shows"),
    ("TV /1TB3", "/1TB3/tvShows", "sonarr", "media", 0o774, "TV Shows"),
    ("TV /1TB4", "/1TB4/tvShows", "sonarr", "media", 0o774, "TV Shows"),
    ("TV /10TB", "/10TB/tvShows", "sonarr", "media", 0o774, "TV Shows"),
    # ── Music libraries ───────────────────────────────────────────────────────
    ("Music /1TB", "/1TB/music", "lidarr", "media", 0o774, "Music Libraries"),
    ("Music /1TB2", "/1TB2/music", "lidarr", "media", 0o774, "Music Libraries"),
    ("Music /1TB3", "/1TB3/music", "lidarr", "media", 0o774, "Music Libraries"),
    ("Music /1TB4", "/1TB4/music", "lidarr", "media", 0o774, "Music Libraries"),
    ("Music /10TB", "/10TB/music", "lidarr", "media", 0o774, "Music Libraries"),
    ("Music /10TB2", "/10TB2/music", "lidarr", "media", 0o774, "Music Libraries"),
    # ── Jellyfin cache/metadata ───────────────────────────────────────────────
    ("JF Cache /1TB4", "/1TB4/jellyfincache", "jellyfin", "media", 0o774, "Jellyfin"),
    ("JF Meta /1TB4", "/1TB4/jellyfinmetadata", "jellyfin", "media", 0o774, "Jellyfin"),
    # ── Infrastructure ────────────────────────────────────────────────────────
    ("PgBouncer", "/etc/pgbouncer", "pgbouncer", "pgbouncer", 0o750, "Infrastructure"),
    ("PostgreSQL", "/var/lib/postgres", "postgres", "postgres", 0o700, "Infrastructure"),
    # ── Drive root dirs ───────────────────────────────────────────────────────
    ("/1TB", "/1TB", "joey", "media", 0o774, "Storage Roots"),
    ("/1TB2", "/1TB2", "joey", "media", 0o774, "Storage Roots"),
    ("/1TB3", "/1TB3", "joey", "media", 0o774, "Storage Roots"),
    ("/1TB4", "/1TB4", "joey", "media", 0o774, "Storage Roots"),
    ("/10TB", "/10TB", "joey", "media", 0o774, "Storage Roots"),
    ("/10TB2", "/10TB2", "joey", "media", 0o774, "Storage Roots"),
]


def _stat_entry(label: str, path: str, exp_user: str, exp_group: str, exp_mode: int, section: str) -> dict:
    exp_mode_str = oct(exp_mode)[2:]
    p = Path(path)
    base = {
        "label": label,
        "path": path,
        "section": section,
        "exp_user": exp_user,
        "exp_group": exp_group,
        "exp_mode": exp_mode_str,
    }
    if not p.exists():
        return base | {
            "exists": False,
            "missing": True,
            "cur_user": "—",
            "cur_group": "—",
            "cur_mode": "—",
            "ok": False,
        }
    try:
        s = p.stat()
        try:
            cur_user = pwd.getpwuid(s.st_uid).pw_name
        except KeyError:
            cur_user = str(s.st_uid)
        try:
            cur_group = grp.getgrgid(s.st_gid).gr_name
        except KeyError:
            cur_group = str(s.st_gid)
        cur_mode = oct(stat.S_IMODE(s.st_mode))[2:]
        ok = cur_user == exp_user and cur_group == exp_group and cur_mode == exp_mode_str
        return base | {
            "exists": True,
            "missing": False,
            "cur_user": cur_user,
            "cur_group": cur_group,
            "cur_mode": cur_mode,
            "ok": ok,
        }
    except Exception as e:
        return base | {
            "exists": True,
            "missing": False,
            "cur_user": "?",
            "cur_group": "?",
            "cur_mode": "?",
            "ok": False,
            "error": str(e),
        }


def scan_perms() -> list[dict]:
    return [_stat_entry(lbl, path, u, g, m, sec) for lbl, path, u, g, m, sec in SCAN_TARGETS]


async def apply_fix(path: str, user: str, group: str, mode: str, recursive: bool) -> dict:
    """chown then chmod via sudo."""
    flags = ["-R"] if recursive else []
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo",
            "chown",
            *flags,
            f"{user}:{group}",
            path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            return {"path": path, "ok": False, "error": f"chown: {err.decode().strip()[:120]}"}
    except Exception as e:
        return {"path": path, "ok": False, "error": f"chown: {e}"}
    try:
        proc = await asyncio.create_subprocess_exec(
            "sudo",
            "chmod",
            *flags,
            mode,
            path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        _, err = await asyncio.wait_for(proc.communicate(), timeout=30)
        if proc.returncode != 0:
            return {"path": path, "ok": False, "error": f"chmod: {err.decode().strip()[:120]}"}
    except Exception as e:
        return {"path": path, "ok": False, "error": f"chmod: {e}"}
    return {"path": path, "ok": True}


__all__ = ["SCAN_TARGETS", "apply_fix", "scan_perms"]
