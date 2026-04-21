"""Subagents — specialized AI agents the main agent can delegate tasks to.

Each agent is stored as a JSON file in /data/agents/.
Two default agents are created on first use: frontend-agent and backend-agent.
"""

import json
import asyncio
import uuid
import httpx
from pathlib import Path
from typing import Optional, AsyncIterator

AGENTS_DIR = Path("/data/agents")

DEFAULT_AGENTS = [
    {
        "name": "frontend-agent",
        "description": "Specialist for UI, React, TypeScript, CSS, animations, and frontend architecture.",
        "system_prompt": (
            "You are a senior frontend engineer specializing in React, TypeScript, Tailwind CSS, "
            "and Framer Motion. You produce clean, accessible, production-ready UI code. "
            "Focus on component design, state management, and user experience."
        ),
        "model": "",
        "enabled": True,
    },
    {
        "name": "backend-agent",
        "description": "Specialist for Python, APIs, databases, performance, and backend architecture.",
        "system_prompt": (
            "You are a senior backend engineer specializing in Python, FastAPI, asyncio, "
            "databases, and system design. You produce efficient, secure, well-structured code. "
            "Focus on correctness, performance, and maintainability."
        ),
        "model": "",
        "enabled": True,
    },
]


def _ensure_defaults() -> None:
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    for agent in DEFAULT_AGENTS:
        p = _agent_path(agent["name"])
        if not p.exists():
            p.write_text(json.dumps(agent, indent=2))


def _agent_path(name: str) -> Path:
    safe = name.replace("/", "_").replace("..", "_")
    return AGENTS_DIR / f"{safe}.json"


def list_agents() -> list[dict]:
    _ensure_defaults()
    result = []
    for f in sorted(AGENTS_DIR.glob("*.json")):
        try:
            data = json.loads(f.read_text())
            data.setdefault("name", f.stem)
            result.append(data)
        except Exception:
            pass
    return result


def list_agent_names() -> list[str]:
    return [a["name"] for a in list_agents()]


def get_agent(name: str) -> Optional[dict]:
    _ensure_defaults()
    p = _agent_path(name)
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text())
        data.setdefault("name", name)
        return data
    except Exception:
        return None


def save_agent(name: str, data: dict) -> None:
    AGENTS_DIR.mkdir(parents=True, exist_ok=True)
    data["name"] = name
    _agent_path(name).write_text(json.dumps(data, indent=2))


def delete_agent(name: str) -> None:
    p = _agent_path(name)
    if p.exists():
        p.unlink()


async def run_agent(name: str, task: str, model: str = "") -> AsyncIterator[bytes]:
    """Stream an agent's response to a task as NDJSON."""
    import core
    from tools import registry

    agent = get_agent(name)
    if not agent:
        async def _err():
            yield (json.dumps({"type": "error", "error": f"Agent '{name}' not found"}) + "\n").encode()
        return _err()

    active = core.get_active_instances()
    if not active:
        async def _err2():
            yield (json.dumps({"type": "error", "error": "No Ollama instances available"}) + "\n").encode()
        return _err2()
    _, target_url = active[0]

    actual_model = model or agent.get("model") or ""
    if not actual_model or actual_model == "mollama":
        all_models = await core.get_all_instance_models_cached()
        flat = [m for mlist in all_models.values() for m in mlist]
        actual_model = flat[0] if flat else "llama3.2"

    sys_prompt = core.get_system_prompt()
    agent_system = agent.get("system_prompt", f"You are {name}, a specialist AI agent.")
    if sys_prompt:
        agent_system = sys_prompt + "\n\n" + agent_system

    tools = list(registry.schemas)

    async def stream():
        current_messages = [
            {"role": "system", "content": agent_system},
            {"role": "user", "content": task},
        ]
        settings_file = Path("/data/settings.json")
        try:
            max_loops = int(json.loads(settings_file.read_text()).get("max_tool_loops", 50))
        except Exception:
            max_loops = 50

        async with httpx.AsyncClient(timeout=None) as client:
            for _ in range(max_loops):
                accumulated = ""
                tool_calls_buffer = []
                try:
                    async with client.stream("POST", f"{target_url.rstrip('/')}/api/chat", json={
                        "model": actual_model,
                        "messages": current_messages,
                        **({"tools": tools} if tools else {}),
                        "stream": True,
                    }) as resp:
                        if resp.status_code != 200:
                            yield (json.dumps({"type": "error", "error": f"Upstream {resp.status_code}"}) + "\n").encode()
                            return
                        async for raw_line in resp.aiter_lines():
                            line = raw_line.strip()
                            if not line:
                                continue
                            try:
                                chunk = json.loads(line)
                            except Exception:
                                continue
                            msg = chunk.get("message", {}) or {}
                            delta = msg.get("content", "") or ""
                            chunk_tcs = msg.get("tool_calls") or []
                            if chunk_tcs:
                                for tc in chunk_tcs:
                                    if isinstance(tc, dict):
                                        tc = dict(tc)
                                        tc.setdefault("id", str(uuid.uuid4())[:8])
                                        tool_calls_buffer.append(tc)
                            if delta:
                                accumulated += delta
                                yield (json.dumps({"type": "delta", "text": delta}) + "\n").encode()
                            if chunk.get("done"):
                                break
                except Exception as e:
                    yield (json.dumps({"type": "error", "error": str(e)}) + "\n").encode()
                    return

                if not tool_calls_buffer:
                    yield (json.dumps({"type": "done", "text": accumulated}) + "\n").encode()
                    return

                current_messages.append({"role": "assistant", "content": accumulated, "tool_calls": tool_calls_buffer})
                for tc in tool_calls_buffer:
                    func = tc.get("function", {}) or {}
                    tc_name = func.get("name", "")
                    args = func.get("arguments", {})
                    tc_id = tc.get("id") or str(uuid.uuid4())[:8]
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {}
                    yield (json.dumps({"type": "tool_call", "id": tc_id, "name": tc_name, "args": args}) + "\n").encode()
                    try:
                        result_val = await registry.aexecute(tc_name, args)
                        result_str, ok = str(result_val), True
                    except Exception as e:
                        result_str, ok = str(e), False
                    yield (json.dumps({"type": "tool_result", "id": tc_id, "name": tc_name, "result": result_str, "ok": ok}) + "\n").encode()
                    current_messages.append({"role": "tool", "tool_call_id": tc_id, "name": tc_name, "content": result_str})

            yield (json.dumps({"type": "error", "error": "Max tool iterations reached"}) + "\n").encode()

    return stream()


# ── spawn_subagent tool ────────────────────────────────────────────────────────

TOOL_SCHEMAS = [
    {
        "type": "function",
        "function": {
            "name": "spawn_subagent",
            "description": "Delegate a task to a specialized subagent. The subagent will complete the task and return its result. Use this to parallelize work or leverage a specialist.",
            "parameters": {
                "type": "object",
                "properties": {
                    "agent_name": {
                        "type": "string",
                        "description": "Name of the agent to spawn (e.g. 'frontend-agent', 'backend-agent').",
                    },
                    "task": {
                        "type": "string",
                        "description": "The task to delegate to the agent. Be specific and detailed.",
                    },
                },
                "required": ["agent_name", "task"],
            },
        },
    },
]


async def execute(name: str, args: dict | str) -> str:
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except Exception:
            args = {}

    if name == "spawn_subagent":
        agent_name = args.get("agent_name", "")
        task = args.get("task", "")
        if not agent_name or not task:
            return "Error: agent_name and task are required."

        stream_gen = await run_agent(agent_name, task)
        final_text = ""
        async for chunk in stream_gen:
            try:
                ev = json.loads(chunk.decode())
                if ev.get("type") == "done":
                    final_text = ev.get("text", "")
                    break
                if ev.get("type") == "error":
                    return f"Agent error: {ev.get('error')}"
            except Exception:
                pass
        return final_text or f"Agent '{agent_name}' completed with no output."

    return f"Unknown subagent tool: {name}"
