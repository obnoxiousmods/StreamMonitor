"""GitHub release version checker."""
from __future__ import annotations

import asyncio
import time

import httpx

import config as cfg
from stats.base import _get, github_versions

GITHUB_INTERVAL = 21600  # 6 hours


async def fetch_github_version(sid: str, repo: str) -> None:
    h: dict[str, str] = {"Accept": "application/vnd.github+json",
                          "X-GitHub-Api-Version": "2022-11-28"}
    if cfg.GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {cfg.GITHUB_TOKEN}"
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as c:
            data = await _get(c, f"https://api.github.com/repos/{repo}/releases/latest", h)
        if isinstance(data, dict):
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
    from config import GITHUB_REPOS
    tasks = [fetch_github_version(sid, repo) for sid, repo in GITHUB_REPOS.items()]
    await asyncio.gather(*tasks, return_exceptions=True)
