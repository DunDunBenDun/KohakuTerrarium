"""Per-selection compatibility checks for indexed parent paths."""

import bisect
from typing import Any

Path = tuple[tuple[int, int], ...]


def _matches_before_turn(path: Path, turn: int, selected: dict[int, int]) -> bool:
    """Check constraints on selected turns preceding the event turn."""
    for parent_turn, branch in path:
        if (
            parent_turn < turn
            and parent_turn in selected
            and selected[parent_turn] != branch
        ):
            return False
    return True


class SelectionCompatibility:
    """Check parent paths against one fixed selected branch view."""

    def __init__(self, selected: dict[int, int]):
        self._selected = selected
        self._selected_turns = sorted(selected)
        self._compatibility: dict[tuple[int, Path], bool] | None = (
            {}
            if all(
                (type(turn) is int or type(turn) is bool)
                and (type(branch) is int or type(branch) is bool)
                for turn, branch in selected.items()
            )
            else None
        )

    def matches(self, path: Any, turn: int) -> bool:
        """Return compatibility with the selected prefix preceding a turn."""
        if (
            self._compatibility is not None
            and (type(turn) is int or type(turn) is bool)
            and type(path) is tuple
            and all(
                type(pair) is tuple
                and len(pair) == 2
                and (type(pair[0]) is int or type(pair[0]) is bool)
                and (type(pair[1]) is int or type(pair[1]) is bool)
                for pair in path
            )
        ):
            key = (turn, path)
            matched = self._compatibility.get(key)
            if matched is None:
                matched = _matches_before_turn(path, turn, self._selected)
                self._compatibility[key] = matched
            return matched

        bound = min(turn, max(t for t, _ in path) + 1)
        idx = bisect.bisect_left(self._selected_turns, bound)
        prefix = {t: self._selected[t] for t in self._selected_turns[:idx]}
        for parent_turn, branch in path:
            if parent_turn in prefix and prefix[parent_turn] != branch:
                return False
        return True
