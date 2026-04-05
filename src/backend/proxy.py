import json
import time
import uuid
import asyncio
import httpx
from fastapi import Request, Response
from fastapi.responses import StreamingResponse

import core
import events as _ev

async def _proxy(request: Request, upstream_path: str) -> Response:
    req_id = str(uuid.uuid4())[:8]
    body = await request.body()
    # Keep headers clean but don't touch the content logic
    headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ('host', 'content-length', 'transfer-encoding')
    }

    is_stream = True
    body_json = {}
    
    if body:
        try:
            body_json = json.loads(body)
            is_stream = body_json.get('stream', True)
        except Exception:
            pass

    _ev.log({'kind': 'in', 'req_id': req_id, 'method': request.method, 'path': upstream_path})

    client = httpx.AsyncClient(timeout=600)
    max_retries = 5
    last_error_content = b'{"error": "All Ollama instances failed or timed out"}'
    last_status = 503

    # --- SMART MODEL ROUTING (STRICT LITERALS) ---
    target_override = None
    requested_model = body_json.get("model") if isinstance(body_json, dict) else None

    # Only intercept if the exact string "mollama" is used
    if requested_model == "mollama":
        messages = body_json.get("messages", [])
        # select_best_model_for_prompt now returns 100% literal names from core.py
        t_name, t_url, actual_model = await core.select_best_model_for_prompt(messages)
        
        # Fallback if no specific model is picked
        if not actual_model:
            fallback = await core.get_any_available_model()
            if fallback:
                t_name, t_url, actual_model = fallback
        
        if actual_model:
            # Use the EXACT literal name returned by the router
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
            # 1. Try the routed instance first
            # 2. Failover using the EXACT 'requested_model' string (no corrections)
            if target_override:
                target = target_override
                target_override = None 
            else:
                target = await core.next_instance(required_model=requested_model)
            
            if not target:
                _ev.log({'kind': 'error', 'req_id': req_id, 'msg': f'no instances for literal model: {requested_model}'})
                return Response(
                    content=json.dumps({'error': f'No healthy instances available for literal model: {requested_model}'}),
                    status_code=503,
                    media_type='application/json'
                )

            target_name, target_url = target
            _ev.set_processing(target_name, True)
            _ev.log({'kind': 'routed', 'req_id': req_id, 'instance': target_name, 'path': upstream_path})

            url = f"{target_url.rstrip('/')}/{upstream_path.lstrip('/')}"
            
            # Pass the body as-is (with the literal model name)
            req = client.build_request(method=request.method, url=url, headers=headers, content=body)
            t0 = time.time()

            try:
                if is_stream:
                    resp = await client.send(req, stream=True)
                else:
                    resp = await client.send(req)

                # Error handling / Banning logic
                if resp.status_code in (401, 402, 403, 429) or resp.status_code >= 500:
                    core._banned_until[target_name] = time.time() + core.BAN_DURATION
                    core._health[target_name] = False
                    _ev.set_processing(target_name, False)
                    _ev.log({'kind': 'ban_or_fail', 'req_id': req_id, 'instance': target_name, 'status': resp.status_code})

                    last_status = resp.status_code
                    if is_stream: await resp.aclose()
                    else: last_error_content = resp.content

                    await asyncio.sleep(0.5) 
                    continue 
                
                if resp.status_code != 200:
                    if is_stream:
                        error_content = await resp.aread()
                        await resp.aclose()
                    else:
                        error_content = resp.content

                    _ev.set_processing(target_name, False)
                    _ev.log({'kind': 'resp', 'req_id': req_id, 'instance': target_name, 'status': resp.status_code, 'elapsed': time.time() - t0})
                    return Response(content=error_content, status_code=resp.status_code, media_type='application/json')

                # Handle successful stream
                if is_stream:
                    async def stream_gen(tn=target_name, r=resp, cl=client, _t0=t0, rid=req_id, _path=upstream_path):
                        full_content = ""
                        log_buffer = ""
                        last_push = time.time()
                        _ev.update_stream(rid, "", done=False, instance=tn, path=_path, ts=_t0)

                        try:
                            async for chunk in r.aiter_raw():
                                yield chunk
                                try:
                                    log_buffer += chunk.decode("utf-8")
                                    while "\n" in log_buffer:
                                        line, log_buffer = log_buffer.split("\n", 1)
                                        line = line.strip()
                                        if not line: continue
                                        try:
                                            parsed = json.loads(line)
                                            content = (parsed.get("message", {}).get("content") or parsed.get("response") or "")
                                            if content: full_content += content
                                        except json.JSONDecodeError: pass

                                    now = time.time()
                                    if now - last_push >= 0.5:
                                        _ev.update_stream(rid, full_content, done=False)
                                        last_push = now
                                except Exception: pass
                        finally:
                            _ev.update_stream(rid, full_content, done=True)
                            _ev.set_processing(tn, False)
                            _ev.log({"kind": "resp", "req_id": rid, "instance": tn, "status": r.status_code, "elapsed": time.time() - _t0})
                            await r.aclose()
                            await cl.aclose()

                    return StreamingResponse(
                        stream_gen(), 
                        status_code=resp.status_code,
                        media_type='application/x-ndjson',
                        headers={
                            "Cache-Control": "no-cache, no-transform",
                            "Connection": "keep-alive",
                            "X-Accel-Buffering": "no",
                        }
                    )

                else:
                    _ev.set_processing(target_name, False)
                    _ev.log({'kind': 'resp', 'req_id': req_id, 'instance': target_name, 'status': resp.status_code, 'elapsed': time.time() - t0})
                    return Response(content=resp.content, status_code=resp.status_code, headers=dict(resp.headers))

            except Exception as e:
                core._health[target_name] = False
                _ev.set_processing(target_name, False)
                _ev.log({'kind': 'error', 'req_id': req_id, 'instance': target_name, 'msg': str(e)})
                await asyncio.sleep(0.5)
                continue

        return Response(content=last_error_content, status_code=last_status, media_type='application/json')
    finally:
        if not is_stream:
            await client.aclose()