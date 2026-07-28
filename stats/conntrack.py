"""Per-IP bandwidth: parses /proc/net/nf_conntrack (via a narrow sudoers grant,
see /etc/sudoers.d/streammonitor) for cumulative bytes/packets per connection,
delta-accounts them into a running per-remote-IP total + rate.

Requires net.netfilter.nf_conntrack_acct=1 (enabled host-wide, see
/etc/sysctl.d/99-streammonitor-conntrack.conf) — without it, conntrack entries
carry no packets=/bytes= fields and this collector reports nothing.
"""

from __future__ import annotations

import logging
import re
import time

import psutil

from core.process import run_command

logger = logging.getLogger(__name__)

_CONN_RE = re.compile(
    r"^\S+\s+\d+\s+(?P<proto>\w+)\s+\d+\s+\d+.*?"
    r"src=(?P<osrc>\S+)\s+dst=(?P<odst>\S+)\s+sport=(?P<osport>\d+)\s+dport=(?P<odport>\d+)"
    r"(?:\s+packets=\d+\s+bytes=(?P<obytes>\d+))?"
    r".*?"
    r"src=(?P<rsrc>\S+)\s+dst=(?P<rdst>\S+)\s+sport=(?P<rsport>\d+)\s+dport=(?P<rdport>\d+)"
    r"(?:\s+packets=\d+\s+bytes=(?P<rbytes>\d+))?"
)

# 5-tuple -> last-seen cumulative bytes for that specific connection (delta baseline)
_prev_conn_bytes: dict[tuple, int] = {}
# remote_ip -> cumulative bytes ever attributed (monotonic for the life of the process)
_ip_cumulative: dict[str, int] = {}
_prev_poll_time: float = 0.0

# pid -> cumulative bytes ever attributed (requires CAP_SYS_PTRACE to map sockets of
# processes owned by other users — see AmbientCapabilities in the systemd unit)
_pid_cumulative: dict[int, int] = {}
# Last-computed per-pid network snapshot, read by routes/processes.py on each request
# (the conntrack parse itself only runs on the "netips" collector's own interval).
_last_pid_network: dict[int, dict] = {}


def get_pid_network_snapshot() -> dict[int, dict]:
    return _last_pid_network


def _local_ips() -> set[str]:
    ips = {"127.0.0.1", "::1"}
    try:
        for addrs in psutil.net_if_addrs().values():
            for a in addrs:
                if a.family.name in ("AF_INET", "AF_INET6"):
                    ips.add(a.address.split("%")[0])
    except Exception:
        pass
    return ips


async def _read_conntrack() -> str:
    result = await run_command(["sudo", "cat", "/proc/net/nf_conntrack"], timeout=10)
    return result.stdout


class _Row:
    __slots__ = ("key", "pid_key", "remote_ip", "total", "sent", "recv")

    def __init__(self, key: tuple, pid_key: tuple, remote_ip: str, total: int, sent: int, recv: int):
        self.key = key
        self.pid_key = pid_key
        self.remote_ip = remote_ip
        self.total = total
        self.sent = sent
        self.recv = recv


def _pid_by_socket() -> dict[tuple, int]:
    """(proto, local_ip, local_port, remote_ip, remote_port) -> owning pid.

    Requires CAP_SYS_PTRACE to resolve sockets owned by processes running as a
    different user than this one — without it, psutil silently returns pid=None
    for everything but this process's own sockets.
    """
    mapping: dict[tuple, int] = {}
    try:
        for c in psutil.net_connections(kind="inet"):
            if not c.pid or not c.raddr or not c.laddr:
                continue
            proto = "tcp" if c.type.name == "SOCK_STREAM" else "udp"
            mapping[(proto, c.laddr.ip, str(c.laddr.port), c.raddr.ip, str(c.raddr.port))] = c.pid
    except (psutil.AccessDenied, OSError):
        logger.debug("net_connections() denied", exc_info=True)
    return mapping


def _parse(text: str, local_ips: set[str]) -> list[_Row]:
    rows: list[_Row] = []
    for line in text.splitlines():
        m = _CONN_RE.search(line)
        if not m:
            continue
        obytes = int(m.group("obytes") or 0)
        rbytes = int(m.group("rbytes") or 0)
        total = obytes + rbytes
        if total == 0:
            continue

        osrc, odst = m.group("osrc"), m.group("odst")
        osport, odport = m.group("osport"), m.group("odport")
        if osrc in local_ips:
            remote_ip, sent, recv, local_ip, local_port, remote_port = odst, obytes, rbytes, osrc, osport, odport
        elif odst in local_ips:
            remote_ip, sent, recv, local_ip, local_port, remote_port = osrc, rbytes, obytes, odst, odport, osport
        else:
            continue  # forwarded/unrelated traffic, not to/from this host
        if remote_ip in local_ips or remote_ip.startswith("127.") or remote_ip == "::1":
            continue  # loopback IPC between local services, not real network bandwidth

        key = (m.group("proto"), osrc, osport, odst, odport)
        pid_key = (m.group("proto"), local_ip, local_port, remote_ip, remote_port)
        rows.append(_Row(key, pid_key, remote_ip, total, sent, recv))
    return rows


async def collect_per_ip_bandwidth() -> dict:
    global _prev_poll_time, _prev_conn_bytes, _last_pid_network
    try:
        text = await _read_conntrack()
    except Exception:
        logger.debug("conntrack read failed (sudoers grant missing or acct disabled?)", exc_info=True)
        return {"ips": [], "error": "conntrack unavailable"}

    now = time.time()
    dt = now - _prev_poll_time if _prev_poll_time else 0
    rows = _parse(text, _local_ips())
    pid_by_socket = _pid_by_socket()

    snapshot: dict[str, dict] = {}
    tick_delta: dict[str, int] = {}
    seen_tuple_bytes: dict[tuple, int] = {}
    pid_snapshot: dict[int, dict] = {}
    pid_tick_delta: dict[int, int] = {}

    for row in rows:
        seen_tuple_bytes[row.key] = row.total
        prev = _prev_conn_bytes.get(row.key, 0)
        delta = row.total - prev if row.total >= prev else row.total
        _ip_cumulative[row.remote_ip] = _ip_cumulative.get(row.remote_ip, 0) + delta
        tick_delta[row.remote_ip] = tick_delta.get(row.remote_ip, 0) + delta

        entry = snapshot.setdefault(
            row.remote_ip, {"active_bytes": 0, "active_sent": 0, "active_recv": 0, "connections": 0}
        )
        entry["active_bytes"] += row.total
        entry["active_sent"] += row.sent
        entry["active_recv"] += row.recv
        entry["connections"] += 1

        pid = pid_by_socket.get(row.pid_key)
        if pid is not None:
            _pid_cumulative[pid] = _pid_cumulative.get(pid, 0) + delta
            pid_tick_delta[pid] = pid_tick_delta.get(pid, 0) + delta
            pentry = pid_snapshot.setdefault(pid, {"sent": 0, "recv": 0, "connections": 0})
            pentry["sent"] += row.sent
            pentry["recv"] += row.recv
            pentry["connections"] += 1

    _prev_conn_bytes = seen_tuple_bytes
    _prev_poll_time = now

    _last_pid_network = {
        pid: {
            "sent_bytes": entry["sent"],
            "recv_bytes": entry["recv"],
            "connections": entry["connections"],
            "cumulative_bytes": _pid_cumulative.get(pid, 0),
            "rate_bytes_s": round(pid_tick_delta.get(pid, 0) / dt) if dt > 0 else 0,
        }
        for pid, entry in pid_snapshot.items()
    }

    result = [
        {
            "ip": remote_ip,
            "active_bytes": entry["active_bytes"],
            "active_sent": entry["active_sent"],
            "active_recv": entry["active_recv"],
            "connections": entry["connections"],
            "cumulative_bytes": _ip_cumulative.get(remote_ip, 0),
            "rate_bytes_s": round(tick_delta.get(remote_ip, 0) / dt) if dt > 0 else 0,
        }
        for remote_ip, entry in snapshot.items()
    ]
    result.sort(key=lambda r: r["cumulative_bytes"], reverse=True)
    return {"ips": result[:150], "pid_mapped_sockets": len(pid_by_socket)}
