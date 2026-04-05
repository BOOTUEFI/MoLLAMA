# src/backend/core.py
import asyncio
import itertools
import json
import re
import socket
import time
from pathlib import Path
from typing import Any, Optional

import docker as _docker
import httpx

# ── Configuration ─────────────────────────────────────────────────────────────

DATA_FILE = Path("/data/instances.json")
SYSTEM_PROMPT_FILE = Path("/data/system_prompt.txt")
MODEL_METADATA_FILE = Path("/data/model_metadata.json")

CONTAINER_PREFIX = "mollama_"
OLLAMA_IMAGE = "ollama/ollama:latest"
OLLAMA_DOCKERHUB_TAGS_URL = "https://registry.hub.docker.com/v2/repositories/ollama/ollama/tags?page_size=100"

HEALTH_INTERVAL = 8
BAN_DURATION = 30 * 60
MODEL_CACHE_TTL = 45  # seconds
LATEST_VERSION_CACHE_TTL = 10 * 60  # seconds

docker_client = _docker.from_env()

# ── In-memory state ───────────────────────────────────────────────────────────

_health: dict[str, bool] = {}
_banned_until: dict[str, float] = {}

_model_cache: dict[str, list[str]] = {}
_model_cache_ts: float = 0.0

_latest_ollama_version: Optional[str] = None
_latest_ollama_version_ts: float = 0.0
_maintenance_lock: asyncio.Lock | None = None

_maintenance_state: dict[str, Any] = {
    "running": False,
    "paused": False,
    "mode": None,  # "update" | "rebuild" | None
    "progress": 0,
    "message": "Idle",
    "error": None,
    "current_version": None,
    "latest_version": None,
    "total": 0,
    "completed": 0,
    "stop_requested": False,
}


# ── Persistence ───────────────────────────────────────────────────────────────

def load_data() -> dict:
    if DATA_FILE.exists():
        try:
            return json.loads(DATA_FILE.read_text())
        except Exception:
            pass
    return {}


def save_data(data: dict) -> None:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, indent=2))


def load_model_metadata() -> dict[str, dict]:
    if MODEL_METADATA_FILE.exists():
        try:
            payload = json.loads(MODEL_METADATA_FILE.read_text())
            if isinstance(payload, dict):
                return {
                    str(k): v
                    for k, v in payload.items()
                    if isinstance(v, dict)
                }
        except Exception:
            pass
    return {}


def save_model_metadata(data: dict[str, dict]) -> None:
    MODEL_METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    MODEL_METADATA_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False))


def upsert_model_metadata(model_name: str, metadata: dict, source_instance: str = "") -> None:
    current = load_model_metadata()
    existing = current.get(model_name, {})

    merged = dict(existing)
    merged.update(metadata)
    merged["model"] = model_name
    merged["fetched_at"] = time.time()

    if source_instance:
        sources = set(existing.get("sources", [])) if isinstance(existing.get("sources", []), list) else set()
        sources.add(source_instance)
        merged["sources"] = sorted(sources)

    current[model_name] = merged
    save_model_metadata(current)


def get_model_metadata(model_name: str) -> dict:
    return load_model_metadata().get(model_name, {})


def get_active_instances() -> list[tuple[str, str]]:
    now = time.time()
    return [
        (k, v["base_url"])
        for k, v in load_data().items()
        if v.get("active")
        and v.get("base_url")
        and _health.get(k, False)
        and now >= _banned_until.get(k, 0)
    ]


# ── Version / Maintenance ─────────────────────────────────────────────────────

def get_maintenance_lock() -> asyncio.Lock:
    global _maintenance_lock
    if _maintenance_lock is None:
        _maintenance_lock = asyncio.Lock()
    return _maintenance_lock


def get_maintenance_state() -> dict[str, Any]:
    return dict(_maintenance_state)


def set_maintenance_paused(paused: bool) -> None:
    _maintenance_state["paused"] = bool(paused)
    if _maintenance_state.get("running"):
        _maintenance_state["message"] = "Paused" if paused else "Resumed"


def request_maintenance_stop() -> None:
    _maintenance_state["stop_requested"] = True
    if _maintenance_state.get("running"):
        _maintenance_state["message"] = "Stopping..."


def _reset_maintenance_state(mode: Optional[str] = None) -> None:
    _maintenance_state.update(
        {
            "running": False,
            "paused": False,
            "mode": mode,
            "progress": 0,
            "message": "Idle",
            "error": None,
            "current_version": None,
            "latest_version": None,
            "total": 0,
            "completed": 0,
            "stop_requested": False,
        }
    )


def _normalize_version(version: Optional[str]) -> str:
    if not version:
        return ""
    return str(version).strip().lstrip("v").strip()


def _base_semver(version: Optional[str]) -> str:
    """
    Returns the base x.y.z part only.
    Examples:
      0.20.2-rocm -> 0.20.2
      v0.20.2     -> 0.20.2
      0.20.2+abc  -> 0.20.2
    """
    if not version:
        return ""
    text = _normalize_version(version)
    match = re.search(r"(\d+\.\d+\.\d+)", text)
    return match.group(1) if match else ""


def _version_sort_key(version: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", _base_semver(version))
    if not match:
        return (0, 0, 0)
    return tuple(int(x) for x in match.groups())  # type: ignore[return-value]


def versions_match(left: Optional[str], right: Optional[str]) -> bool:
    left_n = _base_semver(left)
    right_n = _base_semver(right)
    return bool(left_n and right_n and left_n == right_n)


def _probe_remote_latest_ollama_version_sync() -> Optional[str]:
    """
    Best-effort latest-version lookup from Docker Hub tag listing.
    Only accepts clean stable semver tags like 0.20.2.
    Ignores variant tags like 0.20.2-rocm, 0.20.2-cuda, rc tags, etc.
    """
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            url = OLLAMA_DOCKERHUB_TAGS_URL
            seen: list[str] = []

            for _ in range(5):
                r = client.get(url)
                if r.status_code != 200:
                    break

                payload = r.json()
                if not isinstance(payload, dict):
                    break

                for item in payload.get("results", []) or []:
                    if not isinstance(item, dict):
                        continue

                    tag_name = item.get("name")
                    if not isinstance(tag_name, str):
                        continue

                    cleaned = _base_semver(tag_name)
                    # only keep exact stable versions, not suffix variants
                    if cleaned and re.fullmatch(r"\d+\.\d+\.\d+", cleaned):
                        seen.append(cleaned)

                next_url = payload.get("next")
                if not next_url:
                    break
                url = str(next_url)

            if seen:
                return max(seen, key=_version_sort_key)
    except Exception:
        pass

    return None

def _probe_local_ollama_version_sync() -> Optional[str]:
    if not docker_client:
        return None

    try:
        image = docker_client.images.get(OLLAMA_IMAGE)
        version = _version_from_image(image)
        if version:
            return version
    except Exception:
        pass

    try:
        output = docker_client.containers.run(
            OLLAMA_IMAGE,
            command=["--version"],
            remove=True,
            detach=False,
        )
        if isinstance(output, bytes):
            output = output.decode("utf-8", errors="replace")
        version = _extract_version(str(output))
        if version:
            return version
    except Exception:
        pass

    return None


def _instance_ollama_version_sync(name: str) -> Optional[str]:
    data = load_data()
    inst = data.get(name)
    if not inst or not inst.get("base_url"):
        return None

    try:
        with httpx.Client(timeout=4) as client:
            r = client.get(f"{inst['base_url'].rstrip('/')}/api/version")
            if r.status_code != 200:
                return None
            payload = r.json()
            if isinstance(payload, dict):
                return _normalize_version(payload.get("version"))
    except Exception:
        pass

    return None


async def get_current_ollama_version() -> Optional[str]:
    candidates: list[str] = []

    main = get_main_node()
    if main:
        candidates.append(main[0])

    data = load_data()
    for name, inst in data.items():
        if inst.get("active") and inst.get("base_url") and name not in candidates:
            candidates.append(name)

    for name in candidates:
        version = await asyncio.to_thread(_instance_ollama_version_sync, name)
        if version:
            return version

    return None


async def get_latest_ollama_version() -> Optional[str]:
    global _latest_ollama_version, _latest_ollama_version_ts

    now = time.time()
    if _latest_ollama_version and (now - _latest_ollama_version_ts) < LATEST_VERSION_CACHE_TTL:
        return _latest_ollama_version

    version = await asyncio.to_thread(_probe_remote_latest_ollama_version_sync)
    if not version:
        version = await asyncio.to_thread(_probe_local_ollama_version_sync)

    if version:
        _latest_ollama_version = version
        _latest_ollama_version_ts = now
        _maintenance_state["latest_version"] = version

    return _latest_ollama_version


async def refresh_latest_ollama_version() -> Optional[str]:
    global _latest_ollama_version, _latest_ollama_version_ts

    if not docker_client:
        return None

    try:
        await asyncio.to_thread(docker_client.images.pull, OLLAMA_IMAGE)
    except Exception:
        pass

    version = await asyncio.to_thread(_probe_remote_latest_ollama_version_sync)
    if not version:
        version = await asyncio.to_thread(_probe_local_ollama_version_sync)

    if version:
        _latest_ollama_version = version
        _latest_ollama_version_ts = time.time()
        _maintenance_state["latest_version"] = version

    return _latest_ollama_version


async def _wait_for_resume_or_stop() -> bool:
    while _maintenance_state.get("paused") and not _maintenance_state.get("stop_requested"):
        await asyncio.sleep(0.5)
    return not _maintenance_state.get("stop_requested")


async def _rebuild_managed_instances_locked() -> dict:
    data = load_data()
    managed = [name for name, inst in data.items() if inst.get("managed")]

    rebuilt: list[str] = []
    failed: list[str] = []

    total = len(managed)
    _maintenance_state["total"] = total
    _maintenance_state["completed"] = 0

    if total == 0:
        _maintenance_state["progress"] = 100
        _maintenance_state["message"] = "No managed instances found."
        return {"rebuilt": [], "failed": []}

    for idx, name in enumerate(managed, start=1):
        if _maintenance_state.get("stop_requested"):
            break

        if not await _wait_for_resume_or_stop():
            break

        _maintenance_state["message"] = f"Rebuilding {name} ({idx}/{total})"
        _maintenance_state["progress"] = 20 + int(((idx - 1) / total) * 80)

        ok = await rebuild_managed_instance(name)
        if ok:
            rebuilt.append(name)
        else:
            failed.append(name)

        _maintenance_state["completed"] = idx
        _maintenance_state["progress"] = 20 + int((idx / total) * 80)

    return {"rebuilt": rebuilt, "failed": failed}


async def rebuild_managed_instance(full_name: str) -> bool:
    data = load_data()
    inst = data.get(full_name)
    if not inst or not inst.get("managed"):
        return False

    was_active = bool(inst.get("active", True))
    was_user_deactivated = bool(inst.get("user_deactivated", False))
    is_local = bool(inst.get("is_local", False))

    try:
        await asyncio.to_thread(recreate_managed_container, full_name, is_local)

        data = load_data()
        if full_name in data:
            data[full_name]["active"] = was_active
            data[full_name]["user_deactivated"] = was_user_deactivated
            save_data(data)

        if not was_active:
            try:
                await asyncio.to_thread(_stop_sync, full_name)
            except Exception:
                pass

        invalidate_model_cache()
        return True
    except Exception:
        return False


async def rebuild_all_managed_instances() -> dict:
    async with get_maintenance_lock():
        _reset_maintenance_state("rebuild")
        _maintenance_state["running"] = True
        _maintenance_state["paused"] = False
        _maintenance_state["stop_requested"] = False
        _maintenance_state["progress"] = 5
        _maintenance_state["message"] = "Rebuilding managed instances..."
        _maintenance_state["error"] = None

        try:
            result = await _rebuild_managed_instances_locked()
            stopped = bool(_maintenance_state.get("stop_requested"))

            _maintenance_state["running"] = False
            _maintenance_state["paused"] = False
            _maintenance_state["progress"] = 100 if not stopped else _maintenance_state.get("progress", 0)
            _maintenance_state["message"] = "Rebuild finished." if not stopped else "Stopped."
            _maintenance_state["stop_requested"] = False

            return {
                "maintenance": get_maintenance_state(),
                **result,
            }
        except Exception as e:
            _maintenance_state["running"] = False
            _maintenance_state["paused"] = False
            _maintenance_state["error"] = str(e)
            _maintenance_state["message"] = str(e)
            return {
                "error": str(e),
                "maintenance": get_maintenance_state(),
            }


async def update_ollama_and_rebuild_managed() -> dict:
    async with get_maintenance_lock():
        _reset_maintenance_state("update")
        _maintenance_state["running"] = True
        _maintenance_state["paused"] = False
        _maintenance_state["stop_requested"] = False
        _maintenance_state["progress"] = 3
        _maintenance_state["message"] = "Pulling latest Ollama image..."
        _maintenance_state["error"] = None

        try:
            latest = await refresh_latest_ollama_version()
            current = await get_current_ollama_version()

            managed_count = sum(1 for inst in load_data().values() if inst.get("managed"))
            _maintenance_state["current_version"] = current
            _maintenance_state["latest_version"] = latest
            _maintenance_state["total"] = managed_count
            _maintenance_state["completed"] = 0
            _maintenance_state["progress"] = 15
            _maintenance_state["message"] = "Rebuilding managed instances..."

            rebuild_result = await _rebuild_managed_instances_locked()

            current = await get_current_ollama_version()
            latest = await get_latest_ollama_version()

            stopped = bool(_maintenance_state.get("stop_requested"))
            done = not stopped and versions_match(current, latest)

            _maintenance_state["current_version"] = current
            _maintenance_state["latest_version"] = latest
            _maintenance_state["running"] = False
            _maintenance_state["paused"] = False
            _maintenance_state["progress"] = 100 if done else _maintenance_state.get("progress", 0)
            _maintenance_state["message"] = "Ollama update finished." if done else ("Stopped." if stopped else "Finished.")
            _maintenance_state["stop_requested"] = False

            return {
                "currentOllamaVersion": current,
                "latestOllamaVersion": latest,
                "isLatest": versions_match(current, latest),
                "maintenance": get_maintenance_state(),
                **rebuild_result,
            }
        except Exception as e:
            _maintenance_state["running"] = False
            _maintenance_state["paused"] = False
            _maintenance_state["error"] = str(e)
            _maintenance_state["message"] = str(e)
            return {
                "error": str(e),
                "maintenance": get_maintenance_state(),
            }


# ── System Prompt ─────────────────────────────────────────────────────────────

def get_system_prompt() -> str:
    if SYSTEM_PROMPT_FILE.exists():
        try:
            return SYSTEM_PROMPT_FILE.read_text().strip()
        except Exception:
            pass
    return ""


def set_system_prompt(prompt: str) -> None:
    SYSTEM_PROMPT_FILE.parent.mkdir(parents=True, exist_ok=True)
    SYSTEM_PROMPT_FILE.write_text(prompt)


# ── Main Node ─────────────────────────────────────────────────────────────────

def get_main_node() -> Optional[tuple[str, str]]:
    """Returns (name, base_url) of the healthy main node, or None."""
    data = load_data()
    for name, inst in data.items():
        if inst.get("is_main") and inst.get("active") and inst.get("base_url"):
            if _health.get(name, False):
                return name, inst["base_url"]
    return None


def set_main_node(full_name: str) -> None:
    data = load_data()
    for name in data:
        data[name]["is_main"] = (name == full_name)
    save_data(data)


def unset_main_node(full_name: str) -> None:
    data = load_data()
    if full_name in data:
        data[full_name]["is_main"] = False
    save_data(data)


# ── Round-Robin Pool ──────────────────────────────────────────────────────────

_pool_iters: dict[Optional[str], itertools.cycle] = {}
_last_inst_sets: dict[Optional[str], set[tuple[str, str]]] = {}


async def next_instance(exclude: frozenset[str] = frozenset(), required_model: Optional[str] = None) -> Optional[tuple[str, str]]:
    """
    Returns the next healthy instance via round-robin, optionally filtering by
    `required_model`, and skipping any whose name is in `exclude`.
    """
    global _pool_iters, _last_inst_sets

    all_active = get_active_instances()
    if not all_active:
        return None

    if required_model:
        models_map = await get_all_instance_models_cached()
        valid_active = []
        for name, url in all_active:
            if required_model in models_map.get(name, []):
                valid_active.append((name, url))
        all_active = valid_active

    if not all_active:
        return None

    active_set = set(all_active)

    pool_iter = _pool_iters.get(required_model)
    last_inst_set = _last_inst_sets.get(required_model)

    if active_set != last_inst_set:
        _last_inst_sets[required_model] = active_set
        pool_iter = itertools.cycle(all_active)
        _pool_iters[required_model] = pool_iter

    if not pool_iter:
        return None

    for _ in range(len(all_active)):
        candidate = next(pool_iter)
        if candidate[0] not in exclude:
            return candidate

    return None


# ── Health Checker ────────────────────────────────────────────────────────────

async def health_check_loop() -> None:
    while True:
        now = time.time()
        data = load_data()
        async with httpx.AsyncClient(timeout=3) as client:
            for name, inst in data.items():
                url = inst.get("base_url")
                if not url or not inst.get("active", True):
                    _health[name] = False
                    continue
                if now < _banned_until.get(name, 0):
                    _health[name] = False
                    continue
                try:
                    r = await client.get(f"{url.rstrip('/')}/api/tags")
                    if r.status_code == 200:
                        _health[name] = True
                        if name in _banned_until:
                            del _banned_until[name]
                    elif r.status_code == 429:
                        _health[name] = False
                        _banned_until[name] = now + BAN_DURATION
                    else:
                        _health[name] = False
                except Exception:
                    _health[name] = False
        await asyncio.sleep(HEALTH_INTERVAL)


# ── Model Cache ───────────────────────────────────────────────────────────────

async def _update_model_cache():
    """Internal helper to refresh the model cache from all healthy instances."""
    global _model_cache, _model_cache_ts
    data = load_data()
    new_cache = {}

    async with httpx.AsyncClient(timeout=2.0) as client:
        for name, info in data.items():
            if not _health.get(name, True):
                continue
            try:
                url = info.get("base_url")
                if not url:
                    continue
                resp = await client.get(f"{url.rstrip('/')}/api/tags")
                if resp.status_code == 200:
                    tags = resp.json()
                    instance_models = []

                    models_list = tags.get("models", []) if isinstance(tags, dict) else tags

                    for model in models_list:
                        raw_name = model["name"] if isinstance(model, dict) else model
                        if not raw_name:
                            continue

                        instance_models.append(raw_name)

                    new_cache[name] = list(set(instance_models))
            except Exception:
                continue

    _model_cache = new_cache
    _model_cache_ts = time.time()


async def get_all_instance_models_cached() -> dict[str, list[str]]:
    """Returns {instance_name: [model_names]} with TTL-based caching."""
    global _model_cache, _model_cache_ts
    now = time.time()
    if now - _model_cache_ts < MODEL_CACHE_TTL and _model_cache:
        return _model_cache

    await _update_model_cache()
    return _model_cache


def invalidate_model_cache() -> None:
    global _model_cache_ts
    _model_cache_ts = 0.0


def invalidate_model_metadata_cache() -> None:
    # Present for symmetry; metadata is read from disk on demand.
    return


# ── Smart Model Selection ─────────────────────────────────────────────────────

_ROUTER_SYSTEM = (
    "You are a strict model router.\n"
    "Choose exactly one model from the provided list that best fits the user task.\n"
    "Use the model name and the model card as the source of truth.\n"
    "Prefer specialist models over general models when the task clearly matches.\n"
    "Prefer code-focused models for programming, debugging, refactoring, JSON, APIs, shell, and system tasks.\n"
    "Prefer reasoning-heavy models for planning, multi-step analysis, ambiguity, math, and synthesis.\n"
    "Prefer writing-focused models for prose, tone, rewriting, and style-sensitive tasks.\n"
    "If multiple models fit, choose the most capable specialized model available.\n"
    "If no model clearly fits, choose the strongest general model in the list.\n"
    "You must return ONLY the exact model name from the list.\n"
    "Do not add punctuation, quotes, markdown, explanations, or extra words."
)


def _truncate_text(text: str, max_chars: int = 900, max_lines: int = 20) -> str:
    if not text:
        return ""
    lines = text.strip().splitlines()
    if len(lines) > max_lines:
        lines = lines[:max_lines]
    text = "\n".join(lines).strip()
    if len(text) > max_chars:
        text = text[:max_chars].rstrip()
    return text


def _compact_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (list, tuple, set)):
        return ", ".join(str(v) for v in value if v is not None and str(v).strip())
    if isinstance(value, dict):
        return ", ".join(f"{k}={v}" for k, v in value.items() if v is not None and str(v).strip())
    return str(value)


def _build_router_card(model_name: str, meta: dict) -> str:
    if not meta:
        return "No stored description yet."

    parts: list[str] = []

    details = meta.get("details") if isinstance(meta.get("details"), dict) else {}
    model_info = meta.get("model_info") if isinstance(meta.get("model_info"), dict) else {}

    family = details.get("family") or ""
    families = details.get("families") or []
    if not family and isinstance(families, list) and families:
        family = str(families[0])

    parameter_size = details.get("parameter_size") or ""
    quantization = details.get("quantization_level") or ""
    fmt = details.get("format") or ""
    parent_model = details.get("parent_model") or ""

    capabilities = meta.get("capabilities") if isinstance(meta.get("capabilities"), list) else []
    parameters = _truncate_text(_compact_value(meta.get("parameters")), 280, 6)
    license_text = _truncate_text(_compact_value(meta.get("license")), 180, 4)
    template = _truncate_text(_compact_value(meta.get("template")), 220, 4)

    if family or parameter_size or quantization or fmt or parent_model:
        bits = []
        if family:
            bits.append(f"family={family}")
        if parameter_size:
            bits.append(f"size={parameter_size}")
        if quantization:
            bits.append(f"quant={quantization}")
        if fmt:
            bits.append(f"format={fmt}")
        if parent_model:
            bits.append(f"parent={parent_model}")
        parts.append("profile: " + "; ".join(bits))

    if capabilities:
        parts.append("capabilities: " + ", ".join(str(x) for x in capabilities if str(x).strip()))

    if parameters:
        parts.append("parameters: " + parameters)

    if license_text:
        parts.append("license: " + license_text)

    context_keys = [
        "general.context_length",
        f"{family}.context_length" if family else "",
    ]
    for k in context_keys:
        if k and k in model_info:
            parts.append(f"context: {model_info[k]}")
            break

    if template:
        parts.append("template: " + template)

    if not parts:
        return "No usable metadata stored yet."

    return _truncate_text("\n".join(parts), 900, 16)


async def _fetch_model_metadata_from_instance(name: str, model: str) -> dict:
    data = load_data()
    inst = data.get(name)
    if not inst or not inst.get("base_url"):
        return {}

    url = f"{inst['base_url'].rstrip('/')}/api/show"
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(url, json={"model": model})
        if r.status_code != 200:
            return {}

        payload = r.json()
        if not isinstance(payload, dict):
            return {}

        payload["model"] = model
        payload["source_instance"] = name
        payload["source_base_url"] = inst["base_url"]
        payload["fetched_at"] = time.time()
        return payload


async def _refresh_model_metadata(name: str, model: str) -> None:
    try:
        payload = await _fetch_model_metadata_from_instance(name, model)
        if payload:
            upsert_model_metadata(model, payload, source_instance=name)
    except Exception:
        pass


async def select_best_model_for_prompt(
    messages: list[dict],
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Uses the main node's first model to pick the best model for the prompt.
    Returns (instance_name, base_url, model_name) or (None, None, None).
    """
    main = get_main_node()
    if not main:
        return None, None, None

    main_name, main_url = main
    all_models = await get_all_instance_models_cached()

    main_models = all_models.get(main_name, [])
    if not main_models:
        return None, None, None

    selector_model = main_models[0]
    flat_models = sorted({m for mlist in all_models.values() for m in mlist if m})
    if not flat_models:
        return None, None, None

    metadata = load_model_metadata()

    last_user_content = ""
    for msg in reversed(messages):
        if msg.get("role") == "user":
            content = msg.get("content", "")
            last_user_content = content[:1200] if isinstance(content, str) else str(content)[:1200]
            break

    model_lines = []
    for model_name in flat_models:
        card = _build_router_card(model_name, metadata.get(model_name, {}))
        model_lines.append(f"- {model_name}\n  {card}")

    routing_prompt = (
        "Available models:\n\n"
        + "\n\n".join(model_lines)
        + f"\n\nUser prompt:\n{last_user_content}\n\nBest model:"
    )

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post(
                f"{main_url.rstrip('/')}/api/chat",
                json={
                    "model": selector_model,
                    "messages": [
                        {"role": "system", "content": _ROUTER_SYSTEM},
                        {"role": "user", "content": routing_prompt},
                    ],
                    "stream": False,
                    "options": {
                        "temperature": 0,
                        "top_p": 1,
                    },
                },
            )
            if r.status_code != 200:
                return None, None, None

            raw = r.json().get("message", {}).get("content", "").strip()

            chosen = None
            for model in flat_models:
                if raw == model:
                    chosen = model
                    break

            if not chosen:
                return None, None, None

            data = load_data()
            for inst_name, mlist in all_models.items():
                if chosen in mlist and _health.get(inst_name, False):
                    inst = data.get(inst_name, {})
                    return inst_name, inst.get("base_url", ""), chosen

    except Exception:
        pass

    return None, None, None


async def get_any_available_model() -> Optional[tuple[str, str, str]]:
    """Fallback: any healthy instance with at least one model."""
    all_models = await get_all_instance_models_cached()
    data = load_data()
    for inst_name, mlist in all_models.items():
        if mlist and _health.get(inst_name, False):
            inst = data.get(inst_name, {})
            return inst_name, inst.get("base_url", ""), mlist[0]
    return None


# ── Docker Helpers ────────────────────────────────────────────────────────────

def _get_current_network() -> str:
    if not docker_client:
        return "mollama_network"
    try:
        c = docker_client.containers.get(socket.gethostname())
        return list(c.attrs["NetworkSettings"]["Networks"].keys())[0]
    except Exception:
        return "mollama_network"


def _docker_container_status(full_name: str) -> str:
    if not docker_client:
        return "unknown"
    try:
        c = docker_client.containers.get(full_name)
        return c.status
    except Exception:
        return "missing"


async def pull_model_on_instance(name: str, model: str):
    data = load_data()
    inst = data.get(name)
    if not inst or not inst.get("base_url"):
        yield json.dumps({"error": "Instance not found"}).encode()
        return

    url = f"{inst['base_url'].rstrip('/')}/api/pull"
    pulled = False

    async with httpx.AsyncClient(timeout=None) as client:
        try:
            async with client.stream("POST", url, json={"model": model}) as r:
                if r.status_code != 200:
                    payload = await r.aread()
                    yield payload if payload else json.dumps({"error": "Pull failed"}).encode()
                    return

                pulled = True
                async for chunk in r.aiter_bytes():
                    yield chunk
        finally:
            if pulled:
                await _refresh_model_metadata(name, model)
                invalidate_model_cache()


async def fetch_instance_models(name: str) -> list[str]:
    data = load_data()
    inst = data.get(name)
    if not inst or not inst.get("base_url"):
        return []
    async with httpx.AsyncClient(timeout=5) as client:
        try:
            r = await client.get(f"{inst['base_url'].rstrip('/')}/api/tags")
            if r.status_code == 200:
                payload = r.json()
                items = payload.get("models", []) if isinstance(payload, dict) else payload
                return [item["name"] if isinstance(item, dict) else item for item in items]
        except Exception:
            pass
    return []


async def delete_model_on_instance(name: str, model: str) -> dict:
    data = load_data()
    inst = data.get(name)
    if not inst or not inst.get("base_url"):
        return {"ok": False, "error": "Instance not found"}
    url = f"{inst['base_url'].rstrip('/')}/api/delete"
    async with httpx.AsyncClient(timeout=30) as client:
        try:
            r = await client.request("DELETE", url, json={"name": model})
            invalidate_model_cache()
            return {"ok": r.status_code in (200, 204), "status": r.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def recreate_managed_container(name: str, is_local: bool):
    clean_name = name.replace(CONTAINER_PREFIX, "")
    _remove_sync(name)
    _deploy_sync(clean_name, is_local=is_local)


def _get_compose_metadata():
    if not docker_client:
        return "mollama", "mollama_network"
    try:
        c = docker_client.containers.get(socket.gethostname())
        project = c.labels.get("com.docker.compose.project", "mollama")
        network = list(c.attrs["NetworkSettings"]["Networks"].keys())[0]
        return project, network
    except Exception:
        return "mollama", "mollama_network"


def _deploy_sync(clean_name: str, is_local: bool = False) -> None:
    full_name = f"{CONTAINER_PREFIX}{clean_name}"
    project, network = _get_compose_metadata()

    shared_vol_name = f"{project}_ollama_shared_models"
    config_vol_name = f"{project}_config_{clean_name}"

    for vol in [shared_vol_name, config_vol_name]:
        try:
            docker_client.volumes.get(vol)
        except Exception:
            docker_client.volumes.create(name=vol, labels={"com.docker.compose.project": project})

    env_vars = {"OLLAMA_KEEP_ALIVE": "5m" if is_local else "0"}
    device_requests = []
    mem_limit = None

    if is_local:
        device_requests = [_docker.types.DeviceRequest(count=-1, capabilities=[["gpu"]])]
    else:
        env_vars.update({"OLLAMA_MAX_VRAM": "0", "GOGC": "20", "GOMEMLIMIT": "100MiB"})
        mem_limit = "150m"

    docker_client.containers.run(
        OLLAMA_IMAGE,
        name=full_name,
        detach=True,
        network=network,
        volumes={
            config_vol_name: {"bind": "/root/.ollama", "mode": "rw"},
            shared_vol_name: {"bind": "/root/.ollama/models", "mode": "rw"},
        },
        environment=env_vars,
        mem_limit=mem_limit,
        device_requests=device_requests,
        restart_policy={"Name": "unless-stopped"},
        labels={
            "com.docker.compose.project": project,
            "com.docker.compose.service": f"dynamic_ollama_{clean_name}",
            "mollama_managed": "true",
        },
    )


def _start_sync(full_name: str) -> None:
    c = docker_client.containers.get(full_name)
    c.reload()
    network = _get_current_network()
    for net_name in list(c.attrs["NetworkSettings"]["Networks"].keys()):
        try:
            docker_client.networks.get(net_name).disconnect(c, force=True)
        except Exception:
            pass
    try:
        docker_client.networks.get(network).connect(c)
    except Exception:
        pass
    c.start()


def _stop_sync(full_name: str) -> None:
    docker_client.containers.get(full_name).stop()


def _remove_sync(full_name: str) -> None:
    try:
        c = docker_client.containers.get(full_name)
        if c.status == "running":
            c.stop()
        c.remove()
    except Exception:
        pass


def _stop_all_managed_sync() -> None:
    data = load_data()
    for name, inst in data.items():
        if inst.get("managed"):
            try:
                _stop_sync(name)
            except Exception:
                pass


def get_container_key(iname: str) -> str:
    if not docker_client:
        return "Error: Docker socket not accessible."
    try:
        c = docker_client.containers.get(iname)
        res = c.exec_run("cat /root/.ollama/id_ed25519.pub")
        return res.output.decode().strip()
    except Exception as e:
        return f"Error: {e}"


# ── Deploy ────────────────────────────────────────────────────────────────────

async def deploy_new_ollama(clean_name: str, is_local: bool = False) -> bool:
    if not docker_client or not clean_name:
        return False
    full_name = f"{CONTAINER_PREFIX}{clean_name}"
    data = load_data()
    if full_name in data:
        return False
    try:
        await asyncio.to_thread(_deploy_sync, clean_name, is_local)
        data = load_data()
        data[full_name] = {
            "base_url": f"http://{full_name}:11434",
            "active": True,
            "managed": True,
            "is_local": is_local,
            "is_main": False,
        }
        save_data(data)
        return True
    except Exception:
        return False


# ── Lifecycle ─────────────────────────────────────────────────────────────────

async def _autostart_managed() -> None:
    if not docker_client:
        return
    data = load_data()
    changed = False
    for name, inst in data.items():
        if not inst.get("managed"):
            continue
        status = _docker_container_status(name)
        if status == "running":
            continue
        if status == "missing":
            data[name]["active"] = False
            changed = True
            continue
        try:
            await asyncio.to_thread(_start_sync, name)
            if not inst.get("user_deactivated"):
                data[name]["active"] = True
                changed = True
        except Exception:
            data[name]["active"] = False
            changed = True
    if changed:
        save_data(data)


async def _shutdown_managed() -> None:
    if not docker_client:
        return

    def get_managed_containers():
        try:
            return docker_client.containers.list(filters={"label": "mollama_managed=true"})
        except Exception:
            return []

    containers = await asyncio.to_thread(get_managed_containers)
    if not containers:
        return

    def stop_single_container(c):
        try:
            c.stop(timeout=3)
        except Exception:
            pass

    await asyncio.gather(
        *(asyncio.to_thread(stop_single_container, c) for c in containers),
        return_exceptions=True,
    )