"""Strictly read session metadata without writing to the session file family."""

from pathlib import Path
from typing import Any

from kohakuterrarium.session.resource_gate import acquire_legacy
from kohakuterrarium.session.vault_handles import dispose
from kohakuterrarium.session.vault_io import read_prefix
from kohakuterrarium.session.vault_read import open_read_table
from kohakuterrarium.utils.fs_path import coerce_fs_path
from kohakuterrarium.utils.logging import get_logger

logger = get_logger(__name__)


class MetaDecodeError(ValueError):
    """A strict metadata read met a key or value it cannot decode."""


def _strict_key(key: Any) -> str:
    if isinstance(key, bytes):
        try:
            return key.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise MetaDecodeError("Metadata key is not UTF-8 text") from exc
    if isinstance(key, str):
        return key
    raise MetaDecodeError("Metadata key is not UTF-8 text")


class MetaTableRead:
    """One read of a session's ``meta`` table that records handle release.

    ``released`` is False only while a native handle may still be open, which
    is what an occupancy lease must report when it finishes. Any undecodable
    key or value fails the read; a missing table reads as ``{}`` only when
    ``missing_ok``.
    """

    def __init__(self, source: Path, *, missing_ok: bool) -> None:
        self.source = source
        self.missing_ok = missing_ok
        self.released = True
        self.close_error: BaseException | None = None

    def run(self) -> dict[str, Any]:
        """Return decoded rows; open and read failures propagate.

        A close failure is kept in ``close_error`` instead of being raised.
        """
        vault = open_read_table(self.source, "meta", snapshot=True)
        if vault is None:
            if self.missing_ok:
                return {}
            raise FileNotFoundError(f"Session has no meta table: {self.source}")
        self.released = False
        try:
            rows = read_prefix(vault, what="session metadata", strict=True)
            return {_strict_key(key): value for key, value in rows}
        finally:
            try:
                self.released = dispose(vault)
            except BaseException as exc:
                self.close_error = exc
                self.released = False


def read_session_meta(path: str | Path) -> dict[str, Any]:
    """Return metadata without creating WAL, SHM, schema, or status writes.

    A failed handle close is logged and leaves the file's occupancy uncertain.
    """
    source = coerce_fs_path(path).expanduser().resolve(strict=True)
    lease = acquire_legacy(source, "read_meta")
    read = MetaTableRead(source, missing_ok=True)
    try:
        meta = read.run()
        if read.close_error is not None:
            logger.warning(
                "Failed to close read-only session metadata",
                error=str(read.close_error),
            )
        return meta
    finally:
        lease.finish(source_released=read.released)
