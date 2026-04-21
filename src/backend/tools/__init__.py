import asyncio
import importlib.util
import inspect
import json
from pathlib import Path
from typing import Any, Callable, Dict, List


def get_function_schema(func: Callable) -> dict:
    sig = inspect.signature(func)
    doc = inspect.getdoc(func) or "No description provided."
    parameters: dict = {"type": "object", "properties": {}, "required": []}

    for name, param in sig.parameters.items():
        ann = param.annotation
        if ann == int:
            p_type = "integer"
        elif ann == float:
            p_type = "number"
        elif ann == bool:
            p_type = "boolean"
        else:
            p_type = "string"

        parameters["properties"][name] = {"type": p_type, "description": f"Parameter {name}"}
        if param.default is inspect.Parameter.empty:
            parameters["required"].append(name)

    return {
        "type": "function",
        "function": {"name": func.__name__, "description": doc, "parameters": parameters},
    }


class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, Callable] = {}
        self.schemas: List[dict] = []
        self._extra_schemas: List[dict] = []  # MCP / external tool schemas
        self._builtin_schemas: List[dict] = []  # soul, subagent built-ins
        self.load_tools()

    # ── Module loading ─────────────────────────────────────────────────────────

    def _load_module_from_path(self, name: str, path: Path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def _try_load(self, path: Path):
        try:
            return self._load_module_from_path(path.stem, path)
        except Exception:
            return None

    # ── Tool discovery ─────────────────────────────────────────────────────────

    def load_tools(self) -> None:
        tools_dir = Path(__file__).parent
        new_tools: Dict[str, Callable] = {}
        new_schemas: List[dict] = []

        for item in tools_dir.iterdir():
            if item.name.startswith("__") or item.name == "utils.py":
                continue

            module = None

            if item.is_file() and item.suffix == ".py":
                try:
                    module = self._load_module_from_path(item.stem, item)
                except Exception as e:
                    print(f"[tools] failed to load {item.name}: {e}")

            elif item.is_dir():
                entry_file = item / "entry.py"
                if entry_file.exists():
                    try:
                        module = self._load_module_from_path(f"{item.name}_entry", entry_file)
                    except Exception as e:
                        print(f"[tools] failed to load {item.name}/entry.py: {e}")

            if module:
                for fname, func in inspect.getmembers(module, inspect.isfunction):
                    if not fname.startswith("_"):
                        schema = get_function_schema(func)
                        new_schemas.append(schema)
                        new_tools[fname] = func

        self.tools = new_tools
        self.schemas = new_schemas + self._builtin_schemas + self._extra_schemas

    def hot_reload(self) -> int:
        """Reload all tool modules from disk. Returns number of loaded tools."""
        self.load_tools()
        return len(self.tools)

    # ── MCP / external schema injection ───────────────────────────────────────

    def set_extra_schemas(self, schemas: List[dict]) -> None:
        """Replace MCP/external schemas and rebuild the full schema list."""
        self._extra_schemas = list(schemas)
        local = [get_function_schema(f) for f in self.tools.values()]
        self.schemas = local + self._builtin_schemas + self._extra_schemas

    def set_builtin_schemas(self, schemas: List[dict]) -> None:
        """Register built-in tool schemas (soul, subagents) and rebuild schema list."""
        self._builtin_schemas = list(schemas)
        local = [get_function_schema(f) for f in self.tools.values()]
        self.schemas = local + self._builtin_schemas + self._extra_schemas

    # ── Execution ──────────────────────────────────────────────────────────────

    def execute(self, name: str, args: Any) -> Any:
        """Sync execution — parses JSON string args if needed."""
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}

        if name in self.tools:
            result = self.tools[name](**args)
            if asyncio.iscoroutine(result):
                return asyncio.get_event_loop().run_until_complete(result)
            return result
        return f"Error: Tool '{name}' not found."

    async def aexecute(self, name: str, args: Any) -> Any:
        """Async execution — handles sync/async callables and MCP tools."""
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        if not isinstance(args, dict):
            args = {}

        if name.startswith("mcp__"):
            from mcp_manager import mcp_manager
            return await mcp_manager.execute_tool(name, args)

        # Built-in soul tools
        if name in ("add_to_memory", "read_memory"):
            import soul
            return await soul.execute(name, args)

        # Built-in subagent tools
        if name == "spawn_subagent":
            import subagents as _subagents
            return await _subagents.execute(name, args)

        if name in self.tools:
            result = self.tools[name](**args)
            if asyncio.iscoroutine(result):
                return await result
            return result

        return f"Error: Tool '{name}' not found."

    # ── File management ────────────────────────────────────────────────────────

    _EDITABLE_EXTS = {".py", ".md", ".txt", ".json", ".yaml", ".yml", ".toml", ".sh", ".env", ".cfg", ".ini"}

    def list_tool_files(self) -> List[dict]:
        tools_dir = Path(__file__).parent
        result = []
        for item in sorted(tools_dir.iterdir()):
            if item.name.startswith("__"):
                continue
            if item.is_file() and item.suffix.lower() in self._EDITABLE_EXTS:
                funcs: List[str] = []
                if item.suffix.lower() == ".py":
                    mod = self._try_load(item)
                    funcs = [n for n, _ in inspect.getmembers(mod, inspect.isfunction) if not n.startswith("_")] if mod else []
                result.append({
                    "path": item.name,
                    "type": "simple",
                    "functions": funcs,
                    "ext": item.suffix.lstrip("."),
                })
            elif item.is_dir() and (item / "entry.py").exists():
                entry_mod = self._try_load(item / "entry.py")
                funcs = [n for n, _ in inspect.getmembers(entry_mod, inspect.isfunction) if not n.startswith("_")] if entry_mod else []
                result.append({
                    "path": f"{item.name}/entry.py",
                    "type": "folder",
                    "functions": funcs,
                    "ext": "py",
                })
                for sub in sorted(item.iterdir()):
                    if sub.name.startswith("__") or sub.name == "entry.py":
                        continue
                    if sub.is_file() and sub.suffix.lower() in self._EDITABLE_EXTS:
                        result.append({
                            "path": f"{item.name}/{sub.name}",
                            "type": "simple",
                            "functions": [],
                            "ext": sub.suffix.lstrip("."),
                        })
        return result

    def read_tool_file(self, rel_path: str) -> str:
        tools_dir = Path(__file__).parent
        target = (tools_dir / rel_path).resolve()
        if not str(target).startswith(str(tools_dir.resolve())):
            raise PermissionError("Path outside tools directory")
        if not target.exists():
            raise FileNotFoundError(f"{rel_path} not found")
        return target.read_text(encoding="utf-8")

    def write_tool_file(self, rel_path: str, code: str) -> None:
        tools_dir = Path(__file__).parent
        target = (tools_dir / rel_path).resolve()
        if not str(target).startswith(str(tools_dir.resolve())):
            raise PermissionError("Path outside tools directory")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(code, encoding="utf-8")

    def delete_tool_file(self, rel_path: str) -> None:
        tools_dir = Path(__file__).parent
        target = (tools_dir / rel_path).resolve()
        if not str(target).startswith(str(tools_dir.resolve())):
            raise PermissionError("Path outside tools directory")
        if target.exists():
            target.unlink()
        parent = target.parent
        if parent != tools_dir and parent.is_dir() and not any(parent.iterdir()):
            parent.rmdir()


registry = ToolRegistry()
