import asyncio
import json
from typing import Any
from fastapi import WebSocket


class WsManager:
    def __init__(self):
        self._clients: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        async with self._lock:
            self._clients.append(ws)

    async def disconnect(self, ws: WebSocket) -> None:
        async with self._lock:
            try:
                self._clients.remove(ws)
            except ValueError:
                pass

    async def broadcast(self, data: dict[str, Any]) -> None:
        if not self._clients:
            return
        text = json.dumps(data, default=str)
        dead: list[WebSocket] = []
        for ws in list(self._clients):
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for ws in dead:
            await self.disconnect(ws)

    @property
    def count(self) -> int:
        return len(self._clients)


ws_manager = WsManager()
