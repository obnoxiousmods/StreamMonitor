"""Deep networking collector: per-NIC breakdown, TCP connection states, retransmits,
DNS timing, WAN/gateway health, public IP tracking, TLS cert expiry."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import re
import socket
import ssl
import time
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

import httpx

from core.config import SERVICES
from core.process import run_command

try:
    import psutil

    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False

logger = logging.getLogger(__name__)

_VIRT_PAT = re.compile(r"^(lo|docker|veth|br-|virbr|tun|tap)")


def _is_real_hostname(host: str | None) -> bool:
    """True for a DNS-resolvable name, not a loopback/private IP literal."""
    if not host or host == "localhost":
        return False
    try:
        ipaddress.ip_address(host)
        return False  # it's an IP literal, not a hostname worth DNS/cert-checking
    except ValueError:
        return True

# ── Rate tracking (previous per-NIC sample) ──────────────────────────────────
_prev_nic_io: dict[str, object] = {}
_prev_nic_time: float = 0.0

# ── Cached slow-changing data (public IP, TLS certs) ─────────────────────────
_PUBLIC_IP_TTL = 300  # 5 min
_public_ip_cache: dict = {"ip": None, "ts": 0.0, "history": []}

_CERT_TTL = 3600  # 1 hour — cert expiry doesn't need to be checked every collector tick
_cert_cache: dict[str, dict] = {}

_IPIFY_URLS = [
    "https://api.ipify.org",
    "https://ifconfig.me/ip",
    "https://icanhazip.com",
    "https://checkip.amazonaws.com",
]


# ── Per-NIC breakdown ─────────────────────────────────────────────────────────


def _collect_nics_sync() -> list[dict]:
    global _prev_nic_io, _prev_nic_time
    if not _HAS_PSUTIL:
        return []

    now = time.time()
    per_nic = psutil.net_io_counters(pernic=True)
    nic_stats = psutil.net_if_stats()

    nics = []
    for name, counters in per_nic.items():
        if _VIRT_PAT.match(name):
            continue
        stats = nic_stats.get(name)
        entry: dict = {
            "name": name,
            "is_up": bool(stats.isup) if stats else None,
            "speed_mbps": stats.speed if stats else 0,
            "duplex": {0: "unknown", 1: "half", 2: "full"}.get(stats.duplex, "unknown") if stats else "unknown",
            "mtu": stats.mtu if stats else None,
            "errors_in": counters.errin,
            "errors_out": counters.errout,
            "drops_in": counters.dropin,
            "drops_out": counters.dropout,
            "recv_total_gb": round(counters.bytes_recv / 1024**3, 2),
            "sent_total_gb": round(counters.bytes_sent / 1024**3, 2),
        }

        prev = _prev_nic_io.get(name)
        if prev is not None and _prev_nic_time:
            dt = now - _prev_nic_time
            if dt > 0:
                entry["recv_bytes_s"] = round(max(0.0, (counters.bytes_recv - prev.bytes_recv) / dt))
                entry["sent_bytes_s"] = round(max(0.0, (counters.bytes_sent - prev.bytes_sent) / dt))

        nics.append(entry)

    _prev_nic_io = per_nic
    _prev_nic_time = now
    return nics


async def collect_nics() -> list[dict]:
    return await asyncio.get_running_loop().run_in_executor(None, _collect_nics_sync)


# ── TCP connection states + per-service connection counts ───────────────────

_SERVICE_PORTS: dict[int, str] = {}
for _sid, _cfg in SERVICES.items():
    _url = _cfg.get("url")
    if _url:
        try:
            port = urlparse(_url).port
            if port:
                _SERVICE_PORTS[port] = _sid
        except ValueError:
            pass


def _collect_connections_sync() -> dict:
    if not _HAS_PSUTIL:
        return {}
    by_state: dict[str, int] = {}
    by_service: dict[str, int] = {}
    try:
        for c in psutil.net_connections(kind="tcp"):
            by_state[c.status] = by_state.get(c.status, 0) + 1
            for addr in (c.laddr, c.raddr):
                if addr and addr.port in _SERVICE_PORTS:
                    sid = _SERVICE_PORTS[addr.port]
                    by_service[sid] = by_service.get(sid, 0) + 1
                    break
    except (psutil.AccessDenied, PermissionError):
        logger.debug("net_connections requires elevated privileges — skipping")
        return {}
    return {"by_state": by_state, "by_service": by_service, "total": sum(by_state.values())}


async def collect_connections() -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, _collect_connections_sync)


# ── TCP retransmits (/proc/net/snmp) ─────────────────────────────────────────

_prev_tcp_snmp: dict | None = None
_prev_tcp_snmp_time: float = 0.0


def _read_tcp_snmp() -> dict | None:
    try:
        text = Path("/proc/net/snmp").read_text()
    except OSError:
        return None
    lines = text.splitlines()
    for i, line in enumerate(lines):
        if line.startswith("Tcp:") and i + 1 < len(lines):
            header = line.split()[1:]
            values = lines[i + 1].split()[1:]
            try:
                return dict(zip(header, (int(v) for v in values), strict=False))
            except ValueError:
                return None
    return None


def _collect_tcp_health_sync() -> dict:
    global _prev_tcp_snmp, _prev_tcp_snmp_time
    snmp = _read_tcp_snmp()
    if not snmp:
        return {}
    now = time.time()
    result = {
        "curr_established": snmp.get("CurrEstab"),
        "in_errs": snmp.get("InErrs"),
        "retrans_segs_total": snmp.get("RetransSegs"),
    }
    if _prev_tcp_snmp and _prev_tcp_snmp_time:
        dt = now - _prev_tcp_snmp_time
        if dt > 0:
            out_segs_delta = snmp.get("OutSegs", 0) - _prev_tcp_snmp.get("OutSegs", 0)
            retrans_delta = snmp.get("RetransSegs", 0) - _prev_tcp_snmp.get("RetransSegs", 0)
            if out_segs_delta > 0:
                result["retrans_rate_pct"] = round(max(0.0, retrans_delta / out_segs_delta) * 100, 3)
    _prev_tcp_snmp = snmp
    _prev_tcp_snmp_time = now
    return result


async def collect_tcp_health() -> dict:
    return await asyncio.get_running_loop().run_in_executor(None, _collect_tcp_health_sync)


# ── DNS resolution timing ────────────────────────────────────────────────────


_EXTERNAL_DNS_CHECK_HOSTS = ("cloudflare.com", "1.1.1.1.nip.io")


def _read_resolv_conf() -> dict:
    nameservers: list[str] = []
    search: list[str] = []
    try:
        text = Path("/etc/resolv.conf").read_text()
        for line in text.splitlines():
            line = line.strip()
            if line.startswith("nameserver "):
                nameservers.append(line.split(maxsplit=1)[1].strip())
            elif line.startswith("search "):
                search = line.split()[1:]
    except OSError:
        pass
    # systemd-resolved's stub listener — note it, since the "real" upstream
    # servers live in `resolvectl status`, not resolv.conf, when this is set.
    stub = "127.0.0.53" in nameservers
    return {"nameservers": nameservers, "search": search, "systemd_resolved_stub": stub}


async def collect_dns_timing() -> dict:
    hosts = {"monitor.obby.ca", *_EXTERNAL_DNS_CHECK_HOSTS}
    for cfg in SERVICES.values():
        url = cfg.get("url")
        if url:
            host = urlparse(url).hostname
            if _is_real_hostname(host):
                hosts.add(host)

    loop = asyncio.get_running_loop()
    results: dict[str, dict] = {}

    async def _resolve(host: str) -> None:
        t0 = time.monotonic()
        try:
            addrs = await asyncio.wait_for(loop.getaddrinfo(host, None), timeout=3)
            ips = sorted({a[4][0] for a in addrs})
            results[host] = {"ok": True, "ms": round((time.monotonic() - t0) * 1000, 1), "addresses": ips[:4]}
        except Exception as e:
            results[host] = {"ok": False, "ms": None, "error": str(e)[:80]}

    await asyncio.gather(*(_resolve(h) for h in hosts), return_exceptions=True)
    return {"resolver": _read_resolv_conf(), "hosts": results}


# ── WAN / gateway health (ping) ───────────────────────────────────────────────

_PING_LOSS_RE = re.compile(r"(\d+)% packet loss")
_PING_RTT_RE = re.compile(r"= [\d.]+/([\d.]+)/")


async def _ping(host: str, count: int = 3) -> dict:
    try:
        result = await run_command(["ping", "-c", str(count), "-W", "1", host], timeout=count + 3)
    except Exception as e:
        return {"host": host, "ok": False, "error": str(e)[:80]}
    loss_m = _PING_LOSS_RE.search(result.stdout)
    rtt_m = _PING_RTT_RE.search(result.stdout)
    loss = int(loss_m.group(1)) if loss_m else None
    return {
        "host": host,
        "ok": result.returncode == 0,
        "loss_pct": loss,
        "avg_rtt_ms": round(float(rtt_m.group(1)), 1) if rtt_m else None,
    }


async def _default_gateway() -> str | None:
    try:
        result = await run_command(["ip", "route", "show", "default"], timeout=3)
    except Exception:
        return None
    m = re.search(r"default via (\S+)", result.stdout)
    return m.group(1) if m else None


async def collect_wan_health() -> dict:
    gateway = await _default_gateway()
    targets = [("gateway", gateway)] if gateway else []
    targets.append(("cloudflare_dns", "1.1.1.1"))
    pings = await asyncio.gather(*(_ping(host) for _, host in targets if host), return_exceptions=True)
    out = {}
    for (label, host), res in zip(targets, pings, strict=False):
        if host and isinstance(res, dict):
            out[label] = res
    return out


# ── Public IP tracking ────────────────────────────────────────────────────────


async def collect_public_ip() -> dict:
    now = time.time()
    if _public_ip_cache["ip"] and now - _public_ip_cache["ts"] < _PUBLIC_IP_TTL:
        return {"ip": _public_ip_cache["ip"], "history": _public_ip_cache["history"][-20:]}

    ip = None
    async with httpx.AsyncClient(timeout=5) as client:
        for url in _IPIFY_URLS:
            try:
                r = await client.get(url)
                candidate = r.text.strip()
                if candidate and re.match(r"^[\da-fA-F.:]+$", candidate):
                    ip = candidate
                    break
            except Exception:
                continue

    if ip and ip != _public_ip_cache["ip"]:
        _public_ip_cache["history"].append({"ip": ip, "ts": datetime.now(UTC).isoformat()})
        _public_ip_cache["history"] = _public_ip_cache["history"][-20:]
    if ip:
        _public_ip_cache["ip"] = ip
    _public_ip_cache["ts"] = now
    return {"ip": _public_ip_cache["ip"], "history": _public_ip_cache["history"][-20:]}


# ── TLS certificate expiry ────────────────────────────────────────────────────


def _fetch_cert_expiry_sync(host: str, port: int = 443) -> dict:
    ctx = ssl.create_default_context()
    try:
        with socket.create_connection((host, port), timeout=5) as sock, ctx.wrap_socket(sock, server_hostname=host) as tls:
            cert = tls.getpeercert()
        not_after = cert.get("notAfter")
        if not not_after:
            return {"ok": False, "error": "no notAfter field"}
        expires = datetime.strptime(not_after, "%b %d %H:%M:%S %Y %Z").replace(tzinfo=UTC)
        days_left = (expires - datetime.now(UTC)).days
        return {"ok": True, "expires_at": expires.isoformat(), "days_remaining": days_left}
    except Exception as e:
        return {"ok": False, "error": str(e)[:120]}


async def collect_cert_expiry() -> dict:
    hosts = {"monitor.obby.ca"}
    for cfg in SERVICES.values():
        url = cfg.get("url")
        if url and url.startswith("https://"):
            host = urlparse(url).hostname
            if _is_real_hostname(host):
                hosts.add(host)

    now = time.time()
    loop = asyncio.get_running_loop()
    results: dict[str, dict] = {}
    for host in hosts:
        cached = _cert_cache.get(host)
        if cached and now - cached["ts"] < _CERT_TTL:
            results[host] = cached["data"]
            continue
        data = await loop.run_in_executor(None, _fetch_cert_expiry_sync, host)
        _cert_cache[host] = {"ts": now, "data": data}
        results[host] = data
    return results


# ── Combined collector ────────────────────────────────────────────────────────


async def collect_network() -> dict:
    nics, connections, tcp_health, dns, wan, public_ip, certs = await asyncio.gather(
        collect_nics(),
        collect_connections(),
        collect_tcp_health(),
        collect_dns_timing(),
        collect_wan_health(),
        collect_public_ip(),
        collect_cert_expiry(),
        return_exceptions=True,
    )
    return {
        "nics": nics if isinstance(nics, list) else [],
        "connections": connections if isinstance(connections, dict) else {},
        "tcp": tcp_health if isinstance(tcp_health, dict) else {},
        "dns": dns if isinstance(dns, dict) else {},
        "wan": wan if isinstance(wan, dict) else {},
        "public_ip": public_ip if isinstance(public_ip, dict) else {},
        "certs": certs if isinstance(certs, dict) else {},
    }
