import os
import importlib.util
import inspect
from pathlib import Path
from typing import Any, Callable, Dict, List

# Helper to turn Python functions into JSON Schema for LLMs
def get_function_schema(func: Callable) -> dict:
    sig = inspect.signature(func)
    doc = inspect.getdoc(func) or "No description provided."
    
    parameters = {
        "type": "object",
        "properties": {},
        "required": []
    }
    
    for name, param in sig.parameters.items():
        # Map Python types to JSON types
        p_type = "string"
        if param.annotation == int: p_type = "integer"
        elif param.annotation == float: p_type = "number"
        elif param.annotation == bool: p_type = "boolean"
        
        parameters["properties"][name] = {
            "type": p_type,
            "description": f"Parameter {name}" # You could parse this from docstring for better results
        }
        if param.default is inspect.Parameter.empty:
            parameters["required"].append(name)
            
    return {
        "type": "function",
        "function": {
            "name": func.__name__,
            "description": doc,
            "parameters": parameters,
        }
    }

class ToolRegistry:
    def __init__(self):
        self.tools: Dict[str, Callable] = {} # For execution: {"func_name": pointer}
        self.schemas: List[dict] = []        # For the LLM: [json_schemas]
        self.load_tools()

    def _load_module_from_path(self, name: str, path: Path):
        spec = importlib.util.spec_from_file_location(name, path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def load_tools(self):
        tools_dir = Path(__file__).parent
        for item in tools_dir.iterdir():
            if item.name.startswith("__") or item.name == "utils.py":
                continue

            description = ""
            module = None

            # TYPE 1: Simple .py file
            if item.is_file() and item.suffix == ".py":
                module = self._load_module_from_path(item.stem, item)
                description = module.__doc__ or "Simple tool"

            # TYPE 2: Advanced folder
            elif item.is_dir():
                context_file = item / "CONTEXT.MD"
                entry_file = item / "entry.py"
                
                if entry_file.exists():
                    if context_file.exists():
                        description = context_file.read_text()
                    module = self._load_module_from_path(f"{item.name}_entry", entry_file)

            if module:
                # Find all functions that don't start with '_'
                for name, func in inspect.getmembers(module, inspect.isfunction):
                    if not name.startswith("_"):
                        # We use the module doc/context for the tool, 
                        # but the function doc for the specific action
                        schema = get_function_schema(func)
                        self.schemas.append(schema)
                        self.tools[name] = func

    def execute(self, name: str, args: dict) -> Any:
        if name in self.tools:
            return self.tools[name](**args)
        return f"Error: Tool {name} not found."

# Instantiate as a singleton
registry = ToolRegistry()