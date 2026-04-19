import json
import time
import uuid
import asyncio
import httpx
import re

from fastapi import Request, Response
from fastapi.responses import StreamingResponse

import core
import events as _ev
from tools import registry


def _extract_content_from_data(data: dict) -> str:
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
    tool_calls_json = msg.get("tool_calls", []) or []

    normalized = []
    for tc in tool_calls_json:
        if isinstance(tc, dict):
            tc = dict(tc)
            tc.setdefault("id", str(uuid.uuid4()))
            normalized.append(tc)

    tool_calls_json = normalized
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


async def _run_internal_tool_loop(
    client: httpx.AsyncClient,
    url: str,
    headers: dict,
    base_body_json: dict,
    method: str,
    max_loops: int = 3,
):
    """
    Runs tool calls fully internally and returns only the final response data.
    This never exposes tool calls to the downstream client.
    """
    working_body = json.loads(json.dumps(base_body_json))
    working_body["stream"] = False
    
    # Check if we are targeting an OpenAI-style endpoint
    is_v1 = "/v1" in url

    final_data = None
    final_headers = {}
    final_status = 503
    final_raw = b""

    for _ in range(max_loops):
        req = client.build_request(
            method=method,
            url=url,
            headers=headers,
            content=json.dumps(working_body).encode("utf-8"),
        )

        resp = await client.send(req)
        final_status = resp.status_code
        final_headers = dict(resp.headers)

        try:
            final_raw = await resp.aread() if resp.status_code != 200 else b""
        except Exception:
            final_raw = b""

        if resp.status_code != 200:
            try:
                final_data = resp.json()
            except Exception:
                try:
                    final_data = json.loads(final_raw.decode("utf-8", errors="ignore") or "{}")
                except Exception:
                    final_data = {"error": final_raw.decode("utf-8", errors="ignore")}

            await resp.aclose()
            return final_data, final_headers, final_status, final_raw

        try:
            final_data = resp.json()
        except Exception:
            try:
                raw_text = (await resp.aread()).decode("utf-8", errors="ignore")
                final_data = json.loads(raw_text)
            except Exception:
                # Fallback to empty message based on dialect
                final_data = {"choices": [{"message": {"content": ""}}]} if is_v1 else {"message": {"content": ""}}

        # --- Dialect-aware message extraction ---
        msg = final_data.get("message", {}) or {}
        choices = final_data.get("choices", []) or []
        
        # If /v1 format, extract message from choices
        if not msg and choices and isinstance(choices[0], dict):
            msg = choices[0].get("message", {}) or {}
            
        content = msg.get("content", "") or ""
        # ----------------------------------------

        tool_calls_json, _ = _normalize_tool_calls(msg, content)

        if not tool_calls_json:
            await resp.aclose()
            return final_data, final_headers, final_status, final_raw

        messages = working_body.get("messages", [])

        # Keep the model's tool-request text in history
        messages.append({
            "role": "assistant",
            "content": content,
            "tool_calls": tool_calls_json,
        })

        for tc in tool_calls_json:
            f_name = tc["function"]["name"]
            args = tc["function"]["arguments"]

            try:
                result = registry.execute(f_name, args)
            except Exception as e:
                result = f"Error: {str(e)}"

            messages.append({
                "role": "tool",
                "tool_call_id": tc.get("id"),
                "name": f_name,
                "content": str(result),
            })

        working_body["messages"] = messages
        working_body["tools"] = base_body_json.get("tools", working_body.get("tools"))

        await resp.aclose()

    # Dialect-aware error return
    if is_v1:
        error_resp = {
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": "Tool loop exceeded"},
                "finish_reason": "error"
            }]
        }
    else:
        error_resp = {"message": {"content": "Tool loop exceeded"}}
        
    return error_resp, final_headers, 500, b""

async def _proxy(request: Request, upstream_path: str) -> Response:

    req_id = str(uuid.uuid4())[:8]
    body = await request.body()

    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "transfer-encoding")
    }

    is_stream = True
    body_json = {}

    if body:
        try:
            body_json = json.loads(body)
            is_stream = body_json.get("stream", True)
        except Exception:
            pass

    # --- Logic to check for /mollama prefix ---
    should_use_tools = False
    if isinstance(body_json, dict) and "messages" in body_json:
        messages = body_json["messages"]
        if messages and isinstance(messages, list):
            last_user_msg = next((m for m in reversed(messages) if m.get("role") == "user"), None)
            
            if last_user_msg:
                content = last_user_msg.get("content", "")
                # Only check startswith if the content is actually a string
                if isinstance(content, str) and content.startswith("/mollama"):
                    should_use_tools = True
                    last_user_msg["content"] = content[len("/mollama"):].lstrip()

    # ── Inject master system prompt & Tools ──────────────────────────────────

    if isinstance(body_json, dict) and "messages" in body_json:
        sys_prompt = core.get_system_prompt()
        if sys_prompt:
            messages = body_json["messages"]
            if messages and messages[0].get("role") == "system":
                messages[0]["content"] = sys_prompt + "\n\n" + messages[0]["content"]
            else:
                messages.insert(0, {"role": "system", "content": sys_prompt})
            body_json["messages"] = messages
            body_json["system"] = sys_prompt

        if should_use_tools and registry.schemas:
            body_json["tools"] = registry.schemas
        else:
            body_json.pop("tools", None)

        body = json.dumps(body_json).encode("utf-8")

    # ─────────────────────────────────────────────────────────────────────────

    _ev.log({"kind": "in", "req_id": req_id, "method": request.method, "path": upstream_path})

    client = httpx.AsyncClient(timeout=600)
    max_retries = 5
    last_error_content = b'{"error": "All Ollama instances failed or timed out"}'
    last_status = 503

    # --- SMART MODEL ROUTING (STRICT LITERALS) ---
    target_override = None
    requested_model = body_json.get("model") if isinstance(body_json, dict) else None

    if requested_model == "mollama":
        messages = body_json.get("messages", [])
        t_name, t_url, actual_model = await core.select_best_model_for_prompt(messages)

        if not actual_model:
            fallback = await core.get_any_available_model()
            if fallback:
                t_name, t_url, actual_model = fallback

        if actual_model:
            body_json["model"] = actual_model
            requested_model = actual_model
            body = json.dumps(body_json).encode("utf-8")
            target_override = (t_name, t_url)
        else:
            return Response(
                content=json.dumps({"error": "No models available for smart routing"}),
                status_code=503,
                media_type="application/json"
            )

    try:
        for attempt in range(max_retries):
            if target_override:
                target = target_override
                target_override = None
            else:
                target = await core.next_instance(required_model=requested_model)

            if not target:
                _ev.log({"kind": "error", "req_id": req_id, "msg": f"no instances for literal model: {requested_model}"})
                return Response(
                    content=json.dumps({"error": f"No healthy instances available for literal model: {requested_model}"}),
                    status_code=503,
                    media_type="application/json"
                )

            target_name, target_url = target
            _ev.set_processing(target_name, True)
            _ev.log({"kind": "routed", "req_id": req_id, "instance": target_name, "path": upstream_path})

            url = f"{target_url.rstrip('/')}/{upstream_path.lstrip('/')}"
            t0 = time.time()

            try:
                if is_stream:
                    # ONLY use internal blocking loop if tools are required
                    if should_use_tools:
                        final_data, final_headers, final_status, final_raw = await _run_internal_tool_loop(
                            client=client,
                            url=url,
                            headers=headers,
                            base_body_json=body_json,
                            method=request.method,
                            max_loops=3,
                        )

                        if final_status in (401, 402, 403, 429) or final_status >= 500:
                            core._banned_until[target_name] = time.time() + core.BAN_DURATION
                            core._health[target_name] = False
                            _ev.set_processing(target_name, False)
                            last_status = final_status
                            last_error_content = final_raw or json.dumps(final_data).encode("utf-8")
                            await asyncio.sleep(0.5)
                            continue

                        if final_status != 200:
                            _ev.set_processing(target_name, False)
                            return Response(content=final_raw or json.dumps(final_data).encode("utf-8"), status_code=final_status, media_type="application/json")

                        content_to_stream = _extract_content_from_data(final_data)
                        if not content_to_stream and isinstance(final_data, dict):
                            content_to_stream = json.dumps(final_data, ensure_ascii=False)

                        async def stream_gen_tool():
                            full_content = ""
                            last_push = time.time()
                            is_v1 = upstream_path.startswith("/v1")
                            
                            _ev.update_stream(req_id, "", done=False, instance=target_name, path=upstream_path, ts=t0)
                            try:
                                chunk_size = 8 # Smaller chunks for better feeling
                                for i in range(0, len(content_to_stream), chunk_size):
                                    chunk = content_to_stream[i:i + chunk_size]
                                    
                                    # Output the correct format based on the requested endpoint
                                    # Around line 250 in your provided code
                                    if is_v1:
                                        payload = "data: " + json.dumps({
                                            "id": f"chatcmpl-{req_id}",
                                            "object": "chat.completion.chunk",
                                            "model": requested_model,
                                            "choices": [{"index": 0, "delta": {"content": chunk}}],
                                            "usage": {"input_tokens": 0, "output_tokens": 0} # Required for v1
                                        })
                                    else:
                                        payload = json.dumps({
                                            "model": requested_model, 
                                            "message": {"content": chunk},
                                            "done": False,
                                            "usage": {"input_tokens": 0, "output_tokens": 0} # Add this for standard Ollama path
                                        })
                                        
                                    yield (payload + "\n").encode("utf-8")
                                    full_content += chunk
                                    
                                    if time.time() - last_push >= 0.5:
                                        _ev.update_stream(req_id, full_content, done=False)
                                        last_push = time.time()
                                    await asyncio.sleep(0.02) # Slower for typewriter effect
                                    
                                # OpenAI standard requires a [DONE] termination flag
                                if is_v1:
                                    yield b"data: [DONE]\n"
                                    
                            finally:
                                _ev.update_stream(req_id, full_content, done=True)
                                _ev.set_processing(target_name, False)
                                await client.aclose()

                    else:
                        # STANDARD TRANSPARENT STREAM (Fast, no "pop-in")
                        req = client.build_request(method=request.method, url=url, headers=headers, content=body)
                        resp = await client.send(req, stream=True)

                        if resp.status_code in (401, 402, 403, 429) or resp.status_code >= 500:
                            core._banned_until[target_name] = time.time() + core.BAN_DURATION
                            core._health[target_name] = False
                            _ev.set_processing(target_name, False)
                            await resp.aclose()
                            last_status = resp.status_code
                            continue

                        async def stream_gen_direct():
                            full_content = ""
                            last_push = time.time()
                            _ev.update_stream(req_id, "", done=False, instance=target_name, path=upstream_path, ts=t0)
                            try:
                                async for line in resp.aiter_lines():
                                    if not line: continue
                                    async for line in resp.aiter_lines():
                                        if not line: continue
                                        
                                        # Handle SSE prefix
                                        original_line = line
                                        is_sse = line.startswith("data: ")
                                        json_text = line[6:] if is_sse else line
                                        
                                        # Skip the [DONE] marker
                                        if json_text.strip() == "[DONE]":
                                            yield (line + "\n").encode("utf-8")
                                            continue

                                        try:
                                            data = json.loads(json_text)
                                            data["model"] = requested_model

                                            # Ensure 'usage' object exists and is normalized
                                            u = data.get("usage")
                                            if not isinstance(u, dict):
                                                u = {}
                                            
                                            # Map Ollama's root-level fields if present
                                            if "prompt_eval_count" in data:
                                                u.setdefault("input_tokens", data["prompt_eval_count"])
                                            if "eval_count" in data:
                                                u.setdefault("output_tokens", data["eval_count"])

                                            # Map standard OpenAI names to Anthropic-style names used by Claude Code
                                            if "prompt_tokens" in u:
                                                u["input_tokens"] = u.get("prompt_tokens")
                                            if "completion_tokens" in u:
                                                u["output_tokens"] = u.get("completion_tokens")
                                            
                                            # Ensure fallback defaults so the client doesn't crash
                                            u.setdefault("input_tokens", 0)
                                            u.setdefault("output_tokens", 0)
                                            
                                            # Re-inject normalized usage
                                            data["usage"] = u
                                            
                                            # Re-serialize for the client
                                            new_json = json.dumps(data)
                                            line = f"data: {new_json}" if is_sse else new_json
                                            
                                            full_content += _extract_content_from_data(data)
                                        except Exception:
                                            # If parsing fails, revert to the original line
                                            line = original_line
                                        
                                        yield (line + "\n").encode("utf-8")
                                    if time.time() - last_push >= 0.5:
                                        _ev.update_stream(req_id, full_content, done=False)
                                        last_push = time.time()
                            finally:
                                _ev.update_stream(req_id, full_content, done=True)
                                _ev.set_processing(target_name, False)
                                await resp.aclose()
                                await client.aclose()

                        return StreamingResponse(stream_gen_direct(), status_code=200, media_type="application/x-ndjson")

                else:
                    # Non-stream mode
                    final_data, final_headers, final_status, final_raw = await _run_internal_tool_loop(
                        client=client, url=url, headers=headers, base_body_json=body_json, method=request.method, max_loops=3,
                    )
                    
                    if final_status in (401, 402, 403, 429) or final_status >= 500:
                        core._banned_until[target_name] = time.time() + core.BAN_DURATION
                        core._health[target_name] = False
                        _ev.set_processing(target_name, False)
                        last_status = final_status
                        last_error_content = final_raw or json.dumps(final_data).encode("utf-8")
                        continue

                    _ev.set_processing(target_name, False)
                    final_data["model"] = requested_model

                    # Comprehensive usage normalization
                    u = final_data.get("usage", {})
                    if not isinstance(u, dict): u = {}

                    # Map all variants
                    input_cnt = u.get("prompt_tokens") or final_data.get("prompt_eval_count") or 0
                    output_cnt = u.get("completion_tokens") or final_data.get("eval_count") or 0

                    final_data["usage"] = {
                        "input_tokens": input_cnt,
                        "output_tokens": output_cnt,
                        "prompt_tokens": input_cnt,
                        "completion_tokens": output_cnt
                    }

                    return Response(content=json.dumps(final_data), status_code=200, media_type="application/json", headers=final_headers)

            except Exception as e:
                core._health[target_name] = False
                _ev.set_processing(target_name, False)
                _ev.log({"kind": "error", "req_id": req_id, "instance": target_name, "msg": str(e)})
                await asyncio.sleep(0.5)
                continue

        return Response(content=last_error_content, status_code=last_status, media_type="application/json")

    finally:
        if not is_stream:
            await client.aclose()