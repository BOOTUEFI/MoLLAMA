# MoLLAMA Backend API

This document describes the API endpoints exposed by the MoLLAMA Python backend. Use this to build a React (or other) frontend. The backend proxies requests under `/api/` and `/v1/` to managed Ollama instances and exposes management endpoints under `/admin/`.

Base URL: `http://<host>:11111`

Contents
- Proxy behavior
- Management endpoints (`/admin/*`)

---

Proxy behavior
- Any HTTP request path starting with `/api/` or `/v1/` is proxied to a selected Ollama instance. The proxy preserves method, headers (except `host`, `content-length`, `transfer-encoding`) and body. Streaming responses are forwarded as `application/x-ndjson`.
- If there are no healthy instances, the proxy returns HTTP 503 with JSON: `{ "error": "No healthy Ollama instances available (all offline or banned)" }`.
- On repeated failures the proxy returns HTTP 502 with JSON: `{ "error": "Request failed after multiple retries." }`.

---

Management endpoints
All management endpoints are prefixed with `/admin`. They return JSON. Errors use standard HTTP status codes and include a `detail` string.

1) GET `/admin/instances`
- Description: Return the persisted instances configuration (content of `/data/instances.json`).
- Response: `200 OK` with body: `{ "<full_name>": { "base_url": "http://...:11434", "active": true, "managed": true }, ... }`

2) GET `/admin/active`
- Description: Return list of active, healthy, and not-banned instances.
- Response: `200 OK` with body: `[ ["mollama_name","http://mollama_name:11434"], ... ]`

3) POST `/admin/deploy`
- Request JSON: `{ "clean_name": "myname" }`
- Description: Deploy a new managed Ollama container named `mollama_<clean_name>` (creates volume, runs container). Returns result.
- Response: `200 OK` `{ "deployed": true }` or `{ "deployed": false }`

4) POST `/admin/start`
- Request JSON: `{ "full_name": "mollama_myname" }`
- Description: Start an existing container and mark the instance active in persisted config.
- Response: `200 OK` `{ "started": true }`

5) POST `/admin/stop`
- Request JSON: `{ "full_name": "mollama_myname" }`
- Description: Stop a managed container and mark it inactive.
- Response: `200 OK` `{ "stopped": true }`

6) DELETE `/admin/remove`
- Request JSON: `{ "full_name": "mollama_myname" }`
- Description: Stop and remove the container, delete it from persisted config.
- Response: `200 OK` `{ "removed": true }`

7) GET `/admin/key/{full_name}`
- Description: Read the container's public key from `/root/.ollama/id_ed25519.pub` inside the container (used for SSH-like auth).
- Response: `200 OK` `{ "key": "ssh-ed25519 AAAA..." }`

8) POST `/admin/instances/{full_name}/active`
- Request JSON: `{ "active": true }`
- Description: Mark an instance active/inactive in persisted config.
- Response: `200 OK` `{ "ok": true }`

9) GET `/admin/events` (new)
- Query params: `limit` (optional, default 200)
- Description: Returns recent event feed (internal activity, routing, bans, errors). Useful for UI activity log.
- Response: `200 OK` `{ "events": [ { "kind": "in", "method": "POST", "path": "/api/generate", "ts": 167... }, ... ], "total": 42 }`

10) GET `/admin/processing` (new)
- Description: Returns a map of instance -> boolean indicating if the backend currently considers it processing a proxied request.
- Response: `200 OK` `{ "processing": { "mollama_a": false, "mollama_b": true } }

11) GET `/admin/stats` (new)
- Description: Basic aggregated stats.
- Response: `200 OK` `{ "total_requests": 123, "processing": {...}, "health": {...}, "banned_until": {...} }`

12) POST `/admin/ban` (new)
- Request JSON: `{ "full_name": "mollama_name", "seconds": 1800 }` (`seconds` optional, defaults to server's BAN_DURATION)
- Description: Mark an instance banned until now+seconds and mark it unhealthy.
- Response: `200 OK` `{ "banned": "mollama_name", "until": 167... }

13) POST `/admin/unban` (new)
- Request JSON: `{ "full_name": "mollama_name" }`
- Description: Remove an instance ban early.
- Response: `200 OK` `{ "unbanned": "mollama_name" }`

14) POST `/admin/instances/update` (new)
- Request JSON: `{ "full_name": "mollama_name", "base_url": "http://...:11434", "active": true }` (provide one or more fields)
- Description: Update persisted instance info (base_url, active flag).
- Response: `200 OK` `{ "ok": true }`

---

Error responses
- For missing fields: `400 Bad Request` with body: `{ "detail": "missing <field>" }`
- For not found instances: `404 Not Found` with body: `{ "detail": "instance not found" }`

---

Frontend notes
- Proxy endpoints remain at `/api/*` and `/v1/*`. The frontend can call these via the backend host (e.g., `POST /api/generate`).
- The admin endpoints under `/admin` are intended for an authenticated UI; the current implementation has no auth. Add authentication (JWT, basic auth, or reverse-proxy auth) before exposing to untrusted networks.

---

Examples

Deploy example:

POST /admin/deploy
Body:
```
{ "clean_name": "a" }
```

Response:
```
{ "deployed": true }
```

Ban example:

POST /admin/ban
Body:
```
{ "full_name": "mollama_a", "seconds": 600 }
```

Response:
```
{ "banned": "mollama_a", "until": 171... }
```
