import json
import time
import uuid
import asyncio
import httpx
import re
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import StreamingResponse

import core
import events as _ev
from tools import registry

# ── Context compression ────────────────────────────────────────────────────────

COMPRESSION_KEEP_RECENT = 3


def _load_settings() -> dict:
    f = Path("/data/settings.json")
    if f.exists():
        try:
            return json.loads(f.read_text())
        except Exception:
            pass
    return {}


async def _compress_context(messages: list[dict], model: str, target_url: str) -> list[dict]:
    """Auto-compact: summarise old messages every 3 messages when enabled."""
    settings = _load_settings()
    if not settings.get("context_compression", False):
        return messages

    system_msgs = [m for m in messages if m.get("role") == "system"]
    non_system  = [m for m in messages if m.get("role") != "system"]
    if len(non_system) <= COMPRESSION_KEEP_RECENT:
        return messages

    to_compress = non_system[:-COMPRESSION_KEEP_RECENT]
    to_keep     = non_system[-COMPRESSION_KEEP_RECENT:]

    history_text = "\n".join(
        f"{m['role'].upper()}: {str(m.get('content', ''))[:600]}"
        for m in to_compress
    )
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{target_url.rstrip('/')}/api/chat",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "Summarise the conversation below in 2-3 sentences. Be concise."},
                        {"role": "user",   "content": history_text},
                    ],
                    "stream": False,
                    "options": {"temperature": 0},
                },
            )
            if r.status_code == 200:
                summary = r.json().get("message", {}).get("content", "").strip()
                if summary:
                    summary_msg = {"role": "system", "content": f"[Earlier conversation summary]: {summary}"}
                    return system_msgs + [summary_msg] + to_keep
    except Exception:
        pass

    return messages

## ── HELPER FUNCTIONS ───────────────────────────────────────────────────────

def _extract_content_from_data(data: dict) -> str:
    """Helper to pull text out of standard Ollama/OpenAI/Anthropic response objects."""
    if not isinstance(data, dict):
        return ""

    msg = data.get("message", {}) or {}
    choices = data.get("choices", []) or []
    
    # Check first choice for standard message or delta (streaming)
    choice_msg = choices[0].get("message", {}) if choices else {}
    choice_delta = choices[0].get("delta", {}) if choices else {}

    return (
        msg.get("content")
        or choice_msg.get("content")
        or choice_delta.get("content")
        or data.get("response")
        or ""
    )


def _normalize_tool_calls(msg: dict, content: str):
    """Parses tool calls from both JSON (Standard) and XML (Fallback) formats."""
    tool_calls_json = msg.get("tool_calls", []) or []

    normalized = []
    for tc in tool_calls_json:
        if isinstance(tc, dict):
            tc = dict(tc)
            tc.setdefault("id", str(uuid.uuid4()))
            normalized.append(tc)

    tool_calls_json = normalized
    
    # Fallback for XML style tool calls (common in some Ollama models)
    has_xml_tools = "<function_calls>" in (content or "")
    if has_xml_tools and not tool_calls_json:
        match = re.search(
            r'<invoke name="(.*?)">.*?<parameter name="(.*?)".*?>(.*?)</parameter>',
            content or "",
            re.DOTALL,
        )
        if match:
            f_name, p_name, p_val = match.groups()
            tool_calls_json = [{
                "id": str(uuid.uuid4()),
                "function": {
                    "name": f_name,
                    "arguments": json.dumps({p_name: p_val}),
                },
            }]

    return tool_calls_json, has_xml_tools


## ── INTERNAL TOOL LOOP ────────────────────────────────────────────────────

async def _run_internal_tool_loop(
    client: httpx.AsyncClient,
    url: str,
    headers: dict,
    base_body_json: dict,
    method: str,
    max_loops: int = 50,
):
    """Runs tool calls internally and returns the final response data."""
    working_body = json.loads(json.dumps(base_body_json))
    working_body["stream"] = False
    
    is_v1 = "/v1" in url
    final_data = None
    final_headers = {}
    final_status = 503
    final_raw = b""

    for loop_idx in range(max_loops):
        if registry.schemas:
            working_body["tools"] = registry.schemas

        req = client.build_request(
            method=method,
            url=url,
            headers=headers,
            content=json.dumps(working_body).encode("utf-8"),
        )

        resp = await client.send(req)
        final_status = resp.status_code
        final_headers = dict(resp.headers)

        if resp.status_code != 200:
            final_raw = await resp.aread()
            try:
                final_data = json.loads(final_raw.decode("utf-8", errors="ignore"))
            except:
                final_data = {"error": "Upstream error or malformed JSON"}
            await resp.aclose()
            return final_data, final_headers, final_status, final_raw

        try:
            final_data = resp.json()
        except:
            raw_text = (await resp.aread()).decode("utf-8", errors="ignore")
            final_data = {"choices": [{"message": {"content": raw_text}}]} if is_v1 else {"message": {"content": raw_text}}
        
        await resp.aclose()

        msg = final_data.get("message", {}) or {}
        choices = final_data.get("choices", []) or []
        if not msg and choices and isinstance(choices[0], dict):
            msg = choices[0].get("message", {})
            
        content = msg.get("content", "") or ""
        tool_calls_json, _ = _normalize_tool_calls(msg, content)

        if not tool_calls_json:
            return final_data, final_headers, final_status, b""

        messages = working_body.get("messages", [])
        messages.append({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls_json,
        })

        for tc in tool_calls_json:
            func = tc.get("function", {})
            f_name = func.get("name")
            args = func.get("arguments", "{}")
            
            if not f_name:
                continue

            # JSON Argument Validation
            if isinstance(args, str):
                try:
                    json.loads(args)
                except json.JSONDecodeError:
                    messages.append({
                        "role": "tool",
                        "tool_call_id": tc.get("id"),
                        "name": f_name,
                        "content": "Error: Malformed JSON arguments. Please retry with valid syntax.",
                    })
                    tc["function"]["arguments"] = "{}" 
                    continue

            try:
                result = await registry.aexecute(f_name, args)
            except Exception as e:
                result = f"Error: {str(e)}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "name": f_name,
                "content": str(result),
            })

        working_body["messages"] = messages

    error_msg = "Tool loop exceeded maximum iterations"
    if is_v1:
        return {"choices": [{"message": {"content": error_msg}, "finish_reason": "error"}]}, final_headers, 500, b""
    return {"message": {"content": error_msg}}, final_headers, 500, b""


## ── PROXY ENTRY POINT ─────────────────────────────────────────────────────

async def _proxy(request: Request, upstream_path: str) -> Response:
    req_id = str(uuid.uuid4())[:8]
    body = await request.body()
    
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "transfer-encoding", "authorization")
    }

    is_stream = True
    body_json = {}

    if body:
        try:
            body_json = json.loads(body)
            is_stream = body_json.get("stream", True)
        except Exception:
            pass

    # 1. DIALECT TRANSLATION
    dialect = "ollama"
    if upstream_path.startswith("/v1/messages"):
        dialect = "anthropic"
        upstream_path = "/api/chat"
        if isinstance(body_json, dict):
            new_body = {
                "model": body_json.get("model", ""),
                "stream": body_json.get("stream", True),
                "messages": [],
                "options": {}
            }
            if "system" in body_json:
                sys_val = body_json["system"]
                sys_text = "".join(b.get("text", "") for b in sys_val if isinstance(b, dict)) if isinstance(sys_val, list) else str(sys_val)
                if sys_text:
                    new_body["messages"].append({"role": "system", "content": sys_text})

            for m in body_json.get("messages", []):
                content = m.get("content", "")
                if isinstance(content, list):
                    content = "".join(b.get("text", "") for b in content if b.get("type") == "text")
                new_body["messages"].append({"role": m.get("role", "user"), "content": content})

            if "max_tokens" in body_json: new_body["options"]["num_predict"] = body_json["max_tokens"]
            if "temperature" in body_json: new_body["options"]["temperature"] = body_json["temperature"]
            body_json = new_body
            is_stream = body_json.get("stream", True)

    elif upstream_path.startswith("/v1/"):
        dialect = "openai"

    # 2. SMART COMMAND HANDLING (/mollama)
    should_use_tools = False
    if isinstance(body_json, dict) and "messages" in body_json:
        messages = body_json["messages"]
        if messages and isinstance(messages, list):
            last_user_msg = next((m for m in reversed(messages) if m.get("role") == "user"), None)
            if last_user_msg:
                content = last_user_msg.get("content", "")
                if isinstance(content, str) and content.strip().startswith("/mollama"):
                    should_use_tools = True
                    last_user_msg["content"] = re.sub(r'^/mollama\s*', '', content)
                elif isinstance(content, list):
                    for part in content:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text_val = part.get("text", "")
                            if text_val.strip().startswith("/mollama"):
                                should_use_tools = True
                                part["text"] = re.sub(r'^/mollama\s*', '', text_val)

    # 3. SYSTEM PROMPT, TOOL INJECTION & CONTEXT COMPRESSION
    if isinstance(body_json, dict) and "messages" in body_json:
        sys_prompt = core.get_system_prompt()
        if sys_prompt:
            messages = body_json["messages"]
            if messages and messages[0].get("role") == "system":
                messages[0]["content"] = sys_prompt + "\n\n" + messages[0]["content"]
            else:
                messages.insert(0, {"role": "system", "content": sys_prompt})

        # Context compression: summarise long histories to reduce token usage
        _compress_url = None
        _compress_model = body_json.get("model", "")
        active = core.get_active_instances()
        if active:
            _compress_url = active[0][1]
        if _compress_url and body_json.get("messages"):
            body_json["messages"] = await _compress_context(
                body_json["messages"], _compress_model, _compress_url
            )

        # MCP schemas are always merged into local tool schemas
        from mcp_manager import mcp_manager
        mcp_schemas = mcp_manager.get_all_tool_schemas()
        if mcp_schemas:
            registry.set_extra_schemas(mcp_schemas)

        if should_use_tools and registry.schemas:
            body_json["tools"] = registry.schemas
        else:
            body_json.pop("tools", None)

    # 4. ROUTING
    target_override = None
    requested_model = body_json.get("model") if isinstance(body_json, dict) else None

    if requested_model == "mollama":
        t_name, t_url, actual_model = await core.select_best_model_for_prompt(body_json.get("messages", []))
        if not actual_model:
            fallback = await core.get_any_available_model()
            if fallback: t_name, t_url, actual_model = fallback

        if actual_model:
            body_json["model"] = actual_model
            requested_model = actual_model
            target_override = (t_name, t_url)
        else:
            return Response(content=json.dumps({"error": "No healthy models available"}), status_code=503)

    body = json.dumps(body_json).encode("utf-8")
    _ev.log({"kind": "in", "req_id": req_id, "method": request.method, "path": upstream_path, "model": requested_model})

    # 5. RETRY LOOP
    client = httpx.AsyncClient(timeout=600)
    try:
        for attempt in range(3):
            if target_override:
                target = target_override
                target_override = None
            else:
                target = await core.next_instance(required_model=requested_model)

            if not target:
                return Response(content=json.dumps({"error": "No instances hosting this model"}), status_code=503)

            target_name, target_url = target
            _ev.set_processing(target_name, True)
            url = f"{target_url.rstrip('/')}/{upstream_path.lstrip('/')}"
            t0 = time.time()

            try:
                if should_use_tools:
                    final_data, final_headers, final_status, final_raw = await _run_internal_tool_loop(
                        client=client, url=url, headers=headers, base_body_json=body_json, method=request.method
                    )
                    if final_status >= 500:
                        _ev.set_processing(target_name, False)
                        continue

                    if not is_stream:
                        return Response(content=json.dumps(final_data), status_code=final_status)

                    async def stream_tool_result():
                        full_txt = _extract_content_from_data(final_data)
                        _ev.update_stream(req_id, "", False, target_name, upstream_path, t0)
                        try:
                            for i in range(0, len(full_txt), 12):
                                chunk = full_txt[i:i+12]
                                if dialect == "openai":
                                    yield f"data: {json.dumps({'choices': [{'delta': {'content': chunk}}]})}\n\n".encode()
                                else:
                                    yield json.dumps({"message": {"content": chunk}, "done": False}).encode() + b"\n"
                                await asyncio.sleep(0.01)
                            if dialect == "openai": yield b"data: [DONE]\n\n"
                        finally:
                            _ev.update_stream(req_id, full_txt, True)
                            _ev.set_processing(target_name, False)
                    return StreamingResponse(stream_tool_result(), media_type="text/event-stream")

                # Standard Proxy
                if is_stream:
                    req = client.build_request(method=request.method, url=url, headers=headers, content=body)
                    resp = await client.send(req, stream=True)
                    if resp.status_code in (401, 403, 429) or resp.status_code >= 500:
                        await resp.aclose()
                        continue
                    
                    async def stream_gen():
                        try:
                            async for line in resp.aiter_lines():
                                yield (line + "\n").encode()
                        finally:
                            await resp.aclose()
                            _ev.set_processing(target_name, False)
                    return StreamingResponse(stream_gen(), status_code=resp.status_code)
                else:
                    resp = await client.request(method=request.method, url=url, headers=headers, content=body)
                    _ev.set_processing(target_name, False)
                    if resp.status_code in (401, 403, 429) or resp.status_code >= 500: continue
                    return Response(content=resp.content, status_code=resp.status_code, headers=dict(resp.headers))

            except Exception:
                _ev.set_processing(target_name, False)
                continue

        return Response(content=b'{"error": "Retries exhausted"}', status_code=503)
    finally:
        if not is_stream: await client.aclose()
