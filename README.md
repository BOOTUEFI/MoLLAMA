# MoLLAMA — Multi-Agent AI Operating System

> A full-stack, self-hosted AI operating system built on Ollama. Manage clusters, spawn specialist agents, debate with AIs in War Room, edit code in Projects IDE, and chain tools — all from one glassmorphic control center.

![MoLLAMA Dashboard](docs/demo.gif)
*[Dashboard preview — live node status, model routing, tool calls, and more](#getting-started)*

---

## Table of Contents

- [Features](#features)
  - [Multi-Model Orchestration](#multi-model-orchestration)
  - [Containerized Ollama Clusters](#containerized-ollama-clusters)
  - [Smart Model Routing](#smart-model-routing)
  - [Internal Tool System](#internal-tool-system)
  - [Skills — Reusable AI Capabilities](#skills--reusable-ai-capabilities)
  - [Subagents — Specialist AI Workers](#subagents--specialist-ai-workers)
  - [War Room — Multi-Agent Debates](#war-room--multi-agent-debates)
  - [Projects IDE](#projects-ide)
  - [MCP Server Support](#mcp-server-support)
  - [Persistent Memory (SOUL.MD)](#persistent-memory-soulmd)
  - [Routines — Scheduled Automation](#routines--scheduled-automation)
  - [Agentic Chat with Streaming](#agentic-chat-with-streaming)
  - [Live Feed & WebSocket State](#live-feed--websocket-state)
  - [Context Compression](#context-compression)
  - [Dialect Translation Proxy](#dialect-translation-proxy)
- [Architecture](#architecture)
  - [Backend (`d/MoLLAMA/src/backend/`)](#backend-dmollamasrcbackend)
  - [Frontend (`d/MoLLAMA/src/frontend/`)](#frontend-dmollamasrcfrontend)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Clone & Launch](#clone--launch)
  - [Access the UI](#access-the-ui)
  - [Node Setup (Ollama Instances)](#node-setup-ollama-instances)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Roadmap (from TODO.MD)](#roadmap-from-todomd)

---

## Features

### Multi-Model Orchestration

MoLLAMA runs **multiple Ollama instances simultaneously** as named nodes. Each node can be a local GPU instance or a cloud instance. The system performs continuous health checks, auto-bans misbehaving nodes, and routes requests across the cluster with automatic failover.

### Containerized Ollama Clusters

Every Ollama node runs as a **Docker container** managed by MoLLAMA. Deploy one or many instances with a single click. Nodes can be configured as:

- **Local GPU** — full VRAM access, GPU passthrough, `OLLAMA_KEEP_ALIVE=5m`
- **Cloud** — memory-capped (~150MB), optimized for shared scheduling, `OLLAMA_MAX_VRAM=0`

Managed containers auto-start on boot, share a common model storage volume, and can be rebuilt or updated atomically via the Maintenance Console.

### Smart Model Routing

Select **`mollama`** as your model to activate the built-in orchestrator. It analyzes each prompt and routes to the best available model across your cluster:

| Tier | Models | Use Case |
|------|-------|----------|
| **Tier 1 — General** | Qwen3.5 | Frontend, general coding, all simple tasks |
| **Tier 2 — Logic** | DeepSeek-V3.2 | Complex algorithms, deep debugging, level-5 logic |
| **Tier 3 — Context** | MiniMax-M2.7 | Repo-wide refactors, high-context tasks (>48k chars) |
| **Tier 4 — Prose** | Gemma4:31b | Documentation, non-technical writing, knowledge |

The orchestrator uses keyword analysis and context-length heuristics to route without LLM overhead for simple tasks, falling back to LLM-based selection for ambiguous cases.

### Internal Tool System

MoLLAMA ships with **built-in tools** and supports **user-defined Python tools** editable from the frontend Tools Editor.

**Built-in tools:**
- `add_to_memory` — add a persistent memory entry to SOUL.MD
- `read_memory` — read the full SOUL.MD contents
- `spawn_subagent` — delegate a task to a named subagent (parallel execution)

**Editable tool packages** (`d/MoLLAMA/src/backend/tools/`):
- `file_system/` — file system operations (`entry.py` + `CONTEXT.MD`)
- `finance.py` — financial data tools
- `search.py` — web search tools
- `weather.py` — weather data tools

**Tool Editor (full-page UI):**
- Left panel: file tree of all tool files and folders
- Right panel: Monaco-based code editor with Python syntax highlighting
- Create, edit, delete tool files directly from the browser
- Hot-reload — tools are available immediately after save
- AI-assisted tool generation — type a description, and the backend generates a Python tool file via Ollama (streaming)
- Run any tool directly from the editor with custom arguments

### Skills — Reusable AI Capabilities

Skills are **prompt templates stored as JSON** in `/data/skills/`. Each skill has:
- `name` — identifier
- `description` — short description shown in the left panel
- `system_prompt` — the AI's core personality and instructions
- `instructions` — additional template instructions (can reference `{context}`)
- `model` — optional override model

Skills are invoked via the `/admin/skills/{name}/invoke` endpoint, and the frontend Skills Editor lets you create, test (with live context input), save, and delete skills. Skills map to slash commands in the chat (e.g., `/plan`, `/analyze`, `/research`, `/frontend`, `/backend`).

### Subagents — Specialist AI Workers

Subagents are **autonomous AI agents** stored as JSON in `/data/agents/`. Two default agents are auto-created:

- **`frontend-agent`** — specialist for React, TypeScript, CSS, animations, UI/UX
- **`backend-agent`** — specialist for Python, FastAPI, asyncio, databases, system design

Each agent has:
- `system_prompt` — its role and behavior definition
- `model` — optional model override
- `enabled` — toggle participation in orchestration

The main chat can call `spawn_subagent` to delegate tasks. The Subagent Editor provides a full UI to create, edit, test (live streaming output), and manage agents.

### War Room — Multi-Agent Debates

The **War Room** lets you pose a question and have multiple AI agents debate and iterate on it across multiple rounds. Features:

- Select one or many agents to participate
- Choose 1, 2, or 3 debate rounds
- Each round feeds the previous round's responses as context to the next
- Per-agent markdown rendering with collapsible thought process
- Final output panel showing all agents' conclusions
- One-click copy of any agent's final response

### Projects IDE

The **Projects** panel is a lightweight IDE built into MoLLAMA:

- **Project management** — create, delete, and switch between projects
- **File explorer** — tree view with folders and files, inline create/mkdir/delete/rename
- **Monaco code editor** — syntax highlighting for Python, TypeScript, JavaScript, JSON, YAML, Markdown, and more
- **Project agent chat** — chat with an AI that has context of the selected file and project knowledge
- **Knowledge Vault** — add context entries (e.g., design decisions, architecture notes) that the project agent always knows
- **Project briefing** — ask the AI to summarize "Previously on this project" given the chat history
- **Upload files** directly into any project

### MCP Server Support

MoLLAMA integrates **Model Context Protocol (MCP) servers** via the MCP Manager. Supported transports:

- **Stdio** — spawn local MCP processes (e.g., `npx`, custom binaries)
- **SSE** — connect to remote MCP servers via HTTP+SSE

MCP tool schemas are automatically injected into the tool registry, making MCP tools callable like native tools. The UI shows connected servers, their available tools, and allows connecting/disconnecting.

### Persistent Memory (SOUL.MD)

MoLLAMA's agent memory is stored in **`/data/SOUL.md`** — a structured markdown file. The AI can call:
- `add_to_memory(entry, section)` — append a memory entry under a named section
- `read_memory()` — return full SOUL.MD content for context injection

The Memory Panel in the right sidebar lets you view and edit SOUL.MD directly.

### Routines — Scheduled Automation

Routines are **timed tasks** stored as JSON in `/data/routines/`. Each routine has:
- `prompt` — the task description sent to the AI
- `interval_minutes` — how often to run
- `enabled` — toggle on/off
- `last_run` — timestamp (auto-updated by the scheduler)

The background scheduler checks every 60 seconds and fires any due routines. Routines Panel in the right sidebar lets you create, edit, test-run, and toggle routines.

### Agentic Chat with Streaming

When tools are available, the chat automatically uses **agentic mode** (`/admin/chat/agentic`). This endpoint:
- Streams tokens as they arrive
- Intercepts tool calls and executes them non-blocking
- Shows tool names, arguments, and results inline in the chat
- Collapsible "Thinking" blocks for `<think>` content
- Auto-injects system prompt, context compression, and MCP tools
- File and image attachments supported

Non-agentic streaming mode is also available for plain chat-only use.

### Live Feed & WebSocket State

All live state is broadcast via **WebSocket (`/ws`)** every ~300ms:

- Request counter (`total_requests`)
- Per-node processing status
- Health status for all nodes
- Event feed (inbound/outbound requests)
- Stream log (active request content)
- Available models (aggregated from all nodes)
- Connected MCP servers and tool schemas
- App settings

The **Live Feed** panel (left sidebar) shows a real-time event log with timestamps, request direction, model, and path.

### Context Compression

When enabled in Settings → Inference, MoLLAMA **auto-compacts chat history** by:
- Summarizing all but the last 3 messages via the AI itself
- Replacing old messages with a single `[Earlier conversation summary]` system message
- Triggered automatically when context window exceeds threshold

Manual compact available via `/compact` slash command in the chat.

### Dialect Translation Proxy

The `/admin/*` proxy middleware translates between **Ollama**, **OpenAI**, and **Anthropic** API dialects on the fly:
- OpenAI chat completions → Ollama format
- Anthropic messages API → Ollama format
- Streaming and non-streaming both supported
- Tool calls normalized between JSON and XML formats
- **Claude Code / OpenClaw compatible** — the proxy handles the full dialect bridge

### /mollama Smart Command

Prefix any message with `/mollama` to activate the internal tool loop on that turn. The system prompt is injected, tools are available, and the orchestrator routes intelligently — useful for quick tool-calling without switching to agentic mode.

---

## Architecture

### Backend (`d/MoLLAMA/src/backend/`)

| File | Role |
|------|------|
| `main.py` | FastAPI app, all HTTP/WebSocket endpoints, lifespan management |
| `core.py` | Docker management, health checks, model cache, smart routing, maintenance |
| `orchestrator.py` | Tier-based model selection (Qwen3.5 / DeepSeek / MiniMax / Gemma4) |
| `proxy.py` | Full API proxy: dialect translation, tool injection, smart routing, retries |
| `events.py` | In-memory event feed, stream log, processing state |
| `tools/__init__.py` | `ToolRegistry` — hot-reloads Python tool modules, executes async/sync tools |
| `tools/file_system/` | File system tool package |
| `tools/finance.py` | Finance tools |
| `tools/search.py` | Search tools |
| `tools/weather.py` | Weather tools |
| `mcp_manager.py` | MCP server lifecycle (Stdio + SSE clients), tool schema injection |
| `skills.py` | Skill CRUD and invocation |
| `subagents.py` | Agent CRUD, streaming execution, `spawn_subagent` tool |
| `soul.py` | SOUL.MD memory read/write, `add_to_memory` / `read_memory` tools |
| `routines.py` | Routine scheduler loop, CRUD |
| `ws_manager.py` | WebSocket connection manager and broadcast |
| `middleware.py` | `OllamaProxyMiddleware` — catches all non-`/admin` requests and proxies them |
| `rebuild.py` | Ollama image pull and managed container rebuild logic |

**Persistence (Docker volumes):**
- `/data/` — instances, skills, agents, routines, projects, settings, SOUL.MD
- `/mnt/host/` — full access to host Windows drives (C:, D:, etc.)

### Frontend (`d/MoLLAMA/src/frontend/`)

Built with **React 18 + TypeScript + Vite**.

**Key dependencies:**
- `react-resizable-panels` — resizable 3-panel layout (left / center / right)
- `framer-motion` — all animations, transitions, layout changes
- `@tanstack/react-query` — API data fetching and caching
- `@monaco-editor/react` — code editor (Projects + Tools Editor)
- `lucide-react` — icon library
- `sonner` — toast notifications

**Component map (`src/components/`):**

| Component | Description |
|-----------|-------------|
| `Dashboard.tsx` | Root layout — TopBar, 3-panel resizable shell, mobile layout |
| `ChatHub.tsx` | Main chat — sessions, markdown rendering, slash commands, agentic/streaming modes, file/image attachments |
| `InstanceManager.tsx` | Node management panel — deploy/stop/remove, model pull, key generation, status badges |
| `LiveFeed.tsx` | Real-time event feed from WebSocket |
| `ToolsEditor.tsx` | Tool file explorer + Monaco editor + AI code generation |
| `McpManager.tsx` | MCP server list, add/connect/disconnect, tool browser |
| `SkillsEditor.tsx` | Skills list + editor + test invocation |
| `SubagentEditor.tsx` | Agents list + editor + live streaming test runner |
| `WarRoom.tsx` | Multi-agent debate interface with rounds |
| `ProjectsPanel.tsx` | Project manager, file explorer, Monaco editor, project chat, Knowledge Vault |
| `SettingsPanel.tsx` | Full system settings — overview, cluster, Ollama updates, inference, model |
| `MemoryPanel.tsx` | SOUL.MD viewer/editor |
| `RoutinesPanel.tsx` | Routine CRUD, run-now, toggle |
| `PulsePanel.tsx` | Animated node status pulse display |
| `ConnectionGuard.tsx` | Offline/API-down overlay guard |

**Key frontend services (`src/lib/`):**
- `api.ts` — all API calls (REST + streaming generators)
- `utils.ts` — shared utilities

**Hooks (`src/hooks/`):**
- `use-websocket.ts` — WebSocket provider with auto-reconnect
- `use-api.ts` — React Query hooks for all API endpoints
- `use-connectivity.ts` — offline detection
- `use-system-stats.ts` — stats polling

---

## Getting Started

### Prerequisites

- **Docker Desktop** (Windows with WSL2 or Linux)
- **Ollama** installed on the host (for local GPU nodes)
- Ports `11111` (backend) and `22222` (frontend) available

### Clone & Launch

```bash
cd d/MoLLAMA
docker-compose up --build
```

Or for development with live reload:

```bash
# Backend (from d/MoLLAMA/src/backend/)
uvicorn main:app --host 0.0.0.0 --port 11111 --reload

# Frontend (from d/MoLLAMA/src/frontend/)
npm run dev
```

### Access the UI

Open **`http://localhost:22222`** in your browser.

### Node Setup (Ollama Instances)

1. Click **+** in the Nodes panel
2. Enter a name (e.g., `gpu1`, `cloud-a`)
3. Choose **Local GPU** or **Cloud** mode
4. Click **Execute** — MoLLAMA spins up a Docker container
5. After deployment, the public key is shown and copied to clipboard
6. Add it to your `~/.ollama/config.yml` on the host machine to register the node:

```yaml
hosts:
  "http://mollama_gpu1:11434":
    key: "<pasted key>"
```

---

## API Reference

Full API documentation is in [`docs/API.md`](docs/API.md).

**Base URL:** `http://localhost:11111`

**WebSocket:** `ws://localhost:11111/ws` — receives real-time state broadcasts.

**Quick reference:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/instances` | List all Ollama nodes |
| `POST` | `/admin/deploy` | Deploy a new managed Ollama container |
| `POST` | `/admin/start` / `/admin/stop` | Start/stop a node |
| `DELETE` | `/admin/remove` | Remove a node |
| `GET` | `/admin/models` | List all models across all nodes |
| `POST` | `/admin/pull` | Pull a model to a specific node |
| `POST` | `/admin/pull/all` | Pull a model to all active nodes |
| `GET` | `/api/tags` | Proxy: aggregated model list for Bolt.diy |
| `POST` | `/admin/chat/agentic` | Streaming agentic chat (NDJSON) |
| `POST` | `/admin/chat/compact` | Compact context window |
| `GET/POST` | `/admin/soul` | Read/write SOUL.MD |
| `GET/POST` | `/admin/skills` | List/create skills |
| `POST` | `/admin/skills/{name}/invoke` | Invoke a skill |
| `GET/POST` | `/admin/agents` | List/create agents |
| `POST` | `/admin/agents/{name}/run` | Run an agent task (NDJSON streaming) |
| `POST` | `/admin/warroom` | Multi-agent debate (NDJSON streaming) |
| `GET/POST` | `/admin/projects` | List/create projects |
| `GET` | `/admin/projects/{id}/files` | List project files (recursive tree) |
| `GET/POST` | `/admin/projects/{id}/files/read` | Read/write a project file |
| `GET/POST` | `/admin/routines` | List/create routines |
| `POST` | `/admin/routines/{name}/run` | Run a routine immediately |
| `GET/POST` | `/admin/tools` | List/edit/create tool files |
| `POST` | `/admin/tools/reload` | Hot-reload all tools |
| `POST` | `/admin/tools/generate/stream` | AI-generate a tool (streaming code) |
| `GET/POST` | `/admin/mcp/servers` | List/add MCP servers |
| `GET/POST` | `/admin/settings` | App settings |
| `POST` | `/admin/update` | Trigger Ollama image update |
| `POST` | `/admin/rebuild` | Rebuild all managed containers |

---

## Configuration

Settings are stored in `/data/settings.json` (inside the backend container, persisted via Docker volume).

**Key settings:**

| Key | Default | Description |
|-----|---------|-------------|
| `context_compression` | `false` | Auto-compact old messages |
| `compression_threshold` | `70` | Context % threshold to trigger compact |
| `orchestrator_enabled` | `false` | Enable tier-based model routing |
| `orchestrator_models` | all true | Toggle per-tier model availability |
| `max_tool_loops` | `50` | Max tool-call iterations per request |

---

## Project Structure

```
d/MoLLAMA/
├── dockerfile              # Multi-stage: frontend (node) + backend (python)
├── docker-compose.yml       # Services: backend, frontend, networks, volumes
├── requirements.txt          # Backend Python deps (FastAPI, httpx, docker, uvicorn)
├── compact.py               # Context compaction CLI script
├── TODO.MD                  # Full project roadmap
├── docs/
│   └── API.md               # Full API reference
└── src/
    ├── backend/
    │   ├── main.py          # FastAPI app + all endpoints
    │   ├── core.py          # Docker container management, health, routing
    │   ├── orchestrator.py  # Tier-based model router
    │   ├── proxy.py         # Full API proxy with dialect translation
    │   ├── events.py        # Event feed and stream log
    │   ├── tools/           # Python tool packages (file_system, finance, search, weather)
    │   ├── mcp_manager.py   # MCP server lifecycle
    │   ├── skills.py        # Skills CRUD + invocation
    │   ├── subagents.py     # Subagent CRUD + streaming execution
    │   ├── soul.py          # SOUL.MD memory
    │   ├── routines.py      # Routine scheduler
    │   ├── ws_manager.py     # WebSocket connection manager
    │   ├── middleware.py     # Ollama proxy middleware
    │   └── rebuild.py       # Ollama image update logic
    └── frontend/
        ├── package.json     # Node deps (React, framer-motion, Monaco, etc.)
        ├── vite.config.ts   # Vite config with API proxy to backend
        └── src/
            ├── App.tsx      # Root app with QueryClient + WebSocket provider
            ├── index.css    # Global styles
            ├── components/  # All React components (Dashboard, ChatHub, etc.)
            ├── hooks/       # useWebSocket, useApi, useConnectivity, useSystemStats
            └── lib/
                ├── api.ts   # All API call functions + streaming generators
                └── utils.ts # Shared utilities
```

---

## Roadmap (from TODO.MD)

The following features are planned or in-progress:

1. **Stability & Backend Refactor** — Fix proxy compatibility with Claude Code/Openclaw, live feed, maintenance console, resize rebuilds; modularize Python backend into folders; non-blocking tool calls and subagents; heartbeat system; subagent context injection
2. **Unified Components** — Master chatbox (markdown, file-paste, AI naming, thinking), master file explorer, skills → slash commands (`/plan`, `/analyze`, `/research`, `/frontend`, `/backend`), orchestrator routing configuration in settings
3. **IDE & Workspaces** — Projects IDE (code editor center, terminal bottom, file explorer left, chat right)
4. **Flow System** — n8n-style visual node editor replacing Routines; events (on_message), actions, tools, AI chat tabs, test tab; multi-account per channel (Discord, Telegram, Instagram)
5. **Channels** — Dedicated page for Discord, Telegram, Instagram accounts with time-based flows
6. **Aesthetics & UX** — Animated glassmorphism UI, laser-shot VFX during token generation, mouse hover effects, 3D tilt, smooth scrolling, mobile overhaul
7. **Full PC Access** — Host drive permissions with per-session allow/bypass prompts

---

*MoLLAMA — Multi-Agent AI Operating System. Built with FastAPI, React, Ollama, and Docker.*