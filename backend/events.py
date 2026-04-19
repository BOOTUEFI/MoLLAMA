import collections
import time

feed_log = collections.deque(maxlen=500)
_processing: dict = {}
total_requests = 0

# ── Stream content store ──────────────────────────────────────────────────────
# req_id → {"req_id", "content", "instance", "path", "ts", "done"}
stream_log: dict = {}
_MAX_STREAM_LOG = 100


def log(event: dict):
    global total_requests
    if event.get("kind") == "in":
        total_requests += 1
    event.setdefault("ts", time.time())  # ← fix Invalid Date
    feed_log.appendleft(event)


def set_processing(name: str, value: bool):
    _processing[name] = value


def update_stream(req_id: str, content: str, done: bool,
                  instance: str = "", path: str = "", ts: float = 0.0):
    if req_id not in stream_log:
        # Evict oldest entry if at capacity
        if len(stream_log) >= _MAX_STREAM_LOG:
            oldest = min(stream_log, key=lambda k: stream_log[k]["ts"])
            del stream_log[oldest]
        stream_log[req_id] = {
            "req_id": req_id,
            "content": "",
            "instance": instance,
            "path": path,
            "ts": ts or time.time(),
            "done": False,
        }

    stream_log[req_id]["content"] = content
    if done:
        stream_log[req_id]["done"] = True