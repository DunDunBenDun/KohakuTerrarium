"""Private event-value iteration within a store-owned read operation (blocking)."""

from collections.abc import Iterable, Iterator
from typing import Any

from kohakuterrarium.utils.logging import get_logger

logger = get_logger("kohakuterrarium.session.store")


def _iter_event_values(
    table: Any, keys: Iterable[Any], since_event_id: int | None = None
) -> Iterator[dict]:
    """Read supplied physical keys, logging and skipping unreadable values."""
    for key in keys:
        try:
            evt = table[key]
        except Exception as e:
            logger.warning("Failed to read event", error=str(e), exc_info=True)
            continue
        if since_event_id is not None:
            eid = evt.get("event_id") if isinstance(evt, dict) else None
            if not isinstance(eid, int) or eid <= since_event_id:
                continue
        yield evt
