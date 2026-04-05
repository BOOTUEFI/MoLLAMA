# src/backend/main.py
import signal
import time
import asyncio
from typing import Any
import os
import json

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from fastapi.staticfiles import StaticFiles

import core
import events as _ev
from middleware import OllamaProxyMiddleware

import httpx


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state._autostart_task = asyncio.create_task(core._autostart_managed())
    app.state._health_task = asyncio.create_task(core.health_check_loop())
    app.state._bg_tasks = set()
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

        for tname in ("_autostart_task", "_health_task"):
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(OllamaProxyMiddleware)

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=11111, log_level="info")

if os.path.isdir("frontend_build"):
    app.mount("/", StaticFiles(directory="frontend_build", html=True), name="frontend")