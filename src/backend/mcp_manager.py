"""
MCP (Model Context Protocol) server manager.
Supports stdio and SSE transports.
"""
import asyncio
import json
import os
from pathlib import Path
from typing import Any, Optional

import httpx

MCP_CONFIG_FILE = Path("/data/mcp_servers.json")


# ── Stdio Client ───────────────────────────────────────────────────────────────

class McpStdioClient:
    def __init__(self, name: str, command: str, args: list[str], env: dict[str, str]):
        self.name = name
        self.command = command
        self.args = args
        self.env = env
        self._proc: Optional[asyncio.subprocess.Process] = None
        self._req_id = 0
        self._pending: dict[int, asyncio.Future] = {}
        self._tools: list[dict] = []
        self._connected = False
        self._reader_task: Optional[asyncio.Task] = None

    async def _send(self, method: str, params: dict) -> dict:
        self._req_id += 1
        rid = self._req_id
        msg = {"jsonrpc": "2.0", "id": rid, "method": method, "params": params}
        loop = asyncio.get_event_loop()
        fut: asyncio.Future = loop.create_future()
        self._pending[rid] = fut
        line = json.dumps(msg) + "\n"
        self._proc.stdin.write(line.encode())
        await self._proc.stdin.drain()
        return await asyncio.wait_for(fut, timeout=30.0)

    async def _notify(self, method: str) -> None:
        msg = {"jsonrpc": "2.0", "method": method}
        self._proc.stdin.write((json.dumps(msg) + "\n").encode())
        await self._proc.stdin.drain()

    async def _reader_loop(self) -> None:
        while self._proc and not self._proc.stdout.at_eof():
            try:
                raw = await asyncio.wait_for(self._proc.stdout.readline(), timeout=60.0)
                if not raw:
                    continue
                msg = json.loads(raw.decode())
                rid = msg.get("id")
                if rid is not None and rid in self._pending:
                    self._pending.pop(rid).set_result(msg)
            except asyncio.TimeoutError:
                continue
            except Exception:
                break

    async def connect(self) -> bool:
        try:
            merged_env = {**os.environ, **self.env}
            self._proc = await asyncio.create_subprocess_exec(
                self.command, *self.args,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=merged_env,
            )
            self._reader_task = asyncio.create_task(self._reader_loop())

            resp = await self._send("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "clientInfo": {"name": "mollama", "version": "1.0"},
            })
            if resp.get("error"):
                return False

            await self._notify("notifications/initialized")
            await self._refresh_tools()
            self._connected = True
            return True
        except Exception as e:
            print(f"[MCP stdio] connect error ({self.name}): {e}")
            return False

    async def _refresh_tools(self) -> None:
        try:
            resp = await self._send("tools/list", {})
            self._tools = resp.get("result", {}).get("tools", [])
        except Exception:
            self._tools = []

    async def call_tool(self, name: str, arguments: dict) -> Any:
        resp = await self._send("tools/call", {"name": name, "arguments": arguments})
        if resp.get("error"):
            return f"MCP error: {resp['error'].get('message', 'unknown')}"
        result = resp.get("result", {})
        content = result.get("content", [])
        if isinstance(content, list):
            return "\n".join(
                c.get("text", str(c)) if isinstance(c, dict) else str(c)
                for c in content
            )
        return str(result)

    async def disconnect(self) -> None:
        self._connected = False
        if self._reader_task:
            self._reader_task.cancel()
        if self._proc:
            try:
                self._proc.terminate()
                await self._proc.wait()
            except Exception:
                pass
        self._proc = None

    def get_tools(self) -> list[dict]:
        return list(self._tools)


# ── SSE Client ─────────────────────────────────────────────────────────────────

class McpSseClient:
    def __init__(self, name: str, url: str, headers: dict[str, str]):
        self.name = name
        self.url = url.rstrip("/")
        self.headers = headers
        self._tools: list[dict] = []
        self._connected = False
        self._session_id: Optional[str] = None
        self._rid = 0

    def _next_id(self) -> int:
        self._rid += 1
        return self._rid

    async def _rpc(self, method: str, params: dict) -> dict:
        async with httpx.AsyncClient(timeout=30, headers=self.headers) as client:
            r = await client.post(
                f"{self.url}/messages",
                json={"jsonrpc": "2.0", "id": self._next_id(), "method": method, "params": params},
            )
            r.raise_for_status()
            return r.json()

    async def connect(self) -> bool:
        try:
            resp = await self._rpc("initialize", {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {}},
                "clientInfo": {"name": "mollama", "version": "1.0"},
            })
            if resp.get("error"):
                return False
            await self._refresh_tools()
            self._connected = True
            return True
        except Exception as e:
            print(f"[MCP SSE] connect error ({self.name}): {e}")
            return False

    async def _refresh_tools(self) -> None:
        try:
            resp = await self._rpc("tools/list", {})
            self._tools = resp.get("result", {}).get("tools", [])
        except Exception:
            self._tools = []

    async def call_tool(self, name: str, arguments: dict) -> Any:
        try:
            resp = await self._rpc("tools/call", {"name": name, "arguments": arguments})
            if resp.get("error"):
                return f"MCP error: {resp['error'].get('message', 'unknown')}"
            result = resp.get("result", {})
            content = result.get("content", [])
            if isinstance(content, list):
                return "\n".join(
                    c.get("text", str(c)) if isinstance(c, dict) else str(c)
                    for c in content
                )
            return str(result)
        except Exception as e:
            return f"MCP call error: {e}"

    async def disconnect(self) -> None:
        self._connected = False

    def get_tools(self) -> list[dict]:
        return list(self._tools)


# ── Manager ────────────────────────────────────────────────────────────────────

_ClientType = McpStdioClient | McpSseClient


class McpManager:
    def __init__(self):
        self._clients: dict[str, _ClientType] = {}

    # ── Config persistence ─────────────────────────────────────────────────────

    def _load_config(self) -> dict:
        if MCP_CONFIG_FILE.exists():
            try:
                return json.loads(MCP_CONFIG_FILE.read_text())
            except Exception:
                pass
        return {}

    def _save_config(self, config: dict) -> None:
        MCP_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        MCP_CONFIG_FILE.write_text(json.dumps(config, indent=2))

    # ── Public API ─────────────────────────────────────────────────────────────

    def list_servers(self) -> list[dict]:
        config = self._load_config()
        result = []
        for name, cfg in config.items():
            client = self._clients.get(name)
            connected = bool(client and client._connected)
            result.append({
                "name": name,
                "transport": cfg.get("transport", "stdio"),
                "command": cfg.get("command"),
                "args": cfg.get("args", []),
                "url": cfg.get("url"),
                "env": cfg.get("env", {}),
                "headers": cfg.get("headers", {}),
                "autoconnect": cfg.get("autoconnect", True),
                "connected": connected,
                "tool_count": len(client.get_tools()) if connected else 0,
                "tools": client.get_tools() if connected else [],
            })
        return result

    def add_server(self, name: str, cfg: dict) -> None:
        config = self._load_config()
        config[name] = cfg
        self._save_config(config)

    def remove_server(self, name: str) -> None:
        config = self._load_config()
        config.pop(name, None)
        self._save_config(config)
        if name in self._clients:
            asyncio.create_task(self._clients.pop(name).disconnect())

    def update_server(self, name: str, updates: dict) -> bool:
        config = self._load_config()
        if name not in config:
            return False
        config[name].update(updates)
        self._save_config(config)
        return True

    async def connect_server(self, name: str) -> bool:
        config = self._load_config()
        cfg = config.get(name)
        if not cfg:
            return False

        if name in self._clients:
            await self._clients[name].disconnect()

        transport = cfg.get("transport", "stdio")
        if transport == "sse":
            client: _ClientType = McpSseClient(
                name=name,
                url=cfg["url"],
                headers=cfg.get("headers", {}),
            )
        else:
            client = McpStdioClient(
                name=name,
                command=cfg["command"],
                args=cfg.get("args", []),
                env=cfg.get("env", {}),
            )

        ok = await client.connect()
        if ok:
            self._clients[name] = client
        return ok

    async def disconnect_server(self, name: str) -> None:
        if name in self._clients:
            await self._clients.pop(name).disconnect()

    # ── Tool integration ───────────────────────────────────────────────────────

    def get_all_tool_schemas(self) -> list[dict]:
        schemas = []
        for srv_name, client in self._clients.items():
            if not client._connected:
                continue
            for tool in client.get_tools():
                schemas.append({
                    "type": "function",
                    "function": {
                        "name": f"mcp__{srv_name}__{tool['name']}",
                        "description": f"[MCP:{srv_name}] {tool.get('description', '')}",
                        "parameters": tool.get("inputSchema", {
                            "type": "object", "properties": {}
                        }),
                    }
                })
        return schemas

    async def execute_tool(self, mcp_tool_name: str, args: dict) -> Any:
        # Format: mcp__<server>__<tool>
        parts = mcp_tool_name.split("__", 2)
        if len(parts) != 3 or parts[0] != "mcp":
            return f"Invalid MCP tool name: {mcp_tool_name}"
        _, server_name, tool_name = parts
        client = self._clients.get(server_name)
        if not client or not client._connected:
            return f"MCP server '{server_name}' not connected"
        return await client.call_tool(tool_name, args)

    async def autoconnect(self) -> None:
        config = self._load_config()
        tasks = []
        for name, cfg in config.items():
            if cfg.get("autoconnect", True):
                tasks.append(asyncio.create_task(self.connect_server(name)))
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)


mcp_manager = McpManager()
