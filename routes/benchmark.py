"""Benchmark: compare self-hosted vs public addon stream endpoints."""

from __future__ import annotations

import asyncio
import re
import time
from datetime import UTC, datetime

import httpx
from starlette.requests import Request
from starlette.responses import JSONResponse

import core.config as cfg

# ── Title dictionary ──────────────────────────────────────────────────────────
TITLES = {
    # Popular Movies
    "tt0468569": "The Dark Knight",
    "tt1375666": "Inception",
    "tt0111161": "Shawshank Redemption",
    "tt0816692": "Interstellar",
    "tt15398776": "Oppenheimer",
    "tt6718170": "The Super Mario Bros Movie",
    "tt1517268": "Barbie",
    "tt9362722": "Spider-Man Across the Spider-Verse",
    # Niche Movies
    "tt0118799": "Life Is Beautiful",
    "tt0087843": "Once Upon a Time in America",
    "tt0347149": "Howls Moving Castle",
    "tt6751668": "Parasite",
    "tt5311514": "Your Name",
    # Popular TV
    "tt0903747": "Breaking Bad",
    "tt0944947": "Game of Thrones",
    "tt2861424": "Rick and Morty",
    "tt7366338": "Chernobyl",
    "tt11280740": "Severance",
    # Niche TV
    "tt2085059": "Black Mirror",
    "tt0306414": "The Wire",
    "tt5491994": "Planet Earth II",
    # Popular Anime
    "tt0388629": "Naruto Shippuden",
    "tt0877057": "Death Note",
    "tt0434706": "Fullmetal Alchemist Brotherhood",
    "tt10919420": "Demon Slayer",
    "tt5370118": "My Hero Academia",
    # Niche Anime
    "tt0245429": "Spirited Away",
    "tt1355642": "Steins Gate",
    "tt2098220": "Hunter x Hunter",
    "tt0112159": "Neon Genesis Evangelion",
    "tt6105098": "Made in Abyss",
    # TV Episodes
    "tt0903747:3:7": "Breaking Bad S03E07",
    "tt0944947:4:9": "Game of Thrones S04E09",
    "tt2861424:5:3": "Rick and Morty S05E03",
    "tt0306414:3:11": "The Wire S03E11",
    "tt4574334:2:7": "Stranger Things S02E07",
    "tt2560140:2:6": "Attack on Titan S02E06",
    "tt0877057:1:25": "Death Note S01E25",
    "tt11280740:1:7": "Severance S01E07",
}

_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# ── Endpoint definitions ──────────────────────────────────────────────────────


def _build_endpoints(imdb_raw: str):
    """Return list of endpoint dicts for given IMDB id (may contain :season:episode)."""
    is_episode = ":" in imdb_raw
    media_type = "series" if is_episode else "movie"

    # For Zilean we need a title query
    base_imdb = imdb_raw.split(":")[0]
    title = TITLES.get(imdb_raw) or TITLES.get(base_imdb) or "Unknown"
    # Strip episode suffix like S03E07 for Zilean query
    zilean_query = re.sub(r"\s*S\d+E\d+$", "", title)

    endpoints: list[dict] = []

    # Self-hosted (only include if config token is set)
    if cfg.BENCH_COMET_CONFIG:
        endpoints.append(
            {
                "name": "Comet",
                "group": "self-hosted",
                "url": f"{cfg.COMET_URL}/{cfg.BENCH_COMET_CONFIG}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    endpoints.append(
        {
            "name": "Zilean",
            "group": "self-hosted",
            "url": f"{cfg.ZILEAN_URL}/dmm/filtered?Query={zilean_query}&limit=100",
            "zilean": True,
        }
    )

    if cfg.BENCH_MEDIAFUSION_CONFIG:
        endpoints.append(
            {
                "name": "MediaFusion",
                "group": "self-hosted",
                "url": f"{cfg.MEDIAFUSION_URL}/{cfg.BENCH_MEDIAFUSION_CONFIG}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    if cfg.BENCH_STREMTHRU_CONFIG:
        st_conf = cfg.BENCH_STREMTHRU_CONFIG
        endpoints.append(
            {
                "name": "StremThru Torz",
                "group": "self-hosted",
                "url": f"{cfg.STREMTHRU_URL}/stremio/torz/{st_conf}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    if cfg.BENCH_AIOSTREAMS_CONFIG:
        aio_conf = cfg.BENCH_AIOSTREAMS_CONFIG
        endpoints.append(
            {
                "name": "AIOStreams",
                "group": "self-hosted",
                "url": f"{cfg.AIOSTREAMS_URL}/stremio/{aio_conf}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    # Public versions of self-hosted services (for comparison)
    if cfg.BENCH_COMET_CONFIG:
        endpoints.append(
            {
                "name": "Comet (elfhosted)",
                "group": "public",
                "url": f"https://comet.elfhosted.com/{cfg.BENCH_COMET_CONFIG}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    if cfg.BENCH_MEDIAFUSION_CONFIG:
        # Use the elfhosted public MF configs from AIOStreams
        mf_public_config = "ce696a40844717488c7fbacab6cb4561d2283b3e4e12f8abe7b5ce4f7a6eb9de"
        endpoints.append(
            {
                "name": "MediaFusion (elfhosted)",
                "group": "public",
                "url": f"https://mediafusion.elfhosted.com/{mf_public_config}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    if cfg.BENCH_STREMTHRU_CONFIG:
        endpoints.append(
            {
                "name": "StremThru (13377001)",
                "group": "public",
                "url": f"https://stremthru.13377001.xyz/stremio/torz/{cfg.BENCH_STREMTHRU_CONFIG}/stream/{media_type}/{imdb_raw}.json",
            }
        )

    return endpoints


# ── Resolution / codec parsing ────────────────────────────────────────────────

_RES_PAT = {
    "4k": re.compile(r"(?:2160|4k|uhd)", re.I),
    "1080p": re.compile(r"1080", re.I),
    "720p": re.compile(r"720", re.I),
}
_CODEC_PAT = {
    "HEVC": re.compile(r"(?:hevc|h\.?265|x\.?265)", re.I),
    "AV1": re.compile(r"\bav1\b", re.I),
    "AVC": re.compile(r"(?:avc|h\.?264|x\.?264)", re.I),
}


def _parse_streams(data: dict | list, *, zilean: bool = False) -> dict:
    """Parse stream list and extract resolution/codec counts."""
    if zilean:
        streams = data if isinstance(data, list) else []
    else:
        streams = data.get("streams", []) if isinstance(data, dict) else []

    count = len(streams)
    res_counts = {"4k": 0, "1080p": 0, "720p": 0}
    codec_counts: dict[str, int] = {}

    for s in streams:
        # Zilean entries have raw_title; stremio addons use title or name or description
        title = ""
        if zilean:
            title = s.get("raw_title", "") or s.get("filename", "")
        else:
            title = s.get("title", "") or s.get("name", "") or s.get("description", "")

        for res, pat in _RES_PAT.items():
            if pat.search(title):
                res_counts[res] += 1
                break  # only count first match

        for codec, pat in _CODEC_PAT.items():
            if pat.search(title):
                codec_counts[codec] = codec_counts.get(codec, 0) + 1
                break

    top_codec = max(codec_counts, key=codec_counts.get) if codec_counts else None
    return {
        "streams": count,
        "resolutions": res_counts,
        "top_codec": top_codec,
        "codec_counts": codec_counts,
    }


# ── Single endpoint benchmark ────────────────────────────────────────────────


async def _bench_one(ep: dict) -> dict:
    """Benchmark a single endpoint: measure latency, parse streams."""
    result = {
        "name": ep["name"],
        "group": ep["group"],
        "url": ep["url"],
        "latency_ms": None,
        "streams": 0,
        "resolutions": {"4k": 0, "1080p": 0, "720p": 0},
        "top_codec": None,
        "codec_counts": {},
        "error": None,
    }
    try:
        async with httpx.AsyncClient(
            verify=False,
            follow_redirects=True,
            timeout=45,
            http2=True,
        ) as client:
            t0 = time.monotonic()
            resp = await client.get(ep["url"], headers={"User-Agent": _UA})
            latency = int((time.monotonic() - t0) * 1000)
            result["latency_ms"] = latency

            if resp.status_code != 200:
                result["error"] = f"HTTP {resp.status_code}"
                return result

            # Guard against non-JSON responses (HTML error pages, etc.)
            ct = resp.headers.get("content-type", "")
            body = resp.text
            if not ("json" in ct or body.lstrip().startswith(("{", "["))):
                preview = body[:120].replace("\n", " ").strip()
                result["error"] = f"non-JSON response: {preview}"
                return result

            try:
                data = resp.json()
            except Exception:
                preview = body[:120].replace("\n", " ").strip()
                result["error"] = f"invalid JSON: {preview}"
                return result

            parsed = _parse_streams(data, zilean=ep.get("zilean", False))
            result.update(parsed)
    except httpx.TimeoutException:
        result["error"] = "timeout"
    except Exception as e:
        result["error"] = str(e)[:200]
    return result


# ── API endpoint ──────────────────────────────────────────────────────────────


async def api_benchmark(request: Request):
    """Run benchmarks for a given IMDB id across all endpoints."""
    imdb = request.query_params.get("imdb", "").strip()
    if not imdb:
        return JSONResponse({"error": "imdb parameter required"}, status_code=400)

    base_imdb = imdb.split(":")[0]
    title = TITLES.get(imdb) or TITLES.get(base_imdb) or "Unknown"
    endpoints = _build_endpoints(imdb)

    # Warn about unconfigured endpoints
    _config_map = {
        "Comet": "BENCH_COMET_CONFIG",
        "MediaFusion": "BENCH_MEDIAFUSION_CONFIG",
        "StremThru Torz": "BENCH_STREMTHRU_CONFIG",
        "AIOStreams": "BENCH_AIOSTREAMS_CONFIG",
    }
    skipped = [{"name": name, "env_var": var} for name, var in _config_map.items() if not getattr(cfg, var, "")]

    results = await asyncio.gather(*[_bench_one(ep) for ep in endpoints])

    # Compute summary
    sh = [r for r in results if r["group"] == "self-hosted" and r["error"] is None]
    pub = [r for r in results if r["group"] == "public" and r["error"] is None]

    sh_streams = sum(r["streams"] for r in sh)
    sh_avg_lat = int(sum(r["latency_ms"] for r in sh) / len(sh)) if sh else None
    pub_streams = sum(r["streams"] for r in pub)
    pub_avg_lat = int(sum(r["latency_ms"] for r in pub) / len(pub)) if pub else None

    payload: dict = {
        "imdb": imdb,
        "title": title,
        "timestamp": datetime.now(UTC).isoformat(),
        "results": results,
        "summary": {
            "self_hosted": {"total_streams": sh_streams, "avg_latency_ms": sh_avg_lat},
            "public": {"total_streams": pub_streams, "avg_latency_ms": pub_avg_lat},
        },
    }
    if skipped:
        payload["skipped"] = skipped

    return JSONResponse(payload)
