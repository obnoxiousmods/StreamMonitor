"""Lightweight in-process pub/sub for Server-Sent Events.

Not a message queue — just a set of asyncio.Queue subscribers that get a copy
of every published event. One process, one set of subscribers; fine for a
single-instance app like this one. A slow/dead subscriber's queue is bounded
so a stuck client can't leak memory into the publishing path.
"""

from __future__ import annotations

import asyncio
import json
import logging

logger = logging.getLogger(__name__)

_subscribers: set[asyncio.Queue] = set()
_MAX_QUEUE = 200


def publish(event_type: str, data: dict) -> None:
    """Fire-and-forget: drop the event for any subscriber whose queue is full
    rather than block the publisher (a health poll or stats collector) on a
    slow client."""
    if not _subscribers:
        return
    payload = json.dumps({"type": event_type, "data": data})
    for q in list(_subscribers):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            logger.debug("SSE subscriber queue full, dropping event")


async def subscribe(heartbeat_interval: float = 20.0):
    """Async generator yielding raw JSON string payloads as they're published,
    or None every `heartbeat_interval` seconds of silence (so the caller can send
    an SSE comment line to keep intermediate proxies from closing the connection)."""
    q: asyncio.Queue = asyncio.Queue(maxsize=_MAX_QUEUE)
    _subscribers.add(q)
    try:
        while True:
            try:
                payload = await asyncio.wait_for(q.get(), timeout=heartbeat_interval)
            except TimeoutError:
                yield None
            else:
                yield payload
    finally:
        _subscribers.discard(q)


def subscriber_count() -> int:
    return len(_subscribers)
