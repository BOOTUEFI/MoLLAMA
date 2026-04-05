import pyperclip
from pathlib import Path
import time

src = Path('src\\frontend\\src')
combined_text = []

# A set is faster for lookups. Add any other folders you want to ignore here.
IGNORE_DIRS = {'.git', '__pycache__', 'node_modules', '.venv', 'venv', 'dist', 'build', 'ui'}

for path in src.rglob('*'):
    # Check if ANY part of the current path matches our ignore list
    if set(path.parts) & IGNORE_DIRS:
        continue
    
    if path.is_file():
        try:
            content = path.read_text(encoding='utf-8')
            combined_text.append(f"--- File: {path} ---\n{content}\n")
        except UnicodeDecodeError:
            continue 

final_output = '\n'.join(combined_text)

pyperclip.copy(final_output)
print(f"Copied {len(combined_text)} files to clipboard!")
time.sleep(3)

