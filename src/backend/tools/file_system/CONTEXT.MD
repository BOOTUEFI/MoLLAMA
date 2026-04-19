# FS ACCESS RULES
- Use relative paths from project root.
- No system-level access (/etc, /root, etc).

# TOOL DESCRIPTIONS
- ls(path): Lists directory contents. Use to verify file existence or explore structure before acting.
- read(path): Returns raw file text. Use to ingest source code, configs, or logs for analysis.
- write(path, content): Saves text to file. Auto-creates missing parent directories. Overwrites existing content.
- mkdir(path): Creates directory and all necessary parents (mkdir -p).
- find(query, ext): Recursive glob search from root. Use when file location is unknown.
- rm(path): Deletes file or recursive directory tree (shutil.rmtree).

# STRATEGY
1. ls/find first to confirm paths.
2. read to understand context.
3. write to apply changes.