"""Routines — timed/scheduled tasks for Mollama.

Each routine is stored as a JSON file in /data/routines/.
The scheduler_loop() coroutine runs continuously and executes due routines.
"""

import asyncio
import json
import time
import httpx
from pathlib import Path
from typing import Optional

ROUTINES_DIR = Path("/data/routines")

# In-memory last-run tracking
_last_run: dict[str, float] = {}


def _routine_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("..", "_")
    return ROUTINES_DIR / f"{safe}.json"


def list_routines() -> list[dict]:
    ROUTINES_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for f in sorted(ROUTINES_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            data.setdefault("name", f.stem)
            data.setdefault("enabled", True)
            data.setdefault("interval_minutes", 60)
            data.setdefault("last_run", _last_run.get(f.stem))
            result.append(data)
        except Exception:
            pass
    return result


def get_routine(name: str) -> Optional[dict]:
    p = _routine_path(name)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        data.setdefault("name", name)
        return data
    except Exception:
        return None


def save_routine(name: str, data: dict) -> None:
    ROUTINES_DIR.mkdir(parents=True, exist_ok=True)
    data["name"] = name
    _routine_path(name).write_text(json.dumps(data, indent=2))


def delete_routine(name: str) -> None:
    p = _routine_path(name)
    if p.exists():
        p.unlink()


def toggle_routine(name: str) -> None:
    routine = get_routine(name)
    if routine:
        routine["enabled"] = not routine.get("enabled", True)
        save_routine(name, routine)


async def run_routine(name: str) -> dict:
    """Execute a routine immediately."""
    import core

    routine = get_routine(name)
    if not routine:
        return {"ok": False, "error": f"Routine '{name}' not found"}

    active = core.get_active_instances()
    if not active:
        return {"ok": False, "error": "No Ollama instances available"}
    _, target_url = active[0]

    model = routine.get("model", "")
    if not model or model == "mollama":
        all_models = await core.get_all_instance_models_cached()
        flat = [m for mlist in all_models.values() for m in mlist]
        model = flat[0] if flat else "llama3.2"

    prompt = routine.get("prompt", "").strip()
    if not prompt:
        return {"ok": False, "error": "Routine has no prompt"}

    sys_prompt = core.get_system_prompt()
    messages = []
    if sys_prompt:
        messages.append({"role": "system", "content": sys_prompt})
    messages.append({"role": "user", "content": prompt})

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{target_url.rstrip('/')}/api/chat", json={
                "model": model,
                "messages": messages,
                "stream": False,
            })
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "")
            _last_run[name] = time.time()
            # Persist last_run
            routine["last_run"] = _last_run[name]
            save_routine(name, routine)
            return {"ok": True, "result": content, "model": model}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def scheduler_loop() -> None:
    """Background task: checks and runs due routines every 60 seconds."""
    while True:
        try:
            now = time.time()
            for routine in list_routines():
                if not routine.get("enabled", True):
                    continue
                interval_min = float(routine.get("interval_minutes", 60))
                last = float(routine.get("last_run") or 0)
                if now - last >= interval_min * 60:
                    name = routine["name"]
                    asyncio.create_task(_run_safe(name))
        except Exception:
            pass
        await asyncio.sleep(60)


async def _run_safe(name: str) -> None:
    try:
        await run_routine(name)
    except Exception:
        pass
