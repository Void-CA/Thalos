#!/usr/bin/env python3
"""Shared calibration write-back helper (design ADR-4; spec
safety-envelope-canonical-source).

``config/safety-envelope.toml`` is the SINGLE canonical source for the safety
envelope. The calibration tools (``firmware/esp32/tools/calibrate.py``,
``limit_finder.py``) measure real values on hardware and write them BACK to
the TOML through this module — the 7-step flow:

    tool runs -> candidate measured -> old/new shown -> write ONE field
    -> git diff config/safety-envelope.toml
    -> python3 tools/generate_safety_config.py
    -> python3 tools/check_safety_parity.py

The write is a TARGETED LINE-EDIT (ADR-4): only the value of the one field on
its own line is replaced; every comment, blank line, and byte of formatting
around it is preserved. There is deliberately NO tomli_w and NO full-file
rewrite (no external dependency, and a rewrite would destroy the curated
comments).

If the TOML is invalid, every operation fails LOUDLY (``tomllib`` raises
``TOMLDecodeError``) and no write occurs — the helper never corrupts the
source of truth.

API:

    load(toml_path=...) -> dict                     parsed TOML
    get_field(channel_idx, section, field, toml_path=...) -> value
    show_old_new(channel_idx, section, field, old, new)   prints step-3 line
    update_channel_field(channel_idx, section, field, value, toml_path=...,
                         show=False) -> old_value
                                targeted line-edit; warns on stderr if the
                                envelope position range now exceeds the
                                calibration range (spec invariant R10)
"""

from __future__ import annotations

import json
import pathlib
import sys
import tomllib

REPO_ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_TOML = REPO_ROOT / "config" / "safety-envelope.toml"


# --- read ---------------------------------------------------------------

def load(toml_path: pathlib.Path | str = DEFAULT_TOML) -> dict:
    """Parse the canonical TOML (``tomllib``). Raises loudly on invalid TOML."""
    with pathlib.Path(toml_path).open("rb") as f:
        return tomllib.load(f)


def _find_channel(data: dict, channel_idx: int) -> dict:
    for ch in data.get("channel", []):
        if ch.get("index") == channel_idx:
            return ch
    raise KeyError(f"channel index {channel_idx} not found in the safety-envelope TOML")


def get_field(
    channel_idx: int,
    section: str,
    field: str,
    toml_path: pathlib.Path | str = DEFAULT_TOML,
):
    """Current value of ``channel[channel_idx].<section>.<field>``."""
    data = load(toml_path)
    ch = _find_channel(data, channel_idx)
    if section not in ch:
        raise KeyError(f"channel[{channel_idx}] has no [{section}] section")
    if field not in ch[section]:
        raise KeyError(f"channel[{channel_idx}].{section} has no field {field!r}")
    return ch[section][field]


# --- the 7-step flow, step 3 ---------------------------------------------

def show_old_new(
    channel_idx: int, section: str, field: str, old_value, new_value
) -> None:
    """Print the previous and the new value (flow step 3: show old/new)."""
    print(
        f"  channel[{channel_idx}].{section}.{field}: "
        f"{old_value!r} -> {new_value!r}"
    )


# --- targeted line-edit write (ADR-4: no tomli_w, no full rewrite) --------

def _format_value(value) -> str:
    """TOML literal for ``value`` (numbers stay bare; strings are quoted)."""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        # already a quoted TOML literal? keep as-is
        if value[:1] in ('"', "'"):
            return value
        return json.dumps(value)
    return str(value)


def _channel_blocks(lines: list[str]) -> list[tuple[int, int, int]]:
    """[(start_line, end_line, index)] for every ``[[channel]]`` block."""
    starts = [i for i, raw in enumerate(lines) if raw.strip() == "[[channel]]"]
    blocks: list[tuple[int, int, int]] = []
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        idx = None
        for raw in lines[start:end]:
            if raw.strip().startswith("index"):
                try:
                    idx = int(raw.split("=", 1)[1].strip())
                except ValueError:
                    idx = None
                break
        blocks.append((start, end, idx))
    return blocks


def _locate_field_line(
    lines: list[str], channel_idx: int, section: str, field: str
) -> int:
    """Line number of ``field = ...`` inside the channel block's section."""
    block = next(
        (b for b in _channel_blocks(lines) if b[2] == channel_idx), None
    )
    if block is None:
        raise KeyError(f"no [[channel]] block with index {channel_idx}")
    start, end, _ = block
    section_header = f"channel.{section}"
    in_section = False
    for i in range(start, end):
        stripped = lines[i].strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            in_section = stripped[1:-1].strip() == section_header
            continue
        if in_section and stripped.startswith(f"{field} ="):
            return i
    raise KeyError(
        f"field {field!r} not found in channel[{channel_idx}].{section} "
        "(cannot write back)"
    )


def _rewrite_value_on_line(raw: str, new_value_text: str) -> str:
    """Replace the value on one ``key = value`` line, preserving the spacing
    around ``=`` and any trailing comment (e.g. ``max_us = 1650  # note``)."""
    newline = "\n" if raw.endswith("\n") else ""
    body = raw[:-1] if newline else raw
    eq = body.find("=")
    if eq < 0:
        raise ValueError(f"write-back target line has no '=': {raw!r}")
    before = body[:eq]
    after_eq = body[eq + 1 :]
    leading_ws = after_eq[: len(after_eq) - len(after_eq.lstrip(" \t"))]
    value_and_rest = after_eq[len(leading_ws):]
    comment = ""
    idx = value_and_rest.find("#")
    if idx >= 0:
        comment = value_and_rest[idx:]
        value_and_rest = value_and_rest[:idx]
    trailing_ws = value_and_rest[len(value_and_rest.rstrip(" \t")):]
    return (
        before
        + "="
        + leading_ws
        + new_value_text
        + trailing_ws
        + comment
        + newline
    )


def _warn_if_envelope_exceeds_calibration(data: dict, channel_idx: int) -> None:
    """ADR-4 invariant check: after a write, warn (stderr) if the channel's
    envelope position range is no longer within its calibration range (spec
    R10). A warning only — the TOML remains valid; the generator will reject
    a genuinely violating TOML at codegen time."""
    ch = _find_channel(data, channel_idx)
    env, cal = ch.get("envelope", {}), ch.get("calibration", {})
    pmin = env.get("position_min_rad")
    pmax = env.get("position_max_rad")
    cmin = cal.get("joint_min_rad")
    cmax = cal.get("joint_max_rad")
    if None in (pmin, pmax, cmin, cmax):
        return
    if pmin < cmin or pmax > cmax:
        print(
            f"WARNING channel[{channel_idx}]: envelope position "
            f"[{pmin}, {pmax}] now exceeds calibration joint range "
            f"[{cmin}, {cmax}] (spec R10) — tighten the envelope or widen "
            "the calibration before codegen",
            file=sys.stderr,
        )


def update_channel_field(
    channel_idx: int,
    section: str,
    field: str,
    value,
    toml_path: pathlib.Path | str = DEFAULT_TOML,
    show: bool = False,
):
    """Write ONE field of the canonical TOML via a targeted line-edit.

    Only the value token on the field's own line is replaced; all comments
    and formatting are preserved. The full file is re-read and re-written
    line-by-line, so a byte-exact single-line diff is the observable result.

    Returns the PREVIOUS value. When ``show`` is true, prints old/new first
    (the 7-step flow's step 3). Raises loudly (``tomllib.TOMLDecodeError`` /
    ``KeyError``) and writes NOTHING when the TOML is invalid or the field
    cannot be located.
    """
    data = load(toml_path)  # fails loudly on invalid TOML — no write happens
    _find_channel(data, channel_idx)  # fail loudly on a missing channel
    old_value = get_field(channel_idx, section, field, toml_path)

    if show:
        show_old_new(channel_idx, section, field, old_value, value)

    path = pathlib.Path(toml_path)
    lines = path.read_text(encoding="utf-8").splitlines(keepends=True)
    lineno = _locate_field_line(lines, channel_idx, section, field)
    lines[lineno] = _rewrite_value_on_line(
        lines[lineno], _format_value(value)
    )
    path.write_text("".join(lines), encoding="utf-8")

    # ADR-4 invariant: envelope ⊆ calibration must still hold after the write.
    _warn_if_envelope_exceeds_calibration(load(toml_path), channel_idx)
    return old_value


if __name__ == "__main__":  # pragma: no cover — dev smoke
    import argparse

    ap = argparse.ArgumentParser(description="safety-envelope TOML write-back helper")
    ap.add_argument("channel", type=int)
    ap.add_argument("section", choices=["calibration", "pulse", "envelope"])
    ap.add_argument("field")
    ap.add_argument("value")
    args = ap.parse_args()

    value = args.value
    try:
        value = int(value)
    except ValueError:
        try:
            value = float(value)
        except ValueError:
            pass

    old = update_channel_field(args.channel, args.section, args.field, value, show=True)
    print(f"  wrote channel[{args.channel}].{args.section}.{args.field}: "
          f"{old!r} -> {value!r}")
    print("  next: git diff config/safety-envelope.toml")
    print("        python3 tools/generate_safety_config.py")
    print("        python3 tools/check_safety_parity.py")
