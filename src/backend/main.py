# src/backend/main.py
import signal
import time
import asyncio
import uuid
from typing import Any
import os
import json
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles

import core
import events as _ev
from middleware import OllamaProxyMiddleware
from ws_manager import ws_manager
from mcp_manager import mcp_manager
from tools import registry

import httpx

SETTINGS_FILE = Path("/data/settings.json")


def _load_settings() -> dict:
    if SETTINGS_FILE.exists():
        try:
            return json.loads(SETTINGS_FILE.read_text())
        except Exception:
            pass
    return {}


def _save_settings(data: dict) -> None:
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2))


def _spawn_background_task(app: FastAPI, coro):
    task = asyncio.create_task(coro)

    if not hasattr(app.state, "_bg_tasks"):
        app.state._bg_tasks = set()

    app.state._bg_tasks.add(task)

    def _cleanup(t: asyncio.Task):
        app.state._bg_tasks.discard(t)
        try:
            t.exception()
        except BaseException:
            pass

    task.add_done_callback(_cleanup)
    return task


# ── WS broadcast caches ────────────────────────────────────────────────────────
_ws_cache_models: dict = {"data": None, "ts": 0.0, "refreshing": False}
_ws_cache_mcp: dict = {"data": None, "ts": 0.0}
_ws_cache_tools: dict = {"data": None, "ts": 0.0}
_ws_cache_settings: dict = {"data": None, "ts": 0.0}


async def _refresh_models_cache(data: dict) -> None:
    """Fetch models from all active Ollama instances into the WS cache."""
    try:
        models: set = set()
        has_main = any(inst.get("is_main") for inst in data.values())
        async with httpx.AsyncClient(timeout=3) as client:
            for inst in data.values():
                url = inst.get("base_url")
                if not url:
                    continue
                try:
                    r = await client.get(f"{url}/api/tags")
                    if r.status_code == 200:
                        payload = r.json()
                        items = payload.get("models", []) if isinstance(payload, dict) else payload
                        for item in items:
                            if isinstance(item, str):
                                models.add(item)
                            elif isinstance(item, dict) and "name" in item:
                                models.add(item["name"])
                except Exception:
                    pass
        result = sorted(models)
        if has_main:
            result = ["mollama"] + result
        _ws_cache_models["data"] = result
    except Exception:
        pass
    finally:
        _ws_cache_models["ts"] = time.time()
        _ws_cache_models["refreshing"] = False


async def _ws_broadcast_loop() -> None:
    """Push live state to all connected WebSocket clients every 300 ms."""
    while True:
        try:
            if ws_manager.count > 0:
                now = time.time()
                data = core.load_data()
                stats_payload = {
                    "total_requests": _ev.total_requests,
                    "processing": _ev._processing,
                    "health": {k: bool(v) for k, v in getattr(core, "_health", {}).items()},
                    "banned_until": getattr(core, "_banned_until", {}),
                    "managed_count": sum(1 for i in data.values() if i.get("managed")),
                    "maintenance": core.get_maintenance_state(),
                }

                feed = list(_ev.feed_log)
                streams = sorted(_ev.stream_log.values(), key=lambda x: x["ts"], reverse=True)[:50]

                # Refresh slow caches in background
                if now - _ws_cache_models["ts"] > 10 and not _ws_cache_models["refreshing"]:
                    _ws_cache_models["refreshing"] = True
                    asyncio.create_task(_refresh_models_cache(data))

                # Refresh fast caches inline (cheap operations)
                if now - _ws_cache_mcp["ts"] > 2:
                    try:
                        _ws_cache_mcp["data"] = {"servers": mcp_manager.list_servers()}
                    except Exception:
                        pass
                    _ws_cache_mcp["ts"] = now

                if now - _ws_cache_tools["ts"] > 5:
                    try:
                        _ws_cache_tools["data"] = {
                            "tools": registry.list_tool_files(),
                            "schemas": registry.schemas,
                        }
                    except Exception:
                        pass
                    _ws_cache_tools["ts"] = now

                if now - _ws_cache_settings["ts"] > 5:
                    try:
                        _ws_cache_settings["data"] = _load_settings()
                    except Exception:
                        pass
                    _ws_cache_settings["ts"] = now

                await ws_manager.broadcast({
                    "type": "state",
                    "stats": stats_payload,
                    "instances": data,
                    "events": {"events": feed, "total": len(feed)},
                    "streams": {"streams": streams},
                    "processing": {"processing": _ev._processing},
                    **({"models": _ws_cache_models["data"]} if _ws_cache_models["data"] is not None else {}),
                    **({"mcpServers": _ws_cache_mcp["data"]} if _ws_cache_mcp["data"] is not None else {}),
                    **({"tools": _ws_cache_tools["data"]} if _ws_cache_tools["data"] is not None else {}),
                    **({"appSettings": _ws_cache_settings["data"]} if _ws_cache_settings["data"] is not None else {}),
                })
        except Exception:
            pass
        await asyncio.sleep(0.3)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state._autostart_task = asyncio.create_task(core._autostart_managed())
    app.state._health_task = asyncio.create_task(core.health_check_loop())
    app.state._ws_broadcast_task = asyncio.create_task(_ws_broadcast_loop())
    app.state._bg_tasks = set()
    # Autoconnect MCP servers
    asyncio.create_task(mcp_manager.autoconnect())
    try:
        yield
    finally:
        bg_tasks = list(getattr(app.state, "_bg_tasks", set()))
        for t in bg_tasks:
            t.cancel()
        for t in bg_tasks:
            try:
                await t
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        for tname in ("_autostart_task", "_health_task", "_ws_broadcast_task"):
            t = getattr(app.state, tname, None)
            if t:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
        await core._shutdown_managed()


app = FastAPI(lifespan=lifespan)
signal.signal(signal.SIGTERM, lambda *_: exit(0))


def _managed_count() -> int:
    data = core.load_data()
    return sum(1 for inst in data.values() if inst.get("managed"))


# ── Instance management ───────────────────────────────────────────────────────

@app.get("/admin/instances")
def list_instances() -> Any:
    return core.load_data()


@app.get("/admin/active")
def active_instances() -> Any:
    return core.get_active_instances()


@app.post("/admin/deploy")
async def deploy(payload: dict) -> dict:
    name = payload.get("clean_name")
    is_local = payload.get("is_local", False)
    if not name:
        raise HTTPException(status_code=400, detail="missing clean_name")
    ok = await core.deploy_new_ollama(name, is_local)
    return {"deployed": ok}


@app.post("/admin/start")
async def start_container(body: dict) -> dict:
    full_name = body.get("full_name")
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")
    await asyncio.to_thread(core._start_sync, full_name)
    data = core.load_data()
    if full_name in data:
        data[full_name]["active"] = True
        core.save_data(data)
    return {"started": True}


@app.post("/admin/stop")
async def stop_container(body: dict) -> dict:
    full_name = body.get("full_name")
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")
    await asyncio.to_thread(core._stop_sync, full_name)
    data = core.load_data()
    if full_name in data:
        data[full_name]["active"] = False
        core.save_data(data)
    return {"stopped": True}


@app.delete("/admin/remove")
async def remove_container(body: dict) -> dict:
    full_name = body.get("full_name")
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")
    await asyncio.to_thread(core._remove_sync, full_name)
    data = core.load_data()
    if full_name in data:
        del data[full_name]
        core.save_data(data)
    return {"removed": True}


@app.get("/admin/key/{full_name}")
def container_key(full_name: str) -> dict:
    return {"key": core.get_container_key(full_name)}


@app.post("/admin/instances/{full_name}/active")
def set_active(full_name: str, body: dict) -> dict:
    data = core.load_data()
    if full_name not in data:
        raise HTTPException(status_code=404, detail="instance not found")
    data[full_name]["active"] = bool(body.get("active", True))
    core.save_data(data)
    return {"ok": True}


@app.post("/admin/instances/update")
async def update_instance(body: dict) -> dict:
    full_name = body.get("full_name")
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")

    data = core.load_data()
    if full_name not in data:
        raise HTTPException(status_code=404, detail="instance not found")

    old_is_local = data[full_name].get("is_local", False)
    new_is_local = body.get("is_local", old_is_local)

    if "base_url" in body:
        data[full_name]["base_url"] = body["base_url"]
    if "active" in body:
        data[full_name]["active"] = bool(body["active"])

    data[full_name]["is_local"] = new_is_local
    core.save_data(data)

    if data[full_name].get("managed") and new_is_local != old_is_local:
        await asyncio.to_thread(core.recreate_managed_container, full_name, new_is_local)

    return {"ok": True, "recreated": new_is_local != old_is_local}


# ── Ollama maintenance ────────────────────────────────────────────────────────

@app.post("/admin/update")
async def update_ollama() -> dict:
    if core.get_maintenance_state().get("running"):
        return {"started": False, "running": True}
    _spawn_background_task(app, core.update_ollama_and_rebuild_managed())
    return {"started": True}


@app.post("/admin/rebuild")
async def rebuild_ollama() -> dict:
    if core.get_maintenance_state().get("running"):
        return {"started": False, "running": True}
    _spawn_background_task(app, core.rebuild_all_managed_instances())
    return {"started": True}


@app.post("/admin/update/pause")
def pause_ollama_update(body: dict) -> dict:
    paused = bool(body.get("paused", True))
    core.set_maintenance_paused(paused)
    return {"ok": True, "paused": paused}


@app.post("/admin/update/stop")
def stop_ollama_update() -> dict:
    core.request_maintenance_stop()
    return {"ok": True}


# ── Main Node ─────────────────────────────────────────────────────────────────

@app.post("/admin/instances/{full_name}/set_main")
def set_main_node(full_name: str) -> dict:
    data = core.load_data()
    if full_name not in data:
        raise HTTPException(status_code=404, detail="instance not found")
    core.set_main_node(full_name)
    return {"ok": True, "main": full_name}


@app.delete("/admin/instances/{full_name}/set_main")
def unset_main_node(full_name: str) -> dict:
    core.unset_main_node(full_name)
    return {"ok": True}


# ── System Prompt ─────────────────────────────────────────────────────────────

@app.get("/admin/system_prompt")
def get_system_prompt() -> dict:
    return {"prompt": core.get_system_prompt()}


@app.post("/admin/system_prompt")
def save_system_prompt(body: dict) -> dict:
    core.set_system_prompt(body.get("prompt", ""))
    return {"ok": True}


# ── Model management ──────────────────────────────────────────────────────────

@app.get("/admin/models")
async def list_models() -> dict:
    models: set[str] = set()
    data = core.load_data()
    has_main = any(inst.get("is_main") for inst in data.values())

    async with httpx.AsyncClient(timeout=5) as client:
        for name, inst in data.items():
            url = inst.get("base_url")
            if not url:
                continue
            try:
                r = await client.get(f"{url}/api/tags")
                if r.status_code == 200:
                    payload = r.json()
                    items = payload.get("models", []) if isinstance(payload, dict) else payload
                    for item in items:
                        if isinstance(item, str):
                            models.add(item)
                        elif isinstance(item, dict) and "name" in item:
                            models.add(item["name"])
            except Exception:
                continue

    result = sorted(models)
    if has_main:
        result = ["mollama"] + result
    return {"models": result}


@app.get("/admin/models/context-length")
async def get_model_context_length(model: str = "") -> dict:
    """Return the context window size for a given model from the first active Ollama instance."""
    if not model:
        return {"context_length": 4096}
    active = core.get_active_instances()
    if not active:
        return {"context_length": 4096}
    _, url = active[0]
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.post(f"{url.rstrip('/')}/api/show", json={"name": model})
            if r.status_code == 200:
                data = r.json()
                # model_info contains arch-specific keys like "llama.context_length"
                for val in (data.get("model_info") or {}).values():
                    if isinstance(val, int) and val > 512:
                        # Heuristic: context_length is a large int
                        pass
                for key, val in (data.get("model_info") or {}).items():
                    if "context_length" in key.lower() and isinstance(val, int):
                        return {"context_length": val}
                # Fall back to parameters field
                for line in (data.get("parameters") or "").split("\n"):
                    parts = line.strip().split()
                    if len(parts) >= 2 and parts[0] == "num_ctx":
                        try:
                            return {"context_length": int(parts[1])}
                        except ValueError:
                            pass
    except Exception:
        pass
    return {"context_length": 4096}


@app.get("/admin/instances/{full_name}/models")
async def instance_models(full_name: str) -> dict:
    models = await core.fetch_instance_models(full_name)
    return {"models": models}


@app.delete("/admin/models")
async def delete_model(body: dict) -> dict:
    instance_name = body.get("instance")
    model_name = body.get("model")
    if not instance_name or not model_name:
        raise HTTPException(status_code=400, detail="Missing instance or model name")
    result = await core.delete_model_on_instance(instance_name, model_name)
    if not result.get("ok"):
        raise HTTPException(status_code=500, detail=result.get("error", "Delete failed"))
    return result


@app.post("/admin/pull")
async def pull_model(body: dict):
    instance_name = body.get("instance")
    model_name = body.get("model")
    if not instance_name or not model_name:
        raise HTTPException(status_code=400, detail="Missing instance or model name")
    return StreamingResponse(
        core.pull_model_on_instance(instance_name, model_name),
        media_type="application/x-ndjson",
    )


@app.post("/admin/pull/all")
async def pull_model_all(body: dict):
    model_name = body.get("model")
    if not model_name:
        raise HTTPException(status_code=400, detail="Missing model name")

    async def multi_pull():
        data = core.load_data()
        instances = [
            (name, inst)
            for name, inst in data.items()
            if inst.get("active") and inst.get("base_url")
        ]
        if not instances:
            yield json.dumps({"error": "No active instances"}).encode() + b"\n"
            return

        for name, inst in instances:
            yield json.dumps({"instance": name, "status": "starting"}).encode() + b"\n"
            try:
                async for chunk in core.pull_model_on_instance(name, model_name):
                    try:
                        text = chunk.decode("utf-8", errors="replace")
                        for line in text.strip().split("\n"):
                            if not line.strip():
                                continue
                            try:
                                parsed = json.loads(line)
                                parsed["instance"] = name
                                yield json.dumps(parsed).encode() + b"\n"
                            except Exception:
                                yield chunk
                    except Exception:
                        yield chunk
            except Exception as e:
                yield json.dumps({"instance": name, "error": str(e)}).encode() + b"\n"

        core.invalidate_model_cache()
        yield json.dumps({"done": True}).encode() + b"\n"

    return StreamingResponse(multi_pull(), media_type="application/x-ndjson")


# ── Stats / Events ────────────────────────────────────────────────────────────

@app.get("/admin/events")
def get_events(limit: int = 200) -> dict:
    feed = list(_ev.feed_log)[:limit]
    return {"events": feed, "total": len(feed)}


@app.get("/admin/processing")
def get_processing() -> dict:
    return {"processing": _ev._processing}


@app.get("/admin/stats")
async def get_stats() -> dict:
    current_version = await core.get_current_ollama_version()
    latest_version = await core.get_latest_ollama_version()
    maintenance = core.get_maintenance_state()

    return {
        "total_requests": _ev.total_requests,
        "processing": _ev._processing,
        "health": {k: bool(v) for k, v in getattr(core, "_health", {}).items()},
        "banned_until": getattr(core, "_banned_until", {}),
        "managed_count": _managed_count(),
        "currentOllamaVersion": current_version,
        "latestOllamaVersion": latest_version,
        "isLatest": core.versions_match(current_version, latest_version),
        "maintenance": maintenance,
    }


@app.post("/admin/ban")
def ban_instance(body: dict) -> dict:
    full_name = body.get("full_name")
    seconds = int(body.get("seconds", core.BAN_DURATION))
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")
    core._banned_until[full_name] = time.time() + seconds
    core._health[full_name] = False
    # Promote a new main if this was the main node
    data = core.load_data()
    if data.get(full_name, {}).get("is_main"):
        core.promote_main_node()
    return {"banned": full_name, "until": core._banned_until[full_name]}


@app.post("/admin/unban")
def unban_instance(body: dict) -> dict:
    full_name = body.get("full_name")
    if not full_name:
        raise HTTPException(status_code=400, detail="missing full_name")
    if full_name in core._banned_until:
        del core._banned_until[full_name]
    return {"unbanned": full_name}


@app.get("/admin/stream_log")
def get_stream_log(limit: int = 50) -> dict:
    entries = sorted(_ev.stream_log.values(), key=lambda x: x["ts"], reverse=True)
    return {"streams": entries[:limit]}


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ── Middleware ────────────────────────────────────────────────────────────────

@app.get("/api/tags")
async def get_all_proxied_tags():
    """
    Aggregates models from ALL active Ollama instances 
    so Bolt.diy sees every model available in the cluster.
    """
    all_models = []
    data = core.load_data()
    
    async with httpx.AsyncClient(timeout=5) as client:
        for name, inst in data.items():
            if not inst.get("active") or not inst.get("base_url"):
                continue
            try:
                # Fetch tags from the actual internal Ollama container
                r = await client.get(f"{inst['base_url'].rstrip('/')}/api/tags")
                if r.status_code == 200:
                    payload = r.json()
                    models = payload.get("models", [])
                    # Add them to our master list
                    all_models.extend(models)
            except Exception as e:
                print(f"Failed to fetch tags from {name}: {e}")

    # Add the 'mollama' virtual model for your smart routing
    all_models.append({
        "name": "mollama",
        "model": "mollama",
        "details": {"family": "smart-router", "format": "virtual"}
    })

    return {"models": all_models}

# ── WebSocket ─────────────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            # Keep alive — client can send pings; we just discard them
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await ws_manager.disconnect(ws)


# ── Tools CRUD ────────────────────────────────────────────────────────────────

@app.get("/admin/tools")
def list_tools() -> dict:
    return {"tools": registry.list_tool_files(), "schemas": registry.schemas}


@app.get("/admin/tools/file")
def read_tool(path: str) -> dict:
    try:
        return {"code": registry.read_tool_file(path)}
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@app.post("/admin/tools/file")
def write_tool(body: dict) -> dict:
    path = body.get("path")
    code = body.get("code", "")
    if not path:
        raise HTTPException(status_code=400, detail="missing path")
    try:
        registry.write_tool_file(path, code)
        registry.hot_reload()
        return {"ok": True, "loaded": len(registry.tools)}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@app.delete("/admin/tools/file")
def delete_tool(body: dict) -> dict:
    path = body.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="missing path")
    try:
        registry.delete_tool_file(path)
        registry.hot_reload()
        return {"ok": True}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


@app.post("/admin/tools/reload")
def reload_tools() -> dict:
    count = registry.hot_reload()
    return {"ok": True, "loaded": count}


@app.post("/admin/tools/run")
async def run_tool(body: dict) -> dict:
    tool_name = body.get("tool")
    args = body.get("args", {})
    if not tool_name:
        raise HTTPException(status_code=400, detail="missing tool")
    try:
        result = await registry.aexecute(tool_name, args)
        return {"ok": True, "result": str(result)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.post("/admin/tools/generate")
async def generate_tool(body: dict) -> dict:
    import re
    description = body.get("description", "").strip()
    model = body.get("model", "")
    if not description:
        raise HTTPException(status_code=400, detail="missing description")

    data = core.load_data()
    active = [(n, i) for n, i in data.items() if i.get("active") and i.get("base_url")]
    if not active:
        raise HTTPException(status_code=503, detail="no active Ollama instances")

    _, inst = active[0]
    url = inst["base_url"].rstrip("/")

    if not model:
        try:
            async with httpx.AsyncClient(timeout=5) as c:
                r = await c.get(f"{url}/api/tags")
                tags = r.json().get("models", [])
                model = tags[0]["name"] if tags else "llama3.2"
        except Exception:
            model = "llama3.2"

    system_prompt = (
        "You are a Python tool generator for an AI assistant system.\n"
        "Generate a single Python file with one or more utility functions.\n\n"
        "Rules:\n"
        "- Each function needs a clear one-line docstring (shown to the LLM)\n"
        "- Use type annotations for all parameters and return values\n"
        "- Return str or JSON-serializable data\n"
        "- Only use Python stdlib unless a dep is truly essential\n"
        "- No class definitions — only module-level functions\n"
        "- Output ONLY raw Python code, no markdown fences"
    )

    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(f"{url}/api/chat", json={
            "model": model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": f"Create a Python tool file that: {description}"},
            ],
            "stream": False,
            "options": {"temperature": 0.25},
        })
        r.raise_for_status()
        content = r.json().get("message", {}).get("content", "")

    content = re.sub(r"^```(?:python)?\n?", "", content.strip(), flags=re.MULTILINE)
    content = re.sub(r"\n?```\s*$", "", content.strip(), flags=re.MULTILINE)
    return {"code": content.strip(), "model": model}


# ── Agentic chat ──────────────────────────────────────────────────────────────

@app.post("/admin/chat/agentic")
async def agentic_chat(request: Request):
    """Streams NDJSON events: tool_call, tool_result, content, error."""
    from proxy import _normalize_tool_calls
    body_json = await request.json()
    messages: list = list(body_json.get("messages", []))
    model: str = body_json.get("model", "")

    if model == "mollama":
        result = await core.select_best_model_for_prompt(messages)
        if result and result[2]:
            _, target_url, model = result
        else:
            fb = await core.get_any_available_model()
            if fb:
                _, target_url, model = fb
            else:
                return Response(content=json.dumps({"error": "No models available"}), status_code=503)
    else:
        active = core.get_active_instances()
        if not active:
            return Response(content=json.dumps({"error": "No instances available"}), status_code=503)
        _, target_url = active[0]

    mcp_schemas = mcp_manager.get_all_tool_schemas()
    if mcp_schemas:
        registry.set_extra_schemas(mcp_schemas)
    tools = list(registry.schemas)

    async def event_stream():
        try:
            current_messages = list(messages)
            sys_prompt = core.get_system_prompt()
            if sys_prompt and (not current_messages or current_messages[0].get("role") != "system"):
                current_messages.insert(0, {"role": "system", "content": sys_prompt})

            for _loop in range(8):
                try:
                    async with httpx.AsyncClient(timeout=120) as client:
                        resp = await client.post(
                            f"{target_url.rstrip('/')}/api/chat",
                            json={
                                "model": model,
                                "messages": current_messages,
                                **({"tools": tools} if tools else {}),
                                "stream": False,
                            },
                        )
                except Exception as e:
                    yield json.dumps({"type": "error", "error": str(e)}) + "\n"
                    return

                if resp.status_code != 200:
                    yield json.dumps({"type": "error", "error": f"Upstream {resp.status_code}"}) + "\n"
                    return

                try:
                    resp_data = resp.json()
                except Exception as e:
                    yield json.dumps({"type": "error", "error": f"Failed to parse response: {e}"}) + "\n"
                    return

                msg = resp_data.get("message", {}) or {}
                content = msg.get("content", "") or ""

                try:
                    tool_calls, _ = _normalize_tool_calls(msg, content)
                except Exception as e:
                    yield json.dumps({"type": "error", "error": f"Tool call parse error: {e}"}) + "\n"
                    return

                if not tool_calls:
                    yield json.dumps({"type": "content", "text": content, "model": resp_data.get("model", model), "done": True}) + "\n"
                    return

                if content:
                    yield json.dumps({"type": "content", "text": content, "done": False}) + "\n"

                current_messages.append({"role": "assistant", "content": content or "", "tool_calls": tool_calls})

                for tc in tool_calls:
                    func = tc.get("function", {})
                    tc_name = func.get("name", "")
                    args = func.get("arguments", {})
                    tc_id = tc.get("id") or str(uuid.uuid4())[:8]
                    if isinstance(args, str):
                        try:
                            args = json.loads(args)
                        except Exception:
                            args = {}

                    yield json.dumps({"type": "tool_call", "id": tc_id, "name": tc_name, "args": args}) + "\n"

                    try:
                        result_val = await registry.aexecute(tc_name, args)
                        result_str, ok = str(result_val), True
                    except Exception as e:
                        result_str, ok = str(e), False

                    yield json.dumps({"type": "tool_result", "id": tc_id, "name": tc_name, "result": result_str, "ok": ok}) + "\n"
                    current_messages.append({"role": "tool", "tool_call_id": tc_id, "name": tc_name, "content": result_str})

            yield json.dumps({"type": "error", "error": "Max tool iterations reached"}) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "error": f"Internal error: {e}"}) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson")


@app.post("/admin/chat/compact")
async def compact_chat(request: Request):
    """Summarise all but the last 3 messages into a single summary system message."""
    from proxy import _compress_context
    body_json = await request.json()
    messages: list = list(body_json.get("messages", []))
    model: str = body_json.get("model", "")

    if model == "mollama":
        fb = await core.get_any_available_model()
        if fb:
            _, target_url, model = fb
        else:
            raise HTTPException(status_code=503, detail="No models available")
    else:
        active = core.get_active_instances()
        if not active:
            raise HTTPException(status_code=503, detail="No instances available")
        _, target_url = active[0]

    # Force-enable compression for this call by temporarily patching settings
    import json as _json
    from pathlib import Path as _Path
    settings_path = _Path("/data/settings.json")
    original = {}
    try:
        if settings_path.exists():
            original = _json.loads(settings_path.read_text())
        patched = {**original, "context_compression": True}
        settings_path.write_text(_json.dumps(patched))
        compacted = await _compress_context(messages, model, target_url)
    finally:
        settings_path.write_text(_json.dumps(original))

    return {"messages": compacted, "compacted": len(messages) != len(compacted)}


@app.post("/admin/tools/upload")
async def upload_tool_file(request: Request) -> dict:
    form = await request.form()
    file = form.get("file")
    if not file:
        raise HTTPException(status_code=400, detail="missing file")
    content = await file.read()
    path = file.filename
    if not path:
        raise HTTPException(status_code=400, detail="missing filename")
    try:
        registry.write_tool_file(path, content.decode("utf-8", errors="replace"))
        return {"ok": True, "path": path}
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# ── MCP Servers ───────────────────────────────────────────────────────────────

@app.get("/admin/mcp/servers")
def list_mcp_servers() -> dict:
    return {"servers": mcp_manager.list_servers()}


@app.post("/admin/mcp/servers")
async def add_mcp_server(body: dict) -> dict:
    name = body.get("name")
    if not name:
        raise HTTPException(status_code=400, detail="missing name")
    mcp_manager.add_server(name, {k: v for k, v in body.items() if k != "name"})
    if body.get("autoconnect", True):
        ok = await mcp_manager.connect_server(name)
        return {"ok": True, "connected": ok}
    return {"ok": True, "connected": False}


@app.delete("/admin/mcp/servers/{name}")
async def remove_mcp_server(name: str) -> dict:
    mcp_manager.remove_server(name)
    return {"ok": True}


@app.post("/admin/mcp/servers/{name}/connect")
async def connect_mcp_server(name: str) -> dict:
    ok = await mcp_manager.connect_server(name)
    return {"ok": ok}


@app.post("/admin/mcp/servers/{name}/disconnect")
async def disconnect_mcp_server(name: str) -> dict:
    await mcp_manager.disconnect_server(name)
    return {"ok": True}


@app.get("/admin/mcp/tools")
def list_mcp_tools() -> dict:
    return {"tools": mcp_manager.get_all_tool_schemas()}


# ── Settings ──────────────────────────────────────────────────────────────────

@app.get("/admin/settings")
def get_settings() -> dict:
    return _load_settings()


@app.post("/admin/settings")
def save_settings(body: dict) -> dict:
    current = _load_settings()
    current.update(body)
    _save_settings(current)
    return {"ok": True, "settings": current}


# ── Middleware ────────────────────────────────────────────────────────────────

app.add_middleware(OllamaProxyMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=11111, log_level="info")

if os.path.isdir("frontend_build"):
    app.mount("/", StaticFiles(directory="frontend_build", html=True), name="frontend")