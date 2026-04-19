import os, shutil
from pathlib import Path
from typing import List

def ls(path: str = ".") -> List[str]:
    """List dir contents."""
    try:
        return os.listdir(path)
    except Exception as e:
        return [str(e)]

def read(path: str) -> str:
    """Read file text."""
    try:
        return Path(path).read_text(encoding='utf-8')
    except Exception as e:
        return str(e)

def write(path: str, content: str):
    """Write text to file (creates dirs)."""
    try:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding='utf-8')
        return "ok"
    except Exception as e:
        return str(e)

def mkdir(path: str):
    """Create directory."""
    try:
        Path(path).mkdir(parents=True, exist_ok=True)
        return "ok"
    except Exception as e:
        return str(e)

def find(query: str, ext: str = "*") -> List[str]:
    """Recursive search."""
    res = [str(p) for p in Path(".").rglob(f"*{query}*{ext}")]
    return res if res else ["none"]

def rm(path: str):
    """Delete file or dir."""
    try:
        p = Path(path)
        if p.is_dir(): shutil.rmtree(p)
        else: p.unlink()
        return "ok"
    except Exception as e:
        return str(e)