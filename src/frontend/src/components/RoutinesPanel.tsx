import { useState, useEffect, useCallback, createContext, useContext } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Clock, Plus, Trash2, Save, Loader2, CheckCircle2, RefreshCcw,
  Play, ChevronDown, ChevronRight, AlertCircle, Timer,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  fetchRoutines, saveRoutine, deleteRoutine, toggleRoutine, runRoutine,
} from "@/lib/api"
import type { Routine } from "@/lib/api"
import { toast } from "sonner"

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmtInterval(minutes: number): string {
  if (!minutes || minutes <= 0) return "—"
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `Every ${m}m`
  if (m === 0) return `Every ${h}h`
  return `Every ${h}h ${m}m`
}

function fmtLastRun(ts: number | null | undefined): string {
  if (!ts) return "Never"
  const diffMs = Date.now() - ts * 1000
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return "Just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  return `${Math.floor(diffH / 24)}d ago`
}

const EMPTY_ROUTINE: Omit<Routine, "name"> = {
  prompt: "", interval_minutes: 60, model: "", enabled: true, last_run: null,
}

const NEW_SENTINEL = "__new__"

// ── IntervalInput ──────────────────────────────────────────────────────────────

function IntervalInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => { setRaw(String(value)) }, [value])
  const handleBlur = () => {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n > 0) onChange(n)
    else setRaw(String(value))
  }
  return (
    <div className="flex items-center gap-2">
      <input type="number" min={1} value={raw} onChange={e => setRaw(e.target.value)} onBlur={handleBlur}
        className="w-20 px-2 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[9px] font-mono text-muted-foreground/40">min</span>
      <span className="text-[9px] font-mono text-primary/50 bg-primary/8 border border-primary/15 px-2 py-1 rounded-lg">
        {fmtInterval(parseInt(raw, 10) || value)}
      </span>
    </div>
  )
}

// ── Toggle ─────────────────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)}
      className={["relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors",
        checked ? "bg-primary/80 border-primary/60" : "bg-muted/30 border-border/30"].join(" ")}>
      <span className={["inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform",
        checked ? "translate-x-3.5" : "translate-x-0.5"].join(" ")} />
    </button>
  )
}

// ── Context ────────────────────────────────────────────────────────────────────

interface RoutinesContextValue {
  routines: Routine[]
  loading: boolean
  selected: string | null
  isNew: boolean
  load: () => Promise<void>
  handleSelectRoutine: (name: string) => void
  handleNew: () => void
  handleToggle: (name: string) => Promise<void>
  handleSaved: (updated: Routine) => void
  handleDeleted: () => void
  selectedRoutine: Routine | null
}

const RoutinesCtx = createContext<RoutinesContextValue | null>(null)
function useRoutinesCtx() {
  const c = useContext(RoutinesCtx)
  if (!c) throw new Error("No RoutinesProvider")
  return c
}

function useRoutinesState(): RoutinesContextValue {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const rs = await fetchRoutines()
      setRoutines(rs)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelectRoutine = useCallback((name: string) => {
    setIsNew(false)
    setSelected(name)
  }, [])

  const handleNew = useCallback(() => {
    setIsNew(true)
    setSelected(NEW_SENTINEL)
  }, [])

  const handleToggle = useCallback(async (name: string) => {
    try {
      await toggleRoutine(name)
      setRoutines(rs => rs.map(r => r.name === name ? { ...r, enabled: !r.enabled } : r))
    } catch (e: any) {
      toast.error(e.message)
    }
  }, [])

  const handleSaved = useCallback((updated: Routine) => {
    setRoutines(rs => {
      const exists = rs.find(r => r.name === updated.name)
      return exists ? rs.map(r => r.name === updated.name ? updated : r) : [...rs, updated]
    })
    setIsNew(false)
    setSelected(updated.name)
  }, [])

  const handleDeleted = useCallback(() => {
    setRoutines(rs => rs.filter(r => r.name !== selected))
    setSelected(null)
    setIsNew(false)
  }, [selected])

  const selectedRoutine = isNew
    ? { name: "", ...EMPTY_ROUTINE }
    : routines.find(r => r.name === selected) ?? null

  return { routines, loading, selected, isNew, load, handleSelectRoutine, handleNew, handleToggle, handleSaved, handleDeleted, selectedRoutine }
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function RoutinesProvider({ children }: { children: React.ReactNode }) {
  const state = useRoutinesState()
  return <RoutinesCtx.Provider value={state}>{children}</RoutinesCtx.Provider>
}

// ── RoutineListItem ────────────────────────────────────────────────────────────

function RoutineListItem({ routine, isSelected, onSelect, onToggle }: {
  routine: Routine; isSelected: boolean; onSelect: () => void; onToggle: () => void
}) {
  return (
    <button onClick={onSelect}
      className={["w-full text-left rounded-lg px-2.5 py-2 transition-all group border",
        isSelected ? "bg-primary/10 border-primary/25" : "border-transparent hover:bg-secondary/40"].join(" ")}>
      <div className="flex items-center gap-2 min-w-0">
        <div className={["w-1.5 h-1.5 rounded-full shrink-0",
          routine.enabled ? "bg-emerald-400/80" : "bg-muted-foreground/20"].join(" ")} />
        <span className={["text-[10px] font-mono truncate flex-1 min-w-0",
          isSelected ? "text-foreground" : "text-muted-foreground/70"].join(" ")}>{routine.name}</span>
        {routine.interval_minutes ? (
          <span className="text-[8px] font-mono tabular-nums text-muted-foreground/30 shrink-0">{fmtInterval(routine.interval_minutes)}</span>
        ) : null}
        <span onClick={e => { e.stopPropagation(); onToggle() }} className="shrink-0">
          <Toggle checked={!!routine.enabled} onChange={() => onToggle()} />
        </span>
      </div>
    </button>
  )
}

// ── RoutineEditor ──────────────────────────────────────────────────────────────

interface EditorState {
  name: string; prompt: string; interval_minutes: number; model: string; enabled: boolean; last_run?: number | null
}

function toEditorState(r: Routine): EditorState {
  return { name: r.name, prompt: r.prompt ?? "", interval_minutes: r.interval_minutes ?? 60, model: r.model ?? "", enabled: r.enabled ?? true, last_run: r.last_run }
}

function editorStateDirty(a: EditorState, b: EditorState): boolean {
  return a.prompt !== b.prompt || a.interval_minutes !== b.interval_minutes || a.model !== b.model || a.enabled !== b.enabled
}

function RoutineEditor({ routine, isNew, onSaved, onDeleted }: {
  routine: Routine; isNew: boolean; onSaved: (updated: Routine) => void; onDeleted: () => void
}) {
  const [form, setForm] = useState<EditorState>(() => toEditorState(routine))
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [running, setRunning] = useState(false)
  const [runResult, setRunResult] = useState<{ ok: boolean; result?: string; error?: string; model?: string } | null>(null)
  const [showOutput, setShowOutput] = useState(false)

  useEffect(() => {
    setForm(toEditorState(routine))
    setSaved(false)
    setRunResult(null)
    setShowOutput(false)
  }, [routine.name])

  const isDirty = editorStateDirty(form, toEditorState(routine))
  const set = <K extends keyof EditorState>(key: K, val: EditorState[K]) => setForm(f => ({ ...f, [key]: val }))

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("Routine name is required"); return }
    setSaving(true)
    try {
      await saveRoutine(form.name, { prompt: form.prompt, interval_minutes: form.interval_minutes, model: form.model || undefined, enabled: form.enabled })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      toast.success(`Routine "${form.name}" saved`)
      onSaved({ ...routine, ...form, model: form.model || undefined })
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!window.confirm(`Delete routine "${form.name}"?`)) return
    setDeleting(true)
    try {
      await deleteRoutine(form.name)
      toast.success(`Routine "${form.name}" deleted`)
      onDeleted()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }

  const handleRun = async () => {
    setRunning(true)
    setRunResult(null)
    try {
      const res = await runRoutine(form.name)
      setRunResult(res)
      setShowOutput(true)
      if (res.ok) toast.success(`Routine "${form.name}" ran successfully`)
      else toast.error(`Routine failed: ${res.error ?? "unknown error"}`)
    } catch (e: any) {
      setRunResult({ ok: false, error: e.message })
      setShowOutput(true)
      toast.error(e.message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2 min-w-0">
          <Timer size={12} className="text-primary/60 shrink-0" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest truncate">{isNew ? "New Routine" : form.name}</span>
          {isDirty && <span className="text-[8px] font-mono text-amber-400/60 uppercase">●</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {!isNew && (
            <button onClick={handleRun} disabled={running}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/12 text-emerald-400 hover:bg-emerald-500/20 text-[9px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-50">
              {running ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />} Run Now
            </button>
          )}
          {!isNew && (
            <button onClick={handleDelete} disabled={deleting}
              className="p-1.5 rounded-lg hover:bg-red-500/12 text-muted-foreground/30 hover:text-red-400 transition-colors">
              {deleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
            </button>
          )}
          <button onClick={handleSave} disabled={saving || (!isDirty && !isNew)}
            className={["flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider transition-all",
              saved ? "bg-primary/15 text-primary border border-primary/25"
                : isDirty || isNew ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed"].join(" ")}>
            {saving ? <Loader2 size={9} className="animate-spin" /> : saved ? <CheckCircle2 size={9} /> : <Save size={9} />}
            {saving ? "Saving…" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        <div className="px-4 py-3 space-y-3">
          <div className="space-y-1">
            <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40 block">Name</label>
            {isNew ? (
              <input autoFocus value={form.name} onChange={e => set("name", e.target.value)} placeholder="my-routine"
                className="w-full px-2.5 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/25" />
            ) : (
              <div className="px-2.5 py-1.5 text-[10px] font-mono text-muted-foreground/50 bg-muted/10 border border-border/20 rounded-lg select-all">{form.name}</div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40 block">Prompt</label>
            <textarea rows={8} value={form.prompt} onChange={e => set("prompt", e.target.value)}
              placeholder={"Describe what this routine should do…\n\ne.g. Summarize recent news and save to memory."} spellCheck={false}
              className="w-full resize-none px-2.5 py-2 text-[10px] font-mono leading-relaxed bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/20 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full" />
          </div>
          <div className="space-y-1">
            <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40 block">Interval</label>
            <IntervalInput value={form.interval_minutes} onChange={v => set("interval_minutes", v)} />
            <p className="text-[8px] font-mono text-muted-foreground/30">
              Last run: <span className={form.last_run ? "text-muted-foreground/50" : "text-muted-foreground/25"}>{fmtLastRun(form.last_run)}</span>
            </p>
          </div>
          <div className="space-y-1">
            <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40 block">Model</label>
            <input value={form.model} onChange={e => set("model", e.target.value)} placeholder="auto"
              className="w-full px-2.5 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/25" />
            <p className="text-[8px] font-mono text-muted-foreground/25">Leave blank to use default routing</p>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/20 bg-muted/5 px-3 py-2">
            <div>
              <p className="text-[9px] font-mono font-bold">Enabled</p>
              <p className="text-[8px] font-mono text-muted-foreground/30 mt-0.5">{form.enabled ? "This routine will run on schedule" : "This routine is paused"}</p>
            </div>
            <Toggle checked={form.enabled} onChange={v => set("enabled", v)} />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {runResult && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}
            className="shrink-0 border-t border-border/30 overflow-hidden">
            <div className="bg-background/30">
              <button onClick={() => setShowOutput(o => !o)}
                className="w-full flex items-center gap-2 px-4 py-2 hover:bg-white/[0.02] transition-colors group">
                {runResult.ok ? <CheckCircle2 size={10} className="text-emerald-400/80 shrink-0" /> : <AlertCircle size={10} className="text-red-400/80 shrink-0" />}
                <span className={["text-[9px] font-mono flex-1 text-left", runResult.ok ? "text-emerald-400/60" : "text-red-400/60"].join(" ")}>
                  {runResult.ok ? "Run completed" : "Run failed"}
                  {runResult.model ? <span className="text-muted-foreground/25 ml-2">via {runResult.model}</span> : null}
                </span>
                {showOutput ? <ChevronDown size={9} className="text-muted-foreground/30 shrink-0" /> : <ChevronRight size={9} className="text-muted-foreground/30 shrink-0" />}
              </button>
              <AnimatePresence>
                {showOutput && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.14 }} className="overflow-hidden">
                    <pre className={["px-4 pb-3 text-[9px] font-mono leading-relaxed whitespace-pre-wrap break-all max-h-40 overflow-y-auto",
                      "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full",
                      runResult.ok ? "text-emerald-300/70" : "text-red-400/70"].join(" ")}>
                      {runResult.ok ? (runResult.result ?? "(no output)") : (runResult.error ?? "Unknown error")}
                    </pre>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── RoutinesList (left panel sidebar) ─────────────────────────────────────────

export function RoutinesList() {
  const { routines, loading, selected, isNew, load, handleSelectRoutine, handleNew, handleToggle } = useRoutinesCtx()

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      <div className="shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Clock size={11} className="text-primary/60" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-widest">Routines</span>
          {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 tabular-nums ml-0.5">{routines.length}</span>}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={load} className="p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors" title="Refresh">
            <RefreshCcw size={10} />
          </button>
          <button onClick={handleNew} className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors" title="New Routine">
            <Plus size={11} />
          </button>
        </div>
      </div>

      <div className="shrink-0 px-2 pt-2">
        <button onClick={handleNew}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-primary/25 text-primary/50 hover:text-primary hover:border-primary/40 hover:bg-primary/5 text-[9px] font-mono font-bold uppercase tracking-widest transition-all">
          <Plus size={9} /> New Routine
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto py-1.5 px-1.5 space-y-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
        ) : routines.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-2">
            <Clock size={18} className="text-muted-foreground/15" />
            <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No routines yet</p>
          </div>
        ) : (
          routines.map(r => (
            <RoutineListItem key={r.name} routine={r}
              isSelected={selected === r.name && !isNew}
              onSelect={() => handleSelectRoutine(r.name)}
              onToggle={() => handleToggle(r.name)} />
          ))
        )}
      </div>
    </div>
  )
}

// ── RoutinesMain (center editor) ───────────────────────────────────────────────

export function RoutinesMain() {
  const { selectedRoutine, isNew, selected, handleSaved, handleDeleted, handleNew } = useRoutinesCtx()

  return (
    <div className="h-full border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      {selectedRoutine ? (
        <RoutineEditor
          key={isNew ? NEW_SENTINEL : selected!}
          routine={selectedRoutine}
          isNew={isNew}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      ) : (
        <div className="flex-1 h-full flex flex-col items-center justify-center gap-3 text-center px-6">
          <Clock size={28} className="text-muted-foreground/10" />
          <div className="space-y-1">
            <p className="text-[10px] font-mono font-bold text-muted-foreground/30 uppercase tracking-widest">No Routine Selected</p>
            <p className="text-[9px] font-mono text-muted-foreground/20">Pick a routine from the list or create a new one</p>
          </div>
          <button onClick={handleNew}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary hover:bg-primary/15 text-[9px] font-mono font-bold uppercase tracking-widest transition-all">
            <Plus size={9} /> New Routine
          </button>
        </div>
      )}
    </div>
  )
}

// ── RoutinesPanel (combined, for mobile) ──────────────────────────────────────

export function RoutinesPanel() {
  return (
    <RoutinesProvider>
      <RoutinesPanelInner />
    </RoutinesProvider>
  )
}

function RoutinesPanelInner() {
  const { routines, loading, selected, isNew, load, handleSelectRoutine, handleNew, handleToggle, handleSaved, handleDeleted, selectedRoutine } = useRoutinesCtx()

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
      <div className="flex-1 min-h-0 flex">
        <div className="w-52 shrink-0 flex flex-col border-r border-border/40 bg-muted/5">
          <div className="shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center justify-between bg-muted/10">
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-primary/60" />
              <span className="text-[10px] font-mono font-black uppercase tracking-widest">Routines</span>
              {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 tabular-nums ml-0.5">{routines.length}</span>}
            </div>
            <div className="flex items-center gap-0.5">
              <button onClick={load} className="p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors" title="Refresh"><RefreshCcw size={11} /></button>
              <button onClick={handleNew} className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors" title="New Routine"><Plus size={11} /></button>
            </div>
          </div>
          <div className="shrink-0 px-2 pt-2">
            <button onClick={handleNew} className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-primary/25 text-primary/50 hover:text-primary hover:border-primary/40 hover:bg-primary/5 text-[9px] font-mono font-bold uppercase tracking-widest transition-all">
              <Plus size={9} /> New Routine
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto py-1.5 px-1.5 space-y-0.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
            {loading ? (
              <div className="flex items-center justify-center py-10"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
            ) : routines.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-2">
                <Clock size={18} className="text-muted-foreground/15" />
                <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No routines yet</p>
              </div>
            ) : (
              routines.map(r => (
                <RoutineListItem key={r.name} routine={r} isSelected={selected === r.name && !isNew}
                  onSelect={() => handleSelectRoutine(r.name)} onToggle={() => handleToggle(r.name)} />
              ))
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col">
          {selectedRoutine ? (
            <RoutineEditor key={isNew ? NEW_SENTINEL : selected!} routine={selectedRoutine} isNew={isNew} onSaved={handleSaved} onDeleted={handleDeleted} />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
              <Clock size={28} className="text-muted-foreground/10" />
              <div className="space-y-1">
                <p className="text-[10px] font-mono font-bold text-muted-foreground/30 uppercase tracking-widest">No Routine Selected</p>
                <p className="text-[9px] font-mono text-muted-foreground/20">Pick a routine from the list or create a new one</p>
              </div>
              <button onClick={handleNew} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/60 hover:text-primary hover:bg-primary/15 text-[9px] font-mono font-bold uppercase tracking-widest transition-all">
                <Plus size={9} /> New Routine
              </button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
