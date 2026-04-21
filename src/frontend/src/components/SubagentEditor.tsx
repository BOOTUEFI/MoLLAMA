import { useState, useEffect, useRef, useCallback, createContext, useContext } from "react"
import {
  Bot, Plus, Trash2, Save, Loader2, CheckCircle2,
  Play, Square, ChevronRight, AlertCircle, Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import { toast } from "sonner"
import { fetchAgents, saveAgent, deleteAgent, runAgent } from "@/lib/api"
import type { Agent } from "@/lib/api"

// ── helpers ────────────────────────────────────────────────────────────────────

const DEFAULTS = ["frontend-agent", "backend-agent"]

const BLANK_AGENT: Omit<Agent, "name"> = {
  description: "", system_prompt: "", model: "", enabled: true,
}

function slug(s: string) {
  return s.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")
}

// ── AgentRow ───────────────────────────────────────────────────────────────────

function AgentRow({ agent, selected, onClick }: { agent: Agent; selected: boolean; onClick: () => void }) {
  const isDefault = DEFAULTS.includes(agent.name)
  return (
    <button onClick={onClick}
      className={["w-full text-left rounded-lg px-2.5 py-2 transition-all border",
        selected ? "bg-primary/10 border-primary/25" : "hover:bg-secondary/40 border-transparent"].join(" ")}>
      <div className="flex items-center gap-1.5 min-w-0">
        <Bot size={10} className={selected ? "text-primary/80 shrink-0" : "text-muted-foreground/30 shrink-0"} />
        <span className={["text-[10px] font-mono truncate flex-1", selected ? "text-foreground" : "text-muted-foreground/60"].join(" ")}>
          {agent.name}
        </span>
        {isDefault && <span className="text-[7px] font-mono uppercase tracking-widest text-primary/30 shrink-0">default</span>}
        {agent.enabled === false && <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/20 shrink-0" />}
        {agent.enabled !== false && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/50 shrink-0" />}
      </div>
      {agent.description && (
        <p className="mt-0.5 pl-4 text-[9px] font-mono text-muted-foreground/30 truncate">{agent.description}</p>
      )}
    </button>
  )
}

// ── StreamOutput ───────────────────────────────────────────────────────────────

interface OutputLine { kind: "delta" | "tool" | "error" | "done"; text: string }

function StreamOutput({ lines }: { lines: OutputLine[] }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { if (ref.current) ref.current.scrollTop = ref.current.scrollHeight }, [lines])
  if (!lines.length) return null
  return (
    <div ref={ref} className="mt-2 rounded-xl border border-border/30 bg-black/30 p-3 max-h-64 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
      {lines.map((line, i) => {
        if (line.kind === "tool") return <div key={i} className="text-[9px] font-mono text-violet-400/60 leading-relaxed">{line.text}</div>
        if (line.kind === "error") return <div key={i} className="flex items-start gap-1.5 text-[9px] font-mono text-red-400/70 leading-relaxed"><AlertCircle size={8} className="mt-0.5 shrink-0" />{line.text}</div>
        if (line.kind === "done") return <div key={i} className="flex items-center gap-1.5 text-[9px] font-mono text-emerald-400/50 mt-1 pt-1 border-t border-border/20"><CheckCircle2 size={8} />done</div>
        return <span key={i} className="text-[10px] font-mono text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">{line.text}</span>
      })}
    </div>
  )
}

// ── TestPanel ──────────────────────────────────────────────────────────────────

function TestPanel({ agentName }: { agentName: string }) {
  const [task, setTask] = useState("")
  const [running, setRunning] = useState(false)
  const [lines, setLines] = useState<OutputLine[]>([])
  const abortRef = useRef<boolean>(false)

  const handleRun = useCallback(async () => {
    if (!task.trim() || running) return
    setLines([])
    setRunning(true)
    abortRef.current = false
    try {
      const gen = runAgent(agentName, task.trim())
      let fullText = ""
      for await (const ev of gen) {
        if (abortRef.current) break
        if (ev.type === "delta" && ev.text) {
          fullText += ev.text
          setLines(prev => {
            if (prev.length > 0 && prev[prev.length - 1].kind === "delta") {
              const next = [...prev]; next[next.length - 1] = { kind: "delta", text: fullText }; return next
            }
            return [...prev, { kind: "delta", text: fullText }]
          })
        } else if (ev.type === "done") {
          setLines(prev => [...prev, { kind: "done", text: "" }])
        } else if (ev.type === "error" && ev.error) {
          setLines(prev => [...prev, { kind: "error", text: ev.error! }])
        } else {
          const raw = ev as any
          if (raw.type === "tool_call") {
            const argsStr = typeof raw.args === "object" ? Object.entries(raw.args as Record<string, unknown>).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ") : String(raw.args ?? "")
            setLines(prev => [...prev, { kind: "tool", text: `[tool: ${raw.name}(${argsStr})]` }])
          } else if (raw.type === "tool_result") {
            const snippet = typeof raw.result === "string" ? raw.result.slice(0, 120) : ""
            setLines(prev => [...prev, { kind: "tool", text: `[result(${raw.name}) ${raw.ok ? "ok" : "err"}${snippet ? ": " + snippet : ""}]` }])
          }
        }
      }
    } catch (e: any) {
      if (!abortRef.current) { setLines(prev => [...prev, { kind: "error", text: e.message }]); toast.error("Agent run failed", { description: e.message }) }
    } finally {
      setRunning(false)
    }
  }, [agentName, task, running])

  const handleStop = () => { abortRef.current = true; setRunning(false); setLines(prev => [...prev, { kind: "error", text: "stopped by user" }]) }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Zap size={9} className="text-primary/40" />
        <span className="text-[9px] font-mono font-black uppercase tracking-[0.2em] text-muted-foreground/50">Test Agent</span>
      </div>
      <textarea rows={3} placeholder="Enter a task to send to this agent…" value={task} onChange={e => setTask(e.target.value)}
        className="w-full rounded-xl border border-border/30 bg-background/40 px-3 py-2.5 text-[11px] font-mono text-muted-foreground/80 outline-none resize-none placeholder:text-muted-foreground/20 focus:border-primary/30 focus:bg-white/[0.03] transition-all leading-relaxed" />
      <div className="flex items-center gap-2">
        {running ? (
          <button onClick={handleStop} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/12 text-red-400 hover:bg-red-500/20 text-[9px] font-mono font-bold uppercase tracking-widest transition-colors">
            <Square size={9} /> Stop
          </button>
        ) : (
          <button onClick={handleRun} disabled={!task.trim()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/22 text-[9px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-40">
            <Play size={9} /> Run
          </button>
        )}
        {running && <span className="flex items-center gap-1 text-[9px] font-mono text-muted-foreground/30"><Loader2 size={8} className="animate-spin" />streaming…</span>}
        {lines.length > 0 && !running && (
          <button onClick={() => setLines([])} className="text-[8px] font-mono text-muted-foreground/25 hover:text-muted-foreground/50 transition-colors ml-auto">clear</button>
        )}
      </div>
      <StreamOutput lines={lines} />
    </div>
  )
}

// ── EditorPane ─────────────────────────────────────────────────────────────────

interface DraftAgent { description: string; system_prompt: string; model: string; enabled: boolean }

function EditorPane({ agent, isNew, onSaved, onDeleted }: {
  agent: Agent; isNew: boolean; onSaved: (updated: Agent) => void; onDeleted: () => void
}) {
  const [draft, setDraft] = useState<DraftAgent>({
    description: agent.description ?? "", system_prompt: agent.system_prompt ?? "", model: agent.model ?? "", enabled: agent.enabled ?? true,
  })
  const [dirty, setDirty] = useState(isNew)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setDraft({ description: agent.description ?? "", system_prompt: agent.system_prompt ?? "", model: agent.model ?? "", enabled: agent.enabled ?? true })
    setDirty(isNew)
    setSaved(false)
  }, [agent.name, isNew])

  const set = (key: keyof DraftAgent, value: string | boolean) => { setDraft(d => ({ ...d, [key]: value })); setDirty(true); setSaved(false) }

  const handleSave = async () => {
    setSaving(true)
    try {
      const payload: Partial<Agent> = { description: draft.description || undefined, system_prompt: draft.system_prompt || undefined, model: draft.model || undefined, enabled: draft.enabled }
      await saveAgent(agent.name, payload)
      setDirty(false); setSaved(true); setTimeout(() => setSaved(false), 2500)
      toast.success(`Saved ${agent.name}`)
      onSaved({ ...agent, ...payload })
    } catch (e: any) {
      toast.error("Save failed", { description: e.message })
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete agent "${agent.name}"?`)) return
    setDeleting(true)
    try {
      await deleteAgent(agent.name)
      toast.success(`Deleted ${agent.name}`)
      onDeleted()
    } catch (e: any) {
      toast.error("Delete failed", { description: e.message })
      setDeleting(false)
    }
  }

  const isDefault = DEFAULTS.includes(agent.name)

  return (
    <div className="flex flex-col h-full overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
      <div className="shrink-0 flex items-center gap-2 px-4 py-2.5 border-b border-border/40 bg-muted/10 sticky top-0 z-10 backdrop-blur-xl">
        <Bot size={11} className="text-primary/60 shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground/70 truncate flex-1 min-w-0">{agent.name}</span>
        {isDefault && <span className="text-[7.5px] font-mono uppercase tracking-widest text-primary/30">default</span>}
        {dirty && <span className="text-[8px] font-mono text-amber-400/60 uppercase">●</span>}
        <div className="flex items-center gap-0.5 shrink-0">
          {!isDefault && (
            <button onClick={handleDelete} disabled={deleting} className="p-1.5 rounded-lg hover:bg-red-500/12 text-muted-foreground/25 hover:text-red-400 transition-colors" title="Delete agent">
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || !dirty}
            className={["flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
              saved ? "bg-emerald-500/12 text-emerald-400 border border-emerald-500/20"
                : dirty ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "border border-white/[0.06] text-muted-foreground/25 cursor-default"].join(" ")}>
            {saving ? <Loader2 size={9} className="animate-spin" /> : saved ? <CheckCircle2 size={9} /> : <Save size={9} />}
            {saving ? "Saving" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>
      <div className="flex-1 p-4 space-y-4">
        <div className="space-y-1">
          <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40">Name</label>
          <div className="flex items-center gap-2 rounded-xl border border-border/25 bg-background/30 px-3 py-2">
            <span className="text-[11px] font-mono text-muted-foreground/50 select-all">{agent.name}</span>
            {isDefault && <span className="text-[7px] font-mono text-muted-foreground/25 ml-auto">readonly</span>}
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40">Description</label>
          <input type="text" value={draft.description} onChange={e => set("description", e.target.value)} placeholder="Short description…"
            className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] font-mono text-muted-foreground/80 outline-none placeholder:text-muted-foreground/20 focus:border-primary/30 focus:bg-white/[0.03] transition-all" />
        </div>
        <div className="space-y-1">
          <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40">System Prompt</label>
          <textarea rows={10} value={draft.system_prompt} onChange={e => set("system_prompt", e.target.value)}
            placeholder="Define this agent's personality, specialization, and behavioral instructions…"
            className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2.5 text-[11px] font-mono text-muted-foreground/80 outline-none resize-y placeholder:text-muted-foreground/20 focus:border-primary/30 focus:bg-white/[0.03] transition-all leading-relaxed min-h-[140px]" />
        </div>
        <div className="space-y-1">
          <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40">Model</label>
          <input type="text" value={draft.model} onChange={e => set("model", e.target.value)} placeholder="auto — uses orchestrator"
            className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] font-mono text-muted-foreground/80 outline-none placeholder:text-muted-foreground/20 focus:border-primary/30 focus:bg-white/[0.03] transition-all" />
          <p className="text-[8px] font-mono text-muted-foreground/20 px-1">Leave blank to inherit from orchestrator settings</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={() => set("enabled", !draft.enabled)}
            className={["relative w-7 h-4 rounded-full transition-colors shrink-0", draft.enabled ? "bg-primary/70" : "bg-muted-foreground/20"].join(" ")} aria-pressed={draft.enabled}>
            <span className={["absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm", draft.enabled ? "left-[14px]" : "left-0.5"].join(" ")} />
          </button>
          <label className="text-[10px] font-mono text-muted-foreground/60 cursor-pointer select-none" onClick={() => set("enabled", !draft.enabled)}>
            {draft.enabled ? "Enabled" : "Disabled"}
          </label>
          <span className="text-[8px] font-mono text-muted-foreground/25">{draft.enabled ? "agent will receive tasks" : "agent is excluded from orchestration"}</span>
        </div>
        <div className="border-t border-border/25 pt-4">
          <TestPanel agentName={agent.name} />
        </div>
      </div>
    </div>
  )
}

// ── NewAgentDialog ─────────────────────────────────────────────────────────────

function NewAgentDialog({ onClose, onCreated }: { onClose: () => void; onCreated: (agent: Agent) => void }) {
  const [name, setName] = useState("")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)

  const handleCreate = async () => {
    const clean = slug(name.trim())
    if (!clean) { setError("Name required"); return }
    if (!/^[a-z0-9-]+$/.test(clean)) { setError("Use lowercase letters, digits, hyphens only"); return }
    setSaving(true)
    try {
      await saveAgent(clean, { enabled: true })
      toast.success(`Created ${clean}`)
      onCreated({ name: clean, enabled: true })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/70 backdrop-blur-xl z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
        onClick={e => e.stopPropagation()}
        className="w-72 rounded-2xl border border-white/[0.07] bg-card/95 backdrop-blur-2xl shadow-2xl shadow-black/60 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Bot size={13} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-[0.22em]">New Agent</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-1 rounded-xl border border-border/25 bg-background/40 px-3 py-2">
            <input autoFocus className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground/25"
              placeholder="agent-name" value={name}
              onChange={e => { setName(e.target.value); setError("") }}
              onKeyDown={e => e.key === "Enter" && handleCreate()} />
          </div>
          {name && <p className="text-[8.5px] font-mono text-muted-foreground/30 px-1">slug: <span className="text-primary/50">{slug(name.trim()) || "…"}</span></p>}
          {error && <p className="text-[9px] font-mono text-red-400/80">{error}</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-8 rounded-xl border border-white/[0.07] text-[9px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-white/[0.04] transition-colors">Cancel</button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 h-8 rounded-xl bg-primary text-[9px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
            {saving ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── Context ────────────────────────────────────────────────────────────────────

interface AgentsContextValue {
  agents: Agent[]
  loading: boolean
  selected: string | null
  newAgent: boolean
  newNames: Set<string>
  setSelected: (n: string | null) => void
  setNewAgent: (v: boolean) => void
  handleCreated: (agent: Agent) => void
  handleSaved: (updated: Agent) => void
  handleDeleted: () => void
  selectedAgent: Agent | null
}

const AgentsCtx = createContext<AgentsContextValue | null>(null)
function useAgentsCtx() {
  const c = useContext(AgentsCtx)
  if (!c) throw new Error("No AgentsProvider")
  return c
}

function useAgentsState(): AgentsContextValue {
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [newAgent, setNewAgent] = useState(false)
  const [newNames, setNewNames] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await fetchAgents()
      setAgents(list)
      if (!selected && list.length > 0) setSelected(list[0].name)
    } catch (e: any) {
      toast.error("Failed to load agents", { description: e.message })
    } finally {
      setLoading(false)
    }
  }, [selected])

  useEffect(() => { load() }, [])

  const selectedAgent = agents.find(a => a.name === selected) ?? null

  const handleCreated = useCallback((agent: Agent) => {
    setAgents(prev => [...prev, agent])
    setSelected(agent.name)
    setNewNames(prev => new Set([...prev, agent.name]))
    setNewAgent(false)
  }, [])

  const handleSaved = useCallback((updated: Agent) => {
    setAgents(prev => prev.map(a => a.name === updated.name ? updated : a))
    setNewNames(prev => { const next = new Set(prev); next.delete(updated.name); return next })
  }, [])

  const handleDeleted = useCallback(() => {
    setAgents(prev => {
      const remaining = prev.filter(a => a.name !== selected)
      setSelected(remaining.length > 0 ? remaining[0].name : null)
      return remaining
    })
  }, [selected])

  return { agents, loading, selected, newAgent, newNames, setSelected, setNewAgent, handleCreated, handleSaved, handleDeleted, selectedAgent }
}

// ── AgentsProvider ─────────────────────────────────────────────────────────────

export function AgentsProvider({ children }: { children: React.ReactNode }) {
  const state = useAgentsState()
  return <AgentsCtx.Provider value={state}>{children}</AgentsCtx.Provider>
}

// ── AgentsList (left panel sidebar) ───────────────────────────────────────────

export function AgentsList() {
  const { agents, loading, selected, setSelected, setNewAgent } = useAgentsCtx()

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/40 bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Bot size={11} className="text-primary/60" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.2em]">Agents</span>
          {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">{agents.length}</span>}
        </div>
        <button onClick={() => setNewAgent(true)} title="New agent"
          className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors">
          <Plus size={11} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <Bot size={20} className="text-muted-foreground/15" />
            <p className="text-[9px] font-mono text-muted-foreground/25">No agents yet</p>
            <button onClick={() => setNewAgent(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">+ Create first agent</button>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {agents.map(agent => (
              <AgentRow key={agent.name} agent={agent} selected={selected === agent.name} onClick={() => setSelected(agent.name)} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 px-3 py-1.5 border-t border-border/30">
        <p className="text-[7.5px] font-mono text-muted-foreground/20 leading-relaxed">
          Defaults: <span className="text-primary/30">frontend-agent</span> · <span className="text-primary/30">backend-agent</span>
        </p>
      </div>
    </div>
  )
}

// ── AgentsMain (center editor) ─────────────────────────────────────────────────

export function AgentsMain() {
  const { selectedAgent, newNames, newAgent, setNewAgent, handleCreated, handleSaved, handleDeleted } = useAgentsCtx()

  return (
    <div className="h-full border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      <AnimatePresence mode="wait">
        {selectedAgent ? (
          <motion.div key={selectedAgent.name} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="h-full">
            <EditorPane agent={selectedAgent} isNew={newNames.has(selectedAgent.name)} onSaved={handleSaved} onDeleted={handleDeleted} />
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/20">
            <Bot size={32} strokeWidth={1} />
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-mono uppercase tracking-widest">No agent selected</p>
              <p className="text-[9px] font-mono text-muted-foreground/15">Pick one from the list or create a new one</p>
            </div>
            <button onClick={() => setNewAgent(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/40 hover:border-primary/30 hover:text-primary transition-colors">
              <Plus size={9} /> New Agent
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {newAgent && (
          <NewAgentDialog onClose={() => setNewAgent(false)} onCreated={handleCreated} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── SubagentEditor (combined, for mobile) ─────────────────────────────────────

export function SubagentEditor() {
  return (
    <AgentsProvider>
      <SubagentEditorInner />
    </AgentsProvider>
  )
}

function SubagentEditorInner() {
  const { agents, loading, selected, setSelected, newAgent, setNewAgent, newNames, handleCreated, handleSaved, handleDeleted } = useAgentsCtx()
  const selectedAgent = agents.find(a => a.name === selected) ?? null

  return (
    <div className="h-full flex gap-3">
      <div className="w-52 shrink-0 flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
        <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/40 bg-muted/10">
          <div className="flex items-center gap-1.5">
            <Bot size={11} className="text-primary/60" />
            <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.2em]">Agents</span>
            {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">{agents.length}</span>}
          </div>
          <button onClick={() => setNewAgent(true)} title="New agent" className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors"><Plus size={11} /></button>
        </div>
        <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
          ) : agents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
              <Bot size={20} className="text-muted-foreground/15" />
              <p className="text-[9px] font-mono text-muted-foreground/25">No agents yet</p>
              <button onClick={() => setNewAgent(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">+ Create first agent</button>
            </div>
          ) : (
            <div className="p-1.5 space-y-0.5">
              {agents.map(agent => (
                <AgentRow key={agent.name} agent={agent} selected={selected === agent.name} onClick={() => setSelected(agent.name)} />
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 px-3 py-1.5 border-t border-border/30">
          <p className="text-[7.5px] font-mono text-muted-foreground/20 leading-relaxed">Defaults auto-created:<br /><span className="text-primary/30">frontend-agent</span> · <span className="text-primary/30">backend-agent</span></p>
        </div>
      </div>
      <div className="flex-1 min-w-0 border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedAgent ? (
            <motion.div key={selectedAgent.name} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }} className="h-full">
              <EditorPane agent={selectedAgent} isNew={newNames.has(selectedAgent.name)} onSaved={handleSaved} onDeleted={handleDeleted} />
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground/20">
              <Bot size={32} strokeWidth={1} />
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-mono uppercase tracking-widest">No agent selected</p>
                <p className="text-[9px] font-mono text-muted-foreground/15">Pick one from the list or create a new one</p>
              </div>
              <button onClick={() => setNewAgent(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/40 hover:border-primary/30 hover:text-primary transition-colors">
                <Plus size={9} /> New Agent
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {newAgent && <NewAgentDialog onClose={() => setNewAgent(false)} onCreated={handleCreated} />}
      </AnimatePresence>
    </div>
  )
}
