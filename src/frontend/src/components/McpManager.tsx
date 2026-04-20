import { useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Plug, Plus, Trash2, RefreshCcw, Loader2, CheckCircle2,
  AlertCircle, ChevronDown, ChevronUp, Terminal, Globe, Wrench, X,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  useMcpServers, useAddMcpServer, useRemoveMcpServer,
  useConnectMcpServer, useDisconnectMcpServer,
  useAppSettings, useSaveAppSettings,
} from "@/hooks/use-api"
import { toast } from "sonner"
import type { McpServer } from "@/lib/api"

// ── Field helpers ──────────────────────────────────────────────────────────────

function Field({
  label, value, onChange, placeholder, monospace, hint,
}: {
  label: string; value: string; onChange: (v: string) => void
  placeholder?: string; monospace?: boolean; hint?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">{label}</label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={[
          "w-full rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-[11px] outline-none",
          "focus:border-primary/30 focus:bg-white/[0.06] transition-all placeholder:text-muted-foreground/20",
          monospace ? "font-mono" : "",
        ].join(" ")}
      />
      {hint && <p className="text-[8px] font-mono text-muted-foreground/25">{hint}</p>}
    </div>
  )
}

function TextareaField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string
}) {
  return (
    <div className="space-y-1">
      <label className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/40">{label}</label>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        rows={2}
        className="w-full rounded-lg border border-white/[0.07] bg-white/[0.04] px-3 py-2 text-[11px] font-mono outline-none focus:border-primary/30 focus:bg-white/[0.06] transition-all resize-none placeholder:text-muted-foreground/20"
      />
    </div>
  )
}

// ── Add Server Dialog ──────────────────────────────────────────────────────────

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

function AddServerDialog({ onClose }: { onClose: () => void }) {
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
      className="fixed inset-0 bg-background/60 backdrop-blur-xl z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, y: 16 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 16 }}
        onClick={e => e.stopPropagation()}
        className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border border-white/[0.07] bg-[#0d0d1c]/98 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/[0.05] bg-primary/[0.06]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
              <Plug size={13} className="text-primary" />
            </div>
            <div>
              <div className="text-[11px] font-mono font-black uppercase tracking-[0.22em]">Add MCP Server</div>
              <div className="text-[8.5px] font-mono text-muted-foreground/30 mt-px">Connect a Model Context Protocol server</div>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/[0.06] text-muted-foreground/40 hover:text-foreground transition-colors">
            <X size={13} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Transport selector */}
          <div className="grid grid-cols-2 gap-2">
            {(["stdio", "sse"] as const).map(t => (
              <button
                key={t}
                onClick={() => set("transport", t)}
                className={[
                  "flex items-center justify-center gap-2 py-2.5 rounded-xl border text-[10px] font-mono font-bold uppercase tracking-widest transition-all",
                  form.transport === t
                    ? "border-primary/30 bg-primary/10 text-primary shadow-inner"
                    : "border-white/[0.07] text-muted-foreground/40 hover:bg-white/[0.04] hover:text-muted-foreground/60",
                ].join(" ")}
              >
                {t === "stdio" ? <Terminal size={11} /> : <Globe size={11} />}
                {t === "stdio" ? "Stdio" : "SSE / HTTP"}
              </button>
            ))}
          </div>

          {/* Fields */}
          <div className="space-y-3">
            <Field label="Server Name" value={form.name} onChange={v => set("name", v)} placeholder="my-mcp-server" hint="Unique identifier for this server" />

            {form.transport === "stdio" ? (
              <>
                <Field label="Command" value={form.command} onChange={v => set("command", v)} placeholder="npx @modelcontextprotocol/server-sqlite" monospace />
                <Field label="Args" value={form.args} onChange={v => set("args", v)} placeholder="--db /path/to/db.sqlite" monospace hint="Space-separated arguments" />
                <TextareaField label="Environment Variables" value={form.env} onChange={v => set("env", v)} placeholder={"API_KEY=abc123\nDEBUG=true"} />
              </>
            ) : (
              <>
                <Field label="Server URL" value={form.url} onChange={v => set("url", v)} placeholder="http://localhost:3000/sse" monospace />
                <TextareaField label="Headers" value={form.headers} onChange={v => set("headers", v)} placeholder={"Authorization=Bearer token\nX-API-Key=abc"} />
              </>
            )}

            {/* Autoconnect toggle */}
            <div
              onClick={() => set("autoconnect", !form.autoconnect)}
              className="flex items-center justify-between cursor-pointer px-3 py-2.5 rounded-xl border border-white/[0.06] hover:bg-white/[0.03] transition-colors"
            >
              <div>
                <div className="text-[10px] font-mono text-foreground/80">Auto-connect on startup</div>
                <div className="text-[8.5px] font-mono text-muted-foreground/35 mt-px">Connect this server automatically when mollama starts</div>
              </div>
              <div className={["w-9 h-5 rounded-full transition-colors relative shrink-0 ml-3", form.autoconnect ? "bg-primary" : "bg-muted"].join(" ")}>
                <motion.div
                  animate={{ x: form.autoconnect ? 18 : 2 }}
                  transition={{ type: "spring", damping: 20, stiffness: 300 }}
                  className="absolute top-1 w-3.5 h-3.5 rounded-full bg-white shadow"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-red-500/20 bg-red-500/6 text-[9.5px] font-mono text-red-400">
              <AlertCircle size={11} className="shrink-0" /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button
              onClick={onClose}
              className="flex-1 h-9 rounded-xl border border-white/[0.07] text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground/60 hover:bg-white/[0.04] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              disabled={isPending}
              className="flex-1 h-9 rounded-xl bg-primary text-primary-foreground text-[9.5px] font-mono font-black uppercase tracking-widest hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
            >
              {isPending ? <Loader2 size={11} className="animate-spin" /> : <Plug size={11} />}
              {isPending ? "Connecting…" : "Add Server"}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
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
    <div className={[
      "rounded-xl border overflow-hidden transition-colors",
      server.connected ? "border-primary/15 bg-primary/[0.04]" : "border-border/20 bg-background/20",
    ].join(" ")}>
      <div className="flex items-center gap-3 px-3 py-2.5">
        {/* Status dot */}
        <div className="relative shrink-0">
          <div className={`w-1.5 h-1.5 rounded-full ${server.connected ? "bg-primary" : "bg-muted-foreground/20"}`} />
          {server.connected && (
            <motion.div
              animate={{ scale: [1, 2, 1], opacity: [0.5, 0, 0.5] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute inset-0 rounded-full bg-primary"
            />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono font-semibold text-foreground">{server.name}</span>
            <span className="text-[7.5px] font-mono px-1 py-px rounded border border-border/20 text-muted-foreground/40 uppercase tracking-wider">
              {server.transport}
            </span>
          </div>
          <div className="text-[8.5px] font-mono text-muted-foreground/35 truncate mt-0.5">
            {server.transport === "stdio" ? server.command : server.url}
          </div>
        </div>

        {/* Tool count badge */}
        {server.connected && server.tool_count > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg border border-primary/15 bg-primary/8 text-primary/70 text-[9px] font-mono shrink-0">
            <Wrench size={8} />
            {server.tool_count}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          {server.tool_count > 0 && (
            <button
              onClick={() => setExpanded(e => !e)}
              className="p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors"
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
            </button>
          )}
          <button
            onClick={handleToggle}
            disabled={busy}
            className={[
              "px-2 py-1 rounded-lg text-[8.5px] font-mono font-bold uppercase tracking-widest transition-all min-w-[52px] flex items-center justify-center",
              server.connected
                ? "border border-border/25 text-muted-foreground/60 hover:bg-secondary/40"
                : "bg-primary/10 border border-primary/25 text-primary hover:bg-primary/20",
            ].join(" ")}
          >
            {busy ? <Loader2 size={9} className="animate-spin" /> : server.connected ? "Disc." : "Connect"}
          </button>
          <button
            onClick={handleRemove}
            disabled={isRemoving}
            className="p-1.5 rounded-lg hover:bg-red-500/12 text-muted-foreground/20 hover:text-red-400 transition-colors"
          >
            <Trash2 size={10} />
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
            className="border-t border-border/15 bg-background/30 px-3 py-2.5 overflow-hidden"
          >
            <div className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 mb-1.5">Available Tools</div>
            <div className="space-y-1.5">
              {(server.tools as any[]).map((tool, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Wrench size={8} className="text-primary/30 mt-0.5 shrink-0" />
                  <div>
                    <span className="text-[9.5px] font-mono text-foreground/70 font-semibold">{tool.name}</span>
                    {tool.description && (
                      <p className="text-[8.5px] font-mono text-muted-foreground/30 mt-px leading-relaxed">{tool.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Settings section ───────────────────────────────────────────────────────────

export function InferenceSettings() {
  const { data: settings } = useAppSettings()
  const { mutateAsync: save, isPending } = useSaveAppSettings()

  const compression = settings?.context_compression ?? true
  const threshold = settings?.compression_threshold ?? 70

  const toggle = async () => {
    try {
      await save({ context_compression: !compression })
      toast.success(compression ? "Auto-compact disabled" : "Auto-compact enabled")
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const setThreshold = async (v: number) => {
    try {
      await save({ compression_threshold: v })
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  return (
    <div className="space-y-2">
      {/* Auto-compact toggle */}
      <div
        onClick={toggle}
        className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-border/15 bg-background/20 cursor-pointer hover:bg-background/30 transition-colors"
      >
        <div>
          <div className="text-[10.5px] font-mono font-semibold text-foreground/80">Auto-Compact</div>
          <div className="text-[8.5px] font-mono text-muted-foreground/35 mt-0.5 leading-relaxed">
            Summarise history when context reaches threshold
          </div>
        </div>
        <div className={["w-9 h-5 rounded-full transition-colors relative shrink-0", compression ? "bg-primary" : "bg-muted", isPending ? "opacity-50" : ""].join(" ")}>
          <motion.div
            animate={{ x: compression ? 18 : 2 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="absolute top-1 w-3.5 h-3.5 rounded-full bg-white shadow"
          />
        </div>
      </div>

      {/* Threshold slider */}
      {compression && (
        <div className="px-3 py-2 rounded-xl border border-border/15 bg-background/20 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-mono text-muted-foreground/50">Compact threshold</span>
            <span className="text-[9px] font-mono text-primary/70 tabular-nums">{threshold}%</span>
          </div>
          <input
            type="range" min={40} max={95} step={5}
            value={threshold}
            onChange={e => setThreshold(Number(e.target.value))}
            className="w-full h-1 accent-primary cursor-pointer"
          />
          <div className="flex justify-between text-[7.5px] font-mono text-muted-foreground/25">
            <span>40%</span><span>95%</span>
          </div>
        </div>
      )}
    </div>
  )
}

// ── McpManager ────────────────────────────────────────────────────────────────

export function McpManager() {
  const { data, isLoading } = useMcpServers()
  const [showAdd, setShowAdd] = useState(false)

  const servers: McpServer[] = data?.servers ?? []
  const connectedCount = servers.filter(s => s.connected).length
  const totalTools = servers.reduce((n, s) => n + (s.connected ? s.tool_count : 0), 0)

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/35 px-3 py-2.5 flex items-center justify-between bg-muted/8">
        <div className="flex items-center gap-2">
          <Plug size={11} className="text-primary/60" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.22em]">MCP Servers</span>
          {connectedCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="w-1 h-1 rounded-full bg-primary/60 inline-block" />
              <span className="text-[8px] font-mono text-primary/50">{connectedCount} live</span>
              {totalTools > 0 && (
                <span className="text-[8px] font-mono text-muted-foreground/30">· {totalTools} tools</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-primary/12 text-primary/50 hover:text-primary text-[8.5px] font-mono font-bold transition-colors"
        >
          <Plus size={10} /> Add
        </button>
      </div>

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full p-2 space-y-4">
        {/* Servers */}
        <div className="space-y-1.5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 size={14} className="animate-spin text-muted-foreground/30" />
            </div>
          ) : servers.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-10 h-10 rounded-2xl border border-border/20 bg-secondary/10 flex items-center justify-center">
                <Plug size={18} className="text-muted-foreground/20" />
              </div>
              <div>
                <p className="text-[10px] font-mono text-muted-foreground/30">No servers configured</p>
                <p className="text-[8.5px] font-mono text-muted-foreground/20 mt-px">Add an MCP server to extend capabilities</p>
              </div>
              <button
                onClick={() => setShowAdd(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-primary/10 border border-primary/20 text-primary/70 text-[9px] font-mono font-bold hover:bg-primary/15 transition-colors"
              >
                <Plus size={10} /> Add your first server
              </button>
            </div>
          ) : (
            servers.map(server => <ServerRow key={server.name} server={server} />)
          )}
        </div>

      </div>

      <AnimatePresence>
        {showAdd && <AddServerDialog onClose={() => setShowAdd(false)} />}
      </AnimatePresence>
    </Card>
  )
}
