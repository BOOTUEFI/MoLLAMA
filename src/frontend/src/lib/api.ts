export const API_BASE_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.hostname}:11111`

export interface Instance {
  base_url: string
  active: boolean
  managed: boolean
  is_local?: boolean
  is_main?: boolean
}

export interface Instances {
  [key: string]: Instance
}

export interface Event {
  kind: "in" | "out" | "error" | "routed" | "ban" | "resp" | "mollama" | "ban_or_fail"
  method?: string
  path?: string
  msg?: string
  instance?: string
  status?: number
  elapsed?: number
  phase?: string
  model?: string
  ts: number
}

export interface EventsResponse {
  events: Event[]
  total: number
}

export interface ProcessingStatus {
  processing: { [key: string]: boolean }
}

export interface MaintenanceState {
  running: boolean
  paused: boolean
  mode: "update" | "rebuild" | null
  progress: number
  message: string
  error: string | null
  current_version: string | null
  latest_version: string | null
  total: number
  completed: number
  stop_requested: boolean
}

export interface StatsResponse {
  total_requests: number
  processing: { [key: string]: boolean }
  health: { [key: string]: boolean }
  banned_until: { [key: string]: number }
  managed_count?: number
  currentOllamaVersion?: string | null
  latestOllamaVersion?: string | null
  isLatest?: boolean
  maintenance?: MaintenanceState
}

export interface ChatMessage {
  role: "user" | "assistant" | "system"
  content: string
}

export interface StreamEntry {
  req_id: string
  content: string
  instance: string
  path: string
  ts: number
  done: boolean
}

export interface StreamLogResponse {
  streams: StreamEntry[]
}

export interface PullAllProgress {
  instance?: string
  status?: string
  error?: string
  total?: number
  completed?: number
  done?: boolean
}

// ── Admin: Instances ──────────────────────────────────────────────────────────

export const fetchStreamLog = async (limit = 50): Promise<StreamLogResponse> => {
  const response = await fetch(`${API_BASE_URL}/admin/stream_log?limit=${limit}`)
  if (!response.ok) throw new Error("Failed to fetch stream log")
  return response.json()
}

export const fetchInstances = async (): Promise<Instances> => {
  const response = await fetch(`${API_BASE_URL}/admin/instances`)
  if (!response.ok) throw new Error("Failed to fetch instances")
  return response.json()
}

export const fetchEvents = async (limit = 200): Promise<EventsResponse> => {
  const response = await fetch(`${API_BASE_URL}/admin/events?limit=${limit}`)
  if (!response.ok) throw new Error("Failed to fetch events")
  return response.json()
}

export const fetchProcessing = async (): Promise<ProcessingStatus> => {
  const response = await fetch(`${API_BASE_URL}/admin/processing`)
  if (!response.ok) throw new Error("Failed to fetch processing status")
  return response.json()
}

export const fetchStats = async (): Promise<StatsResponse> => {
  const response = await fetch(`${API_BASE_URL}/admin/stats`)
  if (!response.ok) throw new Error("Failed to fetch stats")
  return response.json()
}

export const updateOllama = async (): Promise<{ started: boolean; running?: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/update`, {
    method: "POST",
  })
  if (!response.ok) throw new Error("Failed to start Ollama update")
  return response.json()
}

export const rebuildOllama = async (): Promise<{ started: boolean; running?: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/rebuild`, {
    method: "POST",
  })
  if (!response.ok) throw new Error("Failed to start Ollama rebuild")
  return response.json()
}

export const pauseOllamaUpdate = async (paused: boolean): Promise<{ ok: boolean; paused: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/update/pause`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paused }),
  })
  if (!response.ok) throw new Error("Failed to pause/resume Ollama update")
  return response.json()
}

export const stopOllamaUpdate = async (): Promise<{ ok: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/update/stop`, {
    method: "POST",
  })
  if (!response.ok) throw new Error("Failed to stop Ollama update")
  return response.json()
}

export const deployInstance = async (cleanName: string): Promise<{ deployed: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/deploy`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clean_name: cleanName }),
  })
  if (!response.ok) throw new Error("Failed to deploy instance")
  return response.json()
}

export const banInstance = async (fullName: string, seconds?: number): Promise<{ banned: string; until: number }> => {
  const response = await fetch(`${API_BASE_URL}/admin/ban`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, ...(seconds && { seconds }) }),
  })
  if (!response.ok) throw new Error("Failed to ban instance")
  return response.json()
}

export const unbanInstance = async (fullName: string): Promise<{ unbanned: string }> => {
  const response = await fetch(`${API_BASE_URL}/admin/unban`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!response.ok) throw new Error("Failed to unban instance")
  return response.json()
}

export const startInstance = async (fullName: string): Promise<{ started: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!response.ok) throw new Error("Failed to start instance")
  return response.json()
}

export const stopInstance = async (fullName: string): Promise<{ stopped: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!response.ok) throw new Error("Failed to stop instance")
  return response.json()
}

export const removeInstance = async (fullName: string): Promise<{ removed: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/remove`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName }),
  })
  if (!response.ok) throw new Error("Failed to remove instance")
  return response.json()
}

export const updateInstance = async (
  fullName: string,
  updates: { is_local?: boolean; base_url?: string; active?: boolean }
): Promise<{ ok: boolean; recreated: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/instances/update`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ full_name: fullName, ...updates }),
  })
  if (!response.ok) throw new Error("Failed to update instance")
  return response.json()
}

export const setMainNode = async (fullName: string): Promise<{ ok: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/instances/${encodeURIComponent(fullName)}/set_main`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  })
  if (!response.ok) throw new Error("Failed to set main node")
  return response.json()
}

export const unsetMainNode = async (fullName: string): Promise<{ ok: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/instances/${encodeURIComponent(fullName)}/set_main`, {
    method: "DELETE",
  })
  if (!response.ok) throw new Error("Failed to unset main node")
  return response.json()
}

// ── Admin: System Prompt ──────────────────────────────────────────────────────

export const fetchSystemPrompt = async (): Promise<string> => {
  const response = await fetch(`${API_BASE_URL}/admin/system_prompt`)
  if (!response.ok) throw new Error("Failed to fetch system prompt")
  const data = await response.json()
  return data.prompt ?? ""
}

export const saveSystemPrompt = async (prompt: string): Promise<{ ok: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/system_prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  })
  if (!response.ok) throw new Error("Failed to save system prompt")
  return response.json()
}

// ── Admin: Models ─────────────────────────────────────────────────────────────

export const fetchModels = async (): Promise<string[]> => {
  const response = await fetch(`${API_BASE_URL}/admin/models`)
  if (!response.ok) throw new Error("Failed to fetch models")
  const data = await response.json()
  return data.models || []
}

export const fetchInstanceModels = async (fullName: string): Promise<string[]> => {
  const response = await fetch(`${API_BASE_URL}/admin/instances/${encodeURIComponent(fullName)}/models`)
  if (!response.ok) throw new Error("Failed to fetch instance models")
  const data = await response.json()
  return data.models || []
}

export const deleteModel = async (instance: string, model: string): Promise<{ ok: boolean }> => {
  const response = await fetch(`${API_BASE_URL}/admin/models`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance, model }),
  })
  if (!response.ok) throw new Error("Failed to delete model")
  return response.json()
}

// ── Streaming helpers ─────────────────────────────────────────────────────────

export async function* pullModelToAll(model: string): AsyncGenerator<PullAllProgress> {
  const response = await fetch(`${API_BASE_URL}/admin/pull/all`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  })
  if (!response.ok || !response.body) throw new Error("Pull failed")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      try { yield JSON.parse(line) as PullAllProgress } catch {}
    }
  }
}

export async function* pullModelToInstance(
  instance: string,
  model: string
): AsyncGenerator<{ status?: string; total?: number; completed?: number; error?: string }> {
  const response = await fetch(`${API_BASE_URL}/admin/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instance, model }),
  })
  if (!response.ok || !response.body) throw new Error("Pull failed")
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""
    for (const line of lines) {
      if (!line.trim()) continue
      try { yield JSON.parse(line) } catch {}
    }
  }
}

// ── Tools CRUD ────────────────────────────────────────────────────────────────

export interface ToolFile {
  path: string
  type: "simple" | "folder"
  functions: string[]
  context?: string
  context_path?: string | null
}

export interface ToolsResponse {
  tools: ToolFile[]
  schemas: object[]
}

export const fetchTools = async (): Promise<ToolsResponse> => {
  const r = await fetch(`${API_BASE_URL}/admin/tools`)
  if (!r.ok) throw new Error("Failed to fetch tools")
  return r.json()
}

export const fetchToolFile = async (path: string): Promise<string> => {
  const r = await fetch(`${API_BASE_URL}/admin/tools/file?path=${encodeURIComponent(path)}`)
  if (!r.ok) throw new Error("Failed to read tool file")
  const data = await r.json()
  return data.code ?? ""
}

export const saveToolFile = async (path: string, code: string): Promise<{ ok: boolean; loaded: number }> => {
  const r = await fetch(`${API_BASE_URL}/admin/tools/file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, code }),
  })
  if (!r.ok) throw new Error("Failed to save tool file")
  return r.json()
}

export const deleteToolFile = async (path: string): Promise<{ ok: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/tools/file`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  })
  if (!r.ok) throw new Error("Failed to delete tool file")
  return r.json()
}

export const reloadTools = async (): Promise<{ ok: boolean; loaded: number }> => {
  const r = await fetch(`${API_BASE_URL}/admin/tools/reload`, { method: "POST" })
  if (!r.ok) throw new Error("Failed to reload tools")
  return r.json()
}

// ── MCP Servers ───────────────────────────────────────────────────────────────

export interface McpServer {
  name: string
  transport: "stdio" | "sse"
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  autoconnect: boolean
  connected: boolean
  tool_count: number
  tools: object[]
}

export const fetchMcpServers = async (): Promise<{ servers: McpServer[] }> => {
  const r = await fetch(`${API_BASE_URL}/admin/mcp/servers`)
  if (!r.ok) throw new Error("Failed to fetch MCP servers")
  return r.json()
}

export const addMcpServer = async (cfg: Record<string, unknown>): Promise<{ ok: boolean; connected: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/mcp/servers`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  })
  if (!r.ok) throw new Error("Failed to add MCP server")
  return r.json()
}

export const removeMcpServer = async (name: string): Promise<{ ok: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/mcp/servers/${encodeURIComponent(name)}`, { method: "DELETE" })
  if (!r.ok) throw new Error("Failed to remove MCP server")
  return r.json()
}

export const connectMcpServer = async (name: string): Promise<{ ok: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/mcp/servers/${encodeURIComponent(name)}/connect`, { method: "POST" })
  if (!r.ok) throw new Error("Failed to connect MCP server")
  return r.json()
}

export const disconnectMcpServer = async (name: string): Promise<{ ok: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/mcp/servers/${encodeURIComponent(name)}/disconnect`, { method: "POST" })
  if (!r.ok) throw new Error("Failed to disconnect MCP server")
  return r.json()
}

// ── Settings ──────────────────────────────────────────────────────────────────

export interface AppSettings {
  context_compression?: boolean
  compression_threshold?: number
}

export const fetchAppSettings = async (): Promise<AppSettings> => {
  const r = await fetch(`${API_BASE_URL}/admin/settings`)
  if (!r.ok) throw new Error("Failed to fetch settings")
  return r.json()
}

export const saveAppSettings = async (settings: Partial<AppSettings>): Promise<{ ok: boolean }> => {
  const r = await fetch(`${API_BASE_URL}/admin/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  })
  if (!r.ok) throw new Error("Failed to save settings")
  return r.json()
}

// ── Proxy Endpoint ────────────────────────────────────────────────────────────

export const sendChatMessage = async function* (
  messages: ChatMessage[],
  model: string
): AsyncGenerator<{ content: string; model: string }> {
  const response = await fetch(`${API_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: true }),
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(errorData.error || "Failed to send message")
  }

  if (!response.body) throw new Error("No response body")

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() || ""

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const data = JSON.parse(trimmed)
        const content = data.message?.content ?? data.response ?? ""
        const actualModel = data.model ?? data.remote_model ?? ""

        if (content || actualModel) {
          yield { content, model: actualModel }
        }
      } catch {
        // Skip malformed chunks
      }
    }
  }
}