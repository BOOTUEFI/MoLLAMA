from starlette.types import ASGIApp, Receive, Scope, Send
from fastapi import Request
from proxy import _proxy

class OllamaProxyMiddleware:
    def __init__(self, inner: ASGIApp) -> None:
        self._inner = inner

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            path: str = scope.get("path", "")
            
            # Catches /api (Ollama) and /v1 (OpenAI/Anthropic)
            if path.startswith("/api") or path.startswith("/v1"):
                if "headers" in scope:
                    filtered_headers = []
                    for name, value in scope["headers"]:
                        # Scrub headers that cause CORS/Security issues with upstream
                        if name not in (b"host", b"origin", b"referer"):
                            filtered_headers.append((name, value))
                    scope["headers"] = filtered_headers
                
                request = Request(scope, receive)
                response = await _proxy(request, path)
                await response(scope, receive, send)
                return
                
        await self._inner(scope, receive, send)