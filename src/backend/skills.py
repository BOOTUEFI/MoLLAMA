"""Skills — reusable AI capability definitions.

Each skill is stored as a JSON file in /data/skills/.
Skills are prompt templates that can be invoked with context.
"""

import json
import httpx
from pathlib import Path
from typing import Optional

SKILLS_DIR = Path("/data/skills")


def _skill_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("..", "_")
    return SKILLS_DIR / f"{safe}.json"


def list_skills() -> list[dict]:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    result = []
    for f in sorted(SKILLS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            data.setdefault("name", f.stem)
            result.append(data)
        except Exception:
            pass
    return result


def get_skill(name: str) -> Optional[dict]:
    p = _skill_path(name)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        data.setdefault("name", name)
        return data
    except Exception:
        return None


def save_skill(name: str, data: dict) -> None:
    SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    data["name"] = name
    _skill_path(name).write_text(json.dumps(data, indent=2))


def delete_skill(name: str) -> None:
    p = _skill_path(name)
    if p.exists():
        p.unlink()


async def invoke_skill(name: str, context: str, model: str = "") -> dict:
    """Invoke a skill with the given context. Returns the model's response."""
    import core

    skill = get_skill(name)
    if not skill:
        return {"ok": False, "error": f"Skill '{name}' not found"}

    active = core.get_active_instances()
    if not active:
        return {"ok": False, "error": "No Ollama instances available"}
    _, target_url = active[0]

    actual_model = model or skill.get("model") or ""
    if not actual_model or actual_model == "mollama":
        all_models = await core.get_all_instance_models_cached()
        flat = [m for mlist in all_models.values() for m in mlist]
        actual_model = flat[0] if flat else "llama3.2"

    instructions = skill.get("instructions", "")
    system = skill.get("system_prompt", "You are a helpful AI assistant.")

    messages = [{"role": "system", "content": system}]
    if instructions:
        messages.append({"role": "system", "content": f"Skill instructions:\n{instructions}"})
    messages.append({"role": "user", "content": context or "Run this skill."})

    try:
        async with httpx.AsyncClient(timeout=120) as client:
            r = await client.post(f"{target_url.rstrip('/')}/api/chat", json={
                "model": actual_model,
                "messages": messages,
                "stream": False,
            })
            r.raise_for_status()
            content = r.json().get("message", {}).get("content", "")
            return {"ok": True, "result": content, "model": actual_model}
    except Exception as e:
        return {"ok": False, "error": str(e)}
