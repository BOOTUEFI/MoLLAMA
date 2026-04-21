import { useState, useEffect, useCallback, useRef, createContext, useContext } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Zap, Plus, Save, Trash2, Loader2, CheckCircle2, Play,
  ChevronRight, AlertCircle, RefreshCcw, X,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  fetchSkills, getSkill, saveSkill, deleteSkill, invokeSkill,
  type Skill,
} from "@/lib/api"
import { toast } from "sonner"

// ── constants ──────────────────────────────────────────────────────────────────

const EMPTY_SKILL: Skill = {
  name: "",
  description: "",
  system_prompt: "",
  instructions: "",
  model: "",
}

// ── shared input classes ───────────────────────────────────────────────────────

const inputCls =
  "w-full px-2 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg " +
  "focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/25 " +
  "text-foreground/80 transition-colors"

const textareaCls =
  inputCls +
  " resize-none leading-relaxed [&::-webkit-scrollbar]:w-1 " +
  "[&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full"

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground/50 select-none">
      {children}
    </span>
  )
}

// ── Context ────────────────────────────────────────────────────────────────────

interface SkillsContextValue {
  skills: Skill[]
  listLoading: boolean
  selectedName: string | null
  isNew: boolean
  draft: Skill
  saved: Skill
  editorLoading: boolean
  saving: boolean
  deleting: boolean
  justSaved: boolean
  invokeCtx: string
  invokeRunning: boolean
  invokeResult: { result: string; model: string } | null
  isDirty: boolean
  loadList: () => Promise<void>
  selectSkill: (name: string) => Promise<void>
  startNew: () => void
  handleSave: () => Promise<void>
  handleDelete: () => Promise<void>
  handleInvoke: () => Promise<void>
  set: <K extends keyof Skill>(key: K, val: Skill[K]) => void
  setInvokeCtx: (v: string) => void
  setInvokeResult: (v: { result: string; model: string } | null) => void
}

const SkillsCtx = createContext<SkillsContextValue | null>(null)
function useSkillsCtx() {
  const c = useContext(SkillsCtx)
  if (!c) throw new Error("No SkillsProvider")
  return c
}

function useSkillsState(): SkillsContextValue {
  const [skills, setSkills] = useState<Skill[]>([])
  const [listLoading, setListLoading] = useState(true)
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [draft, setDraft] = useState<Skill>(EMPTY_SKILL)
  const [saved, setSaved] = useState<Skill>(EMPTY_SKILL)
  const [editorLoading, setEditorLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const [invokeCtx, setInvokeCtx] = useState("")
  const [invokeRunning, setInvokeRunning] = useState(false)
  const [invokeResult, setInvokeResult] = useState<{ result: string; model: string } | null>(null)

  const isDirty =
    draft.name !== saved.name ||
    (draft.description ?? "") !== (saved.description ?? "") ||
    (draft.system_prompt ?? "") !== (saved.system_prompt ?? "") ||
    (draft.instructions ?? "") !== (saved.instructions ?? "") ||
    (draft.model ?? "") !== (saved.model ?? "")

  const loadList = useCallback(async () => {
    try {
      setListLoading(true)
      const list = await fetchSkills()
      setSkills(list)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setListLoading(false)
    }
  }, [])

  useEffect(() => { loadList() }, [loadList])

  const selectSkill = useCallback(async (name: string) => {
    setEditorLoading(true)
    setInvokeResult(null)
    setInvokeCtx("")
    setIsNew(false)
    setSelectedName(name)
    try {
      const sk = await getSkill(name)
      setDraft(sk)
      setSaved(sk)
    } catch (e: any) {
      toast.error(e.message)
      setSelectedName(null)
    } finally {
      setEditorLoading(false)
    }
  }, [])

  const startNew = useCallback(() => {
    setSelectedName("__new__")
    setIsNew(true)
    setDraft(EMPTY_SKILL)
    setSaved(EMPTY_SKILL)
    setInvokeResult(null)
    setInvokeCtx("")
  }, [])

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) { toast.error("Skill name is required"); return }
    setSaving(true)
    try {
      await saveSkill(draft.name.trim(), {
        description: draft.description,
        system_prompt: draft.system_prompt,
        instructions: draft.instructions,
        model: draft.model,
      })
      setSaved(draft)
      setJustSaved(true)
      setTimeout(() => setJustSaved(false), 2000)
      toast.success(`Skill "${draft.name}" saved`)
      if (isNew) { setIsNew(false); setSelectedName(draft.name.trim()) }
      await loadList()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }, [draft, isNew, loadList])

  const handleDelete = useCallback(async () => {
    if (!selectedName || selectedName === "__new__") return
    setDeleting(true)
    try {
      await deleteSkill(selectedName)
      toast.success(`Skill "${selectedName}" deleted`)
      setSelectedName(null)
      setIsNew(false)
      setDraft(EMPTY_SKILL)
      setSaved(EMPTY_SKILL)
      await loadList()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setDeleting(false)
    }
  }, [selectedName, loadList])

  const handleInvoke = useCallback(async () => {
    const name = isNew ? draft.name.trim() : selectedName
    if (!name) return
    setInvokeRunning(true)
    setInvokeResult(null)
    try {
      const res = await invokeSkill(name, invokeCtx, draft.model || undefined)
      setInvokeResult(res)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setInvokeRunning(false)
    }
  }, [isNew, draft.name, draft.model, selectedName, invokeCtx])

  const set = useCallback(<K extends keyof Skill>(key: K, val: Skill[K]) =>
    setDraft(d => ({ ...d, [key]: val })), [])

  return {
    skills, listLoading, selectedName, isNew, draft, saved,
    editorLoading, saving, deleting, justSaved, invokeCtx,
    invokeRunning, invokeResult, isDirty,
    loadList, selectSkill, startNew, handleSave, handleDelete, handleInvoke,
    set, setInvokeCtx, setInvokeResult,
  }
}

// ── Provider ───────────────────────────────────────────────────────────────────

export function SkillsProvider({ children }: { children: React.ReactNode }) {
  const state = useSkillsState()
  return <SkillsCtx.Provider value={state}>{children}</SkillsCtx.Provider>
}

// ── SkillsList (left panel sidebar) ───────────────────────────────────────────

export function SkillsList() {
  const { skills, listLoading, selectedName, isNew, selectSkill, startNew, loadList } = useSkillsCtx()

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-3 py-2.5 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Zap size={11} className="text-primary/70" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-widest">Skills</span>
          {!listLoading && (
            <span className="text-[8px] font-mono text-muted-foreground/30 ml-0.5">{skills.length}</span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={loadList}
            className="p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors" title="Reload">
            <RefreshCcw size={10} />
          </button>
        </div>
      </div>

      {/* New button */}
      <div className="shrink-0 px-2 pt-2">
        <button onClick={startNew}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 transition-colors">
          <Plus size={9} /> New Skill
        </button>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {listLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
          </div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <span className="text-[9px] font-mono text-muted-foreground/30">No skills yet</span>
          </div>
        ) : (
          <ul className="py-1">
            <AnimatePresence initial={false}>
              {skills.map(sk => {
                const active = selectedName === sk.name && !isNew
                return (
                  <motion.li key={sk.name}
                    initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }}
                    transition={{ duration: 0.15 }}>
                    <button onClick={() => selectSkill(sk.name)}
                      className={["w-full text-left px-3 py-2 flex items-start gap-1.5 transition-colors",
                        active ? "bg-primary/10 border-r-2 border-primary/60" : "hover:bg-muted/20"].join(" ")}>
                      <ChevronRight size={9} className={["mt-0.5 shrink-0 transition-colors",
                        active ? "text-primary/70" : "text-muted-foreground/20"].join(" ")} />
                      <div className="min-w-0">
                        <p className={["text-[10px] font-mono truncate leading-tight",
                          active ? "text-primary/90 font-bold" : "text-foreground/70"].join(" ")}>
                          {sk.name}
                        </p>
                        {sk.description && (
                          <p className="text-[8px] font-mono text-muted-foreground/40 truncate mt-0.5 leading-tight">
                            {sk.description}
                          </p>
                        )}
                      </div>
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </div>
  )
}

// ── SkillsMain (center editor) ─────────────────────────────────────────────────

export function SkillsMain() {
  const {
    selectedName, isNew, draft, editorLoading, saving, deleting, justSaved,
    invokeCtx, invokeRunning, invokeResult, isDirty,
    handleSave, handleDelete, handleInvoke, set, setInvokeCtx, setInvokeResult,
  } = useSkillsCtx()

  const hasSelection = selectedName !== null

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <Zap size={12} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">
            {isNew ? "New Skill" : selectedName && selectedName !== "__new__" ? selectedName : "Skills Editor"}
          </span>
          {isDirty && <span className="text-[8px] font-mono text-amber-400/60">●</span>}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {!hasSelection ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/20">
            <Zap size={22} strokeWidth={1} />
            <span className="text-[9px] font-mono uppercase tracking-widest">Select or create a skill</span>
          </motion.div>
        ) : (
          <motion.div key={selectedName}
            initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {editorLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 size={16} className="animate-spin text-muted-foreground/40" />
              </div>
            ) : (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                      <Label>Name</Label>
                      <input value={draft.name} onChange={e => isNew && set("name", e.target.value)}
                        readOnly={!isNew} placeholder="my-skill"
                        className={[inputCls, !isNew ? "opacity-50 cursor-not-allowed select-all" : ""].join(" ")} />
                    </div>
                    <div className="w-32 space-y-1">
                      <Label>Model</Label>
                      <input value={draft.model ?? ""} onChange={e => set("model", e.target.value)}
                        placeholder="auto" className={inputCls} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label>Description</Label>
                    <input value={draft.description ?? ""} onChange={e => set("description", e.target.value)}
                      placeholder="What this skill does…" className={inputCls} />
                  </div>
                  <div className="space-y-1">
                    <Label>System Prompt</Label>
                    <textarea value={draft.system_prompt ?? ""} onChange={e => set("system_prompt", e.target.value)}
                      rows={7} placeholder="You are a specialized assistant that…" className={textareaCls} />
                  </div>
                  <div className="space-y-1">
                    <Label>Instructions Template</Label>
                    <textarea value={draft.instructions ?? ""} onChange={e => set("instructions", e.target.value)}
                      rows={4} placeholder={"Use {context} to reference the provided context."} className={textareaCls} />
                  </div>
                  <div className="border-t border-border/20 pt-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Invoke / Test</Label>
                      {invokeResult && (
                        <span className="text-[8px] font-mono text-muted-foreground/30">via {invokeResult.model}</span>
                      )}
                    </div>
                    <textarea value={invokeCtx} onChange={e => setInvokeCtx(e.target.value)}
                      rows={3} placeholder="Context to pass to the skill…" className={textareaCls} />
                    <button onClick={handleInvoke} disabled={invokeRunning || (!isNew && !selectedName)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {invokeRunning ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                      {invokeRunning ? "Running…" : "Run"}
                    </button>
                    <AnimatePresence>
                      {invokeResult && (
                        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                          <div className="relative rounded-lg border border-border/25 bg-muted/10 p-2.5">
                            <button onClick={() => setInvokeResult(null)} className="absolute top-1.5 right-1.5 text-muted-foreground/30 hover:text-foreground transition-colors">
                              <X size={9} />
                            </button>
                            <pre className="text-[9px] font-mono text-foreground/70 leading-relaxed whitespace-pre-wrap break-words pr-4">
                              {invokeResult.result}
                            </pre>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>

                {/* Footer */}
                <div className="shrink-0 border-t border-border/30 px-4 py-2.5 flex items-center justify-between bg-muted/5">
                  <div className="flex items-center gap-1.5">
                    {isDirty && (
                      <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                        className="flex items-center gap-1 text-[8px] font-mono text-amber-400/60">
                        <AlertCircle size={8} /> unsaved
                      </motion.span>
                    )}
                    {justSaved && !isDirty && (
                      <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                        className="flex items-center gap-1 text-[8px] font-mono text-primary/60">
                        <CheckCircle2 size={8} /> saved
                      </motion.span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {!isNew && selectedName && (
                      <button onClick={handleDelete} disabled={deleting || saving}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive/70 text-[9px] font-mono hover:bg-destructive/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        {deleting ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
                        {deleting ? "Deleting…" : "Delete"}
                      </button>
                    )}
                    <button onClick={handleSave} disabled={saving || deleting || (!isDirty && !isNew)}
                      className={["flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider transition-all",
                        justSaved && !isDirty ? "bg-primary/15 text-primary border border-primary/25"
                          : isDirty || isNew ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "bg-secondary/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed"].join(" ")}>
                      {saving ? <Loader2 size={10} className="animate-spin" />
                        : justSaved && !isDirty ? <CheckCircle2 size={10} /> : <Save size={10} />}
                      {saving ? "Saving…" : justSaved && !isDirty ? "Saved" : "Save"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── SkillsEditor (combined, for mobile) ───────────────────────────────────────

export function SkillsEditor() {
  return (
    <SkillsProvider>
      <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
        <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center justify-between bg-muted/10">
          <div className="flex items-center gap-2">
            <Zap size={13} className="text-primary/70" />
            <span className="text-[10px] font-mono font-black uppercase tracking-widest">Skills</span>
            <span className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest">Reusable AI Capabilities</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 flex overflow-hidden">
          <div className="shrink-0 w-52 border-r border-border/30 overflow-hidden flex flex-col">
            <SkillsListInner />
          </div>
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
            <SkillsMainInner />
          </div>
        </div>
      </Card>
    </SkillsProvider>
  )
}

// Inner versions (no outer card) for use inside the combined editor
function SkillsListInner() {
  const { skills, listLoading, selectedName, isNew, selectSkill, startNew, loadList } = useSkillsCtx()
  return (
    <>
      <div className="shrink-0 px-3 py-2 border-b border-border/20">
        <button onClick={startNew}
          className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 transition-colors">
          <Plus size={9} /> New Skill
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {listLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={14} className="animate-spin text-muted-foreground/40" /></div>
        ) : skills.length === 0 ? (
          <div className="px-3 py-6 text-center"><span className="text-[9px] font-mono text-muted-foreground/30">No skills yet</span></div>
        ) : (
          <ul className="py-1">
            <AnimatePresence initial={false}>
              {skills.map(sk => {
                const active = selectedName === sk.name && !isNew
                return (
                  <motion.li key={sk.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={{ duration: 0.15 }}>
                    <button onClick={() => selectSkill(sk.name)}
                      className={["w-full text-left px-3 py-2 flex items-start gap-1.5 transition-colors",
                        active ? "bg-primary/10 border-r-2 border-primary/60" : "hover:bg-muted/20"].join(" ")}>
                      <ChevronRight size={9} className={["mt-0.5 shrink-0 transition-colors", active ? "text-primary/70" : "text-muted-foreground/20"].join(" ")} />
                      <div className="min-w-0">
                        <p className={["text-[10px] font-mono truncate leading-tight", active ? "text-primary/90 font-bold" : "text-foreground/70"].join(" ")}>{sk.name}</p>
                        {sk.description && <p className="text-[8px] font-mono text-muted-foreground/40 truncate mt-0.5 leading-tight">{sk.description}</p>}
                      </div>
                    </button>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </>
  )
}

function SkillsMainInner() {
  const {
    selectedName, isNew, draft, editorLoading, saving, deleting, justSaved,
    invokeCtx, invokeRunning, invokeResult, isDirty,
    handleSave, handleDelete, handleInvoke, set, setInvokeCtx, setInvokeResult,
  } = useSkillsCtx()
  const hasSelection = selectedName !== null
  return (
    <AnimatePresence mode="wait">
      {!hasSelection ? (
        <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground/20">
          <Zap size={22} strokeWidth={1} />
          <span className="text-[9px] font-mono uppercase tracking-widest">Select or create a skill</span>
        </motion.div>
      ) : (
        <motion.div key={selectedName} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.15 }} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {editorLoading ? (
            <div className="flex-1 flex items-center justify-center"><Loader2 size={16} className="animate-spin text-muted-foreground/40" /></div>
          ) : (
            <>
              <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
                <div className="flex gap-3">
                  <div className="flex-1 space-y-1">
                    <Label>Name</Label>
                    <input value={draft.name} onChange={e => isNew && set("name", e.target.value)} readOnly={!isNew} placeholder="my-skill"
                      className={[inputCls, !isNew ? "opacity-50 cursor-not-allowed select-all" : ""].join(" ")} />
                  </div>
                  <div className="w-32 space-y-1">
                    <Label>Model</Label>
                    <input value={draft.model ?? ""} onChange={e => set("model", e.target.value)} placeholder="auto" className={inputCls} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label>Description</Label>
                  <input value={draft.description ?? ""} onChange={e => set("description", e.target.value)} placeholder="What this skill does…" className={inputCls} />
                </div>
                <div className="space-y-1">
                  <Label>System Prompt</Label>
                  <textarea value={draft.system_prompt ?? ""} onChange={e => set("system_prompt", e.target.value)} rows={7} placeholder="You are a specialized assistant that…" className={textareaCls} />
                </div>
                <div className="space-y-1">
                  <Label>Instructions Template</Label>
                  <textarea value={draft.instructions ?? ""} onChange={e => set("instructions", e.target.value)} rows={4} placeholder={"Use {context} to reference the provided context."} className={textareaCls} />
                </div>
                <div className="border-t border-border/20 pt-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>Invoke / Test</Label>
                    {invokeResult && <span className="text-[8px] font-mono text-muted-foreground/30">via {invokeResult.model}</span>}
                  </div>
                  <textarea value={invokeCtx} onChange={e => setInvokeCtx(e.target.value)} rows={3} placeholder="Context to pass to the skill…" className={textareaCls} />
                  <button onClick={handleInvoke} disabled={invokeRunning || (!isNew && !selectedName)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                    {invokeRunning ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                    {invokeRunning ? "Running…" : "Run"}
                  </button>
                  <AnimatePresence>
                    {invokeResult && (
                      <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                        <div className="relative rounded-lg border border-border/25 bg-muted/10 p-2.5">
                          <button onClick={() => setInvokeResult(null)} className="absolute top-1.5 right-1.5 text-muted-foreground/30 hover:text-foreground transition-colors"><X size={9} /></button>
                          <pre className="text-[9px] font-mono text-foreground/70 leading-relaxed whitespace-pre-wrap break-words pr-4">{invokeResult.result}</pre>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
              <div className="shrink-0 border-t border-border/30 px-4 py-2.5 flex items-center justify-between bg-muted/5">
                <div className="flex items-center gap-1.5">
                  {isDirty && (
                    <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-1 text-[8px] font-mono text-amber-400/60">
                      <AlertCircle size={8} /> unsaved
                    </motion.span>
                  )}
                  {justSaved && !isDirty && (
                    <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      className="flex items-center gap-1 text-[8px] font-mono text-primary/60">
                      <CheckCircle2 size={8} /> saved
                    </motion.span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {!isNew && selectedName && (
                    <button onClick={handleDelete} disabled={deleting || saving}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive/70 text-[9px] font-mono hover:bg-destructive/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                      {deleting ? <Loader2 size={9} className="animate-spin" /> : <Trash2 size={9} />}
                      {deleting ? "Deleting…" : "Delete"}
                    </button>
                  )}
                  <button onClick={handleSave} disabled={saving || deleting || (!isDirty && !isNew)}
                    className={["flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider transition-all",
                      justSaved && !isDirty ? "bg-primary/15 text-primary border border-primary/25"
                        : isDirty || isNew ? "bg-primary text-primary-foreground hover:bg-primary/90"
                        : "bg-secondary/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed"].join(" ")}>
                    {saving ? <Loader2 size={10} className="animate-spin" /> : justSaved && !isDirty ? <CheckCircle2 size={10} /> : <Save size={10} />}
                    {saving ? "Saving…" : justSaved && !isDirty ? "Saved" : "Save"}
                  </button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
