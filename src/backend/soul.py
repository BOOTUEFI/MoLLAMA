"""SOUL.MD — persistent memory for the Mollama agent.

Stores memories in /data/SOUL.md as structured markdown.
Exposes two tools: add_to_memory and refine_memory.
"""

import json
import time
from pathlib import Path
from typing import Optional

SOUL_FILE = Path("/data/SOUL.md")

# ── Helpers ───────────────────────────────────────────────────────────────────

def _read() -> str:
    if SOUL_FILE.exists():
        try:
            return SOUL_FILE.read_text(encoding="utf-8").strip()
        except Exception:
            pass
    return ""


def _write(content: str) -> None:
    SOUL_FILE.parent.mkdir(parents=True, exist_ok=True)
    SOUL_FILE.write_text(content, encoding="utf-8")


def _timestamp() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# ── Public API ────────────────────────────────────────────────────────────────

def get_memory() -> str:
    return _read()


def set_memory(content: str) -> None:
    _write(content)


def add_to_memory(entry: str, section: str = "General") -> str:
    """Append a new memory entry under the given section heading."""
    current = _read()
    ts = _timestamp()
    new_entry = f"- [{ts}] {entry.strip()}"

    if not current:
        updated = f"# SOUL.md — Agent Memory\n\n## {section}\n{new_entry}\n"
        _write(updated)
        return f"Memory added under '{section}'."

    section_header = f"## {section}"
    if section_header in current:
        # Insert before the next ## heading or at end of section
        lines = current.split("\n")
        insert_at = len(lines)
        in_section = False
        for i, line in enumerate(lines):
            if line.strip() == section_header:
                in_section = True
                continue
            if in_section and line.startswith("## "):
                insert_at = i
                break
        lines.insert(insert_at, new_entry)
        _write("\n".join(lines))
    else:
        # Add new section at end
        updated = current.rstrip() + f"\n\n{section_header}\n{new_entry}\n"
        _write(updated)

    return f"Memory added under '{section}'."


def refine_memory(instructions: str) -> str:
    """Return current SOUL.md content so the model can rewrite/refine it."""
    current = _read()
    if not current:
        return "SOUL.md is empty — nothing to refine."
    return f"Current SOUL.md content:\n\n{current}\n\nInstructions: {instructions}"


# ── Tool schemas (auto-registered) ───────────────────────────────────────────

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "add_to_memory",
            "description": "Add a persistent memory entry to SOUL.md. Use this to remember important facts, user preferences, project decisions, or anything you need to recall in future sessions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry": {
                        "type": "string",
                        "description": "The memory entry to record (be concise and specific).",
                    },
                    "section": {
                        "type": "string",
                        "description": "Section heading to file this under (e.g. 'User Preferences', 'Project Context', 'Decisions'). Default: 'General'.",
                        "default": "General",
                    },
                },
                "required": ["entry"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_memory",
            "description": "Read the full contents of SOUL.md (agent's persistent memory). Use this at the start of a session to recall context.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
]


async def execute(name: str, args: dict | str) -> str:
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    if name == "add_to_memory":
        entry = args.get("entry", "")
        section = args.get("section", "General")
        if not entry:
            return "Error: entry is required."
        return add_to_memory(entry, section)

    if name == "read_memory":
        content = get_memory()
        return content if content else "(SOUL.md is empty)"

    return f"Unknown soul tool: {name}"
