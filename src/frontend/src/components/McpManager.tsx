import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Plug, Plus, Trash2, RefreshCcw, Loader2, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, Terminal, Globe, Wrench,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  useMcpServers, useAddMcpServer, useRemoveMcpServer,
  useConnectMcpServer, useDisconnectMcpServer,
  useAppSettings, useSaveAppSettings,
} from "@/hooks/use-api"
import { toast } from "sonner"
import type { McpServer } from "@/lib/api"

// ── Add Server Form ────────────────────────────────────────────────────────────

const EMPTY_FORM = {
  name: "",
  transport: "stdio" as "stdio" | "sse",
  command: "",
  args: "",
  url: "",
  env: "",
  headers: "",
  autoconnect: true,
}

function AddServerForm({ onClose }: { onClose: () => void }) {
  const { mutateAsync: add, isPending } = useAddMcpServer()
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState("")

  const set = (k: keyof typeof form, v: unknown) =>
    setForm(prev => ({ ...prev, [k]: v }))

  const handleAdd = async () => {
    if (!form.name.trim()) { setError("Name required"); return }
    if (form.transport === "stdio" && !form.command.trim()) { setError("Command required for stdio"); return }
    if (form.transport === "sse" && !form.url.trim()) { setError("URL required for SSE"); return }

    const parseKV = (s: string): Record<string, string> => {
      const out: Record<string, string> = {}
      for (const line of s.split("\n")) {
        const idx = line.indexOf("=")
        if (idx > 0) out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
      }
      return out
    }

    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      transport: form.transport,
      autoconnect: form.autoconnect,
    }

    if (form.transport === "stdio") {
      payload.command = form.command.trim()
      payload.args = form.args.trim() ? form.args.trim().split(/\s+/) : []
      if (form.env.trim()) payload.env = parseKV(form.env)
    } else {
      payload.url = form.url.trim()
      if (form.headers.trim()) payload.headers = parseKV(form.headers)
    }

    try {
      await add(payload)
      toast.success(`MCP server "${form.name}" added`)
      onClose()
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/60 backdrop-blur-lg z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, y: 16 }} animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.93, y: 16 }}
        onClick={e => e.stopPropagation()}
        className="w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-border/40 bg-card/96 backdrop-blur-2xl shadow-2xl p-5 space-y-4"
      >
        {/* Header */}
        <div className="flex items-center gap-2">
          <Plug size={13} className="text-primary" />
          <span className="text-[11px] font-mono font-black uppercase tracking-[0.22em]">Add MCP Server</span>
        </div>

        {/* Transport toggle */}
        <div className="grid grid-cols-2 gap-1.5">
          {(["stdio", "sse"] as const).map(t => (
            <button
              key={t}
              onClick={() => set("transport", t)}
              className={[
                "flex items-center justify-center gap-1.5 py-2 rounded-xl border text-[10px] font-mono font-bold uppercase tracking-widest transition-colors",
                form.transport === t
                  ? "border-primary/30 bg-primary/10 text-primary"
                  : "border-border/25 text-muted-foreground/50 hover:bg-secondary/30",
              ].join(" ")}
            >
              {t === "stdio" ? <Terminal size={10} /> : <Globe size={10} />}
              {t}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div className="space-y-2">
          <Field label="Server Name" value={form.name} onChange={v => set("name", v)} placeholder="my-mcp-server" />

          {form.transport === "stdio" ? (
            <>
              <Field label="Command" value={form.command} onChange={v => set("command", v)} placeholder="npx my-mcp-server" monospace />
              <Field label="Args (space-separated)" value={form.args} onChange={v => set("args", v)} placeholder="--port 3000" monospace />
              <TextareaField label="Env (KEY=VALUE per line)" value={form.env} onChange={v => set("env", v)} />
            </>
          ) : (
            <>
              <Field label="URL" value={form.url} onChange={v => set("url", v)} placeholder="http://localhost:3000" monospace />
              <TextareaField label="Headers (KEY=VALUE per line)" value={form.headers} onChange={v => set("headers", v)} />
            </>
          )}

          {/* Autoconnect toggle */}
          <label className="flex items-center gap-2 cursor-pointer">
            <div
              onClick={() => set("autoconnect", !form.autoconnect)}
              className={[
                "w-8 h-4 rounded-full transition-colors relative",
                form.autoconnect ? "bg-primary" : "bg-muted",
              ].join(" ")}
            >
              <motion.div
                animate={{ x: form.autoconnect ? 16 : 2 }}
                transition={{ type: "spring", damping: 20, stiffness: 300 }}
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow"
              />
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">Auto-connect on startup</span>
          </label>
        </div>

        {error && (
          <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-red-400">
            <AlertCircle size={10} /> {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-9 rounded-xl border border-border/30 text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-secondary/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={isPending}
            className="flex-1 h-9 rounded-xl bg-primary text-primary-foreground text-[9.5px] font-mono font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Add Server
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Field helpers ──────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, monospace,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; monospace?: boolean
}) {
  return (
    <div className="space-y-0.5">
      <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/50">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={[
          "w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] outline-none focus:border-primary/35 transition-colors placeholder:text-muted-foreground/25",
          monospace ? "font-mono" : "",
        ].join(" ")}
      />
    </div>
  )
}

function TextareaField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-0.5">
      <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/50">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={2}
        className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] font-mono outline-none focus:border-primary/35 transition-colors resize-none placeholder:text-muted-foreground/25"
      />
    </div>
  )
}

// ── Server row ─────────────────────────────────────────────────────────────────

function ServerRow({ server }: { server: McpServer }) {
  const { mutateAsync: connect, isPending: isConnecting } = useConnectMcpServer()
  const { mutateAsync: disconnect, isPending: isDisconnecting } = useDisconnectMcpServer()
  const { mutateAsync: remove, isPending: isRemoving } = useRemoveMcpServer()
  const [expanded, setExpanded] = useState(false)

  const busy = isConnecting || isDisconnecting || isRemoving

  const handleToggle = async () => {
    try {
      if (server.connected) {
        await disconnect(server.name)
        toast.success(`Disconnected from ${server.name}`)
      } else {
        const { ok } = await connect(server.name)
        ok ? toast.success(`Connected to ${server.name}`) : toast.error(`Failed to connect to ${server.name}`)
      }
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleRemove = async () => {
    if (!window.confirm(`Remove ${server.name}?`)) return
    await remove(server.name)
    toast.success(`Removed ${server.name}`)
  }

  return (
    <div className="rounded-xl border border-border/20 bg-background/25 overflow-hidden">
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Status */}
        <div className="relative shrink-0">
          <div className={`w-2 h-2 rounded-full ${server.connected ? "bg-primary" : "bg-muted-foreground/25"}`} />
          {server.connected && (
            <motion.div
              animate={{ scale: [1, 1.8, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 rounded-full bg-primary"
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold text-foreground">{server.name}</span>
            <span className="text-[8px] font-mono px-1 rounded border border-border/25 text-muted-foreground/50 uppercase">
              {server.transport}
            </span>
          </div>
          <div className="text-[9px] font-mono text-muted-foreground/40 truncate mt-px">
            {server.transport === "stdio" ? server.command : server.url}
          </div>
        </div>

        {/* Tool count */}
        {server.connected && server.tool_count > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-primary/20 bg-primary/6 text-primary text-[9px] font-mono">
            <Wrench size={8} />
            {server.tool_count}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1">
          {server.tool_count > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1 rounded hover:bg-secondary/40 text-muted-foreground/40 hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
          <button
            onClick={handleToggle}
            disabled={busy}
            className={[
              "px-2 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
              server.connected
                ? "border border-border/30 text-muted-foreground hover:bg-secondary/40"
                : "bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20",
            ].join(" ")}
          >
            {busy ? <Loader2 size={10} className="animate-spin" /> : server.connected ? "Disc." : "Connect"}
          </button>
          <button
            onClick={handleRemove}
            disabled={isRemoving}
            className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/30 hover:text-red-400 transition-colors"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Tool list */}
      <AnimatePresence>
        {expanded && server.tools.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-border/20 bg-background/20 px-3 py-2 space-y-1 overflow-hidden"
          >
            {(server.tools as any[]).map((tool, i) => (
              <div key={i} className="flex items-start gap-2">
                <Wrench size={9} className="text-primary/40 mt-0.5 shrink-0" />
                <div>
                  <span className="text-[10px] font-mono text-foreground/80">{tool.name}</span>
                  {tool.description && (
                    <p className="text-[9px] font-mono text-muted-foreground/40 mt-px">{tool.description}</p>
                  )}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Settings section ───────────────────────────────────────────────────────────

function InferenceSettings() {
  const { data: settings } = useAppSettings()
  const { mutateAsync: save, isPending } = useSaveAppSettings()

  const compression = settings?.context_compression ?? false

  const toggle = async () => {
    try {
      await save({ context_compression: !compression })
      toast.success(compression ? "Compression disabled" : "Compression enabled")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border/20 bg-background/25">
        <div>
          <div className="text-[11px] font-mono font-semibold text-foreground">Context Compression</div>
          <div className="text-[9px] font-mono text-muted-foreground/40 mt-0.5">
            Summarise old messages to cut token usage (AirLLM-style)
          </div>
        </div>
        <div
          onClick={toggle}
          className={[
            "w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0",
            compression ? "bg-primary" : "bg-muted",
            isPending ? "opacity-50 pointer-events-none" : "",
          ].join(" ")}
        >
          <motion.div
            animate={{ x: compression ? 18 : 2 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="absolute top-1 w-3.5 h-3.5 rounded-full bg-white shadow"
          />
        </div>
      </div>
    </div>
  )
}

// ── McpManager ────────────────────────────────────────────────────────────────

export function McpManager() {
  const { data, isLoading } = useMcpServers()
  const [showAdd, setShowAdd] = useState(false)

  const servers: McpServer[] = data?.servers ?? []
  const connectedCount = servers.filter(s => s.connected).length

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-3 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Plug size={12} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">MCP Servers</span>
          {connectedCount > 0 && (
            <span className="text-[9px] font-mono text-primary/60">{connectedCount} live</span>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/70 hover:text-primary transition-colors"
        >
          <Plus size={12} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-4">
        {/* Servers */}
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-muted-foreground/20">
              <Plug size={22} className="opacity-20" />
              <span className="text-[10px] font-mono">No MCP servers configured</span>
              <button
                onClick={() => setShowAdd(true)}
                className="text-[9px] font-mono text-primary/60 hover:text-primary underline underline-offset-2"
              >
                Add your first server
              </button>
            </div>
          ) : (
            servers.map(server => <ServerRow key={server.name} server={server} />)
          )}
        </div>

        {/* Inference settings */}
        <div>
          <div className="text-[8.5px] font-mono uppercase tracking-[0.25em] text-muted-foreground/35 mb-2 px-1">
            Inference
          </div>
          <InferenceSettings />
        </div>
      </div>

      <AnimatePresence>
        {showAdd && <AddServerForm onClose={() => setShowAdd(false)} />}
      </AnimatePresence>
    </Card>
  )
}
