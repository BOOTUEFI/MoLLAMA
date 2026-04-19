import { useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Editor from "@monaco-editor/react"
import {
  Code2, Plus, Trash2, RefreshCcw, Save, ChevronRight,
  Loader2, CheckCircle2, AlertCircle, Wrench, FileCode,
} from "lucide-react"
import { Card } from "@/components/ui/card"
import {
  useTools, useToolFile, useSaveToolFile, useDeleteToolFile, useReloadTools,
} from "@/hooks/use-api"
import { toast } from "sonner"
import type { ToolFile } from "@/lib/api"

// ── New-file dialog ────────────────────────────────────────────────────────────

const STARTER_TEMPLATE = `"""
My new tool — describe what it does here.
"""

def my_function(param: str) -> str:
    """One-line description shown to the LLM."""
    return f"Result: {param}"
`

function NewFileDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (path: string) => void
}) {
  const { mutateAsync: save, isPending } = useSaveToolFile()
  const [name, setName] = useState("")
  const [error, setError] = useState("")

  const handleCreate = async () => {
    const clean = name.trim().replace(/\.py$/, "")
    if (!clean) { setError("Name required"); return }
    if (!/^[a-z0-9_]+$/i.test(clean)) { setError("Only letters, digits, underscores"); return }
    const path = `${clean}.py`
    try {
      await save({ path, code: STARTER_TEMPLATE })
      toast.success(`Created ${path}`)
      onCreated(path)
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
        className="w-80 rounded-2xl border border-border/40 bg-card/95 backdrop-blur-2xl shadow-2xl p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <FileCode size={14} className="text-primary" />
          <span className="text-[11px] font-mono font-black uppercase tracking-[0.22em]">New Tool File</span>
        </div>

        <div className="space-y-1">
          <label className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground">File name</label>
          <div className="flex items-center gap-1 rounded-xl border border-border/30 bg-background/40 px-3 py-2">
            <input
              autoFocus
              className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground/30"
              placeholder="my_tool"
              value={name}
              onChange={e => { setName(e.target.value); setError("") }}
              onKeyDown={e => e.key === "Enter" && handleCreate()}
            />
            <span className="text-[10px] font-mono text-muted-foreground/40">.py</span>
          </div>
          {error && <p className="text-[9.5px] font-mono text-red-400">{error}</p>}
        </div>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-8 rounded-xl border border-border/30 text-[9.5px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-secondary/40 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={isPending}
            className="flex-1 h-8 rounded-xl bg-primary text-[9.5px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {isPending ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
            Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── ToolsEditor ────────────────────────────────────────────────────────────────

export function ToolsEditor() {
  const { data, isLoading, refetch } = useTools()
  const { mutateAsync: save, isPending: isSaving } = useSaveToolFile()
  const { mutateAsync: del, isPending: isDeleting } = useDeleteToolFile()
  const { mutateAsync: reload, isPending: isReloading } = useReloadTools()

  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [editorCode, setEditorCode] = useState<string>("")
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showNew, setShowNew] = useState(false)

  const { data: fileCode, isLoading: isFileLoading } = useToolFile(selectedPath)

  // Sync editor when file loads
  const prevPath = useState<string | null>(null)
  if (selectedPath && fileCode !== undefined && !dirty) {
    setEditorCode(fileCode)
  }

  const handleSelect = useCallback((path: string) => {
    if (dirty && selectedPath) {
      if (!window.confirm("Discard unsaved changes?")) return
    }
    setSelectedPath(path)
    setEditorCode("")
    setDirty(false)
    setSaved(false)
  }, [dirty, selectedPath])

  const handleEditorChange = useCallback((value: string | undefined) => {
    setEditorCode(value ?? "")
    setDirty(true)
    setSaved(false)
  }, [])

  const handleSave = async () => {
    if (!selectedPath) return
    try {
      await save({ path: selectedPath, code: editorCode })
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      toast.success("Saved & hot-reloaded")
    } catch (e: any) {
      toast.error("Save failed", { description: e.message })
    }
  }

  const handleDelete = async () => {
    if (!selectedPath) return
    if (!window.confirm(`Delete ${selectedPath}?`)) return
    try {
      await del(selectedPath)
      setSelectedPath(null)
      setEditorCode("")
      setDirty(false)
      toast.success("Deleted")
    } catch (e: any) {
      toast.error("Delete failed", { description: e.message })
    }
  }

  const handleReload = async () => {
    try {
      const { loaded } = await reload(undefined)
      toast.success(`Reloaded — ${loaded} tool(s) active`)
    } catch (e: any) {
      toast.error("Reload failed", { description: e.message })
    }
  }

  const tools: ToolFile[] = data?.tools ?? []

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-3 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Wrench size={12} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">Tool Editor</span>
          {data && (
            <span className="text-[9px] font-mono text-muted-foreground/40">
              {tools.length} file{tools.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleReload}
            disabled={isReloading}
            title="Hot-reload all tools"
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          >
            {isReloading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCcw size={12} />}
          </button>
          <button
            onClick={() => setShowNew(true)}
            title="New tool file"
            className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/70 hover:text-primary transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* File list */}
        <div className="w-40 shrink-0 border-r border-border/30 flex flex-col overflow-y-auto bg-background/20">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
            </div>
          ) : tools.length === 0 ? (
            <div className="p-3 text-[10px] font-mono text-muted-foreground/30 text-center">
              No tools yet
            </div>
          ) : (
            <div className="p-1 space-y-0.5">
              {tools.map(tool => (
                <button
                  key={tool.path}
                  onClick={() => handleSelect(tool.path)}
                  className={[
                    "w-full text-left rounded-lg px-2 py-1.5 transition-colors group",
                    selectedPath === tool.path
                      ? "bg-primary/12 border border-primary/20"
                      : "hover:bg-secondary/40 border border-transparent",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5">
                    <Code2 size={10} className={selectedPath === tool.path ? "text-primary" : "text-muted-foreground/40"} />
                    <span className={[
                      "text-[10px] font-mono truncate",
                      selectedPath === tool.path ? "text-foreground" : "text-muted-foreground/70",
                    ].join(" ")}>
                      {tool.path.replace(/\.py$/, "")}
                    </span>
                  </div>
                  {tool.functions.length > 0 && (
                    <div className="mt-0.5 pl-4 space-y-px">
                      {tool.functions.slice(0, 3).map(fn => (
                        <div key={fn} className="text-[8.5px] font-mono text-muted-foreground/30 truncate flex items-center gap-1">
                          <ChevronRight size={7} />
                          {fn}
                        </div>
                      ))}
                      {tool.functions.length > 3 && (
                        <div className="text-[8px] font-mono text-muted-foreground/20">+{tool.functions.length - 3} more</div>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor pane */}
        <div className="flex-1 flex flex-col min-w-0">
          {!selectedPath ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/20 gap-3">
              <Code2 size={28} className="opacity-20" />
              <span className="text-[10px] font-mono">Select a tool or create a new one</span>
            </div>
          ) : (
            <>
              {/* Toolbar */}
              <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-1.5 border-b border-border/25 bg-background/20">
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-muted-foreground/60">{selectedPath}</span>
                  {dirty && (
                    <span className="text-[8px] font-mono text-amber-400/70 uppercase">● unsaved</span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="p-1.5 rounded-lg hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                    title="Delete file"
                  >
                    {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={isSaving || !dirty}
                    className={[
                      "flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
                      saved
                        ? "bg-primary/15 text-primary border border-primary/25"
                        : dirty
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border border-border/25 text-muted-foreground/40",
                    ].join(" ")}
                  >
                    {isSaving
                      ? <Loader2 size={10} className="animate-spin" />
                      : saved
                        ? <CheckCircle2 size={10} />
                        : <Save size={10} />
                    }
                    {isSaving ? "Saving" : saved ? "Saved" : "Save"}
                  </button>
                </div>
              </div>

              {/* Monaco editor */}
              <div className="flex-1 overflow-hidden">
                {isFileLoading ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 size={16} className="animate-spin text-muted-foreground/40" />
                  </div>
                ) : (
                  <Editor
                    height="100%"
                    language="python"
                    theme="vs-dark"
                    value={editorCode}
                    onChange={handleEditorChange}
                    options={{
                      fontSize: 12,
                      fontFamily: "JetBrains Mono, Fira Code, monospace",
                      minimap: { enabled: false },
                      scrollBeyondLastLine: false,
                      lineNumbers: "on",
                      renderLineHighlight: "line",
                      bracketPairColorization: { enabled: true },
                      formatOnPaste: true,
                      tabSize: 4,
                      insertSpaces: true,
                      wordWrap: "on",
                      padding: { top: 8, bottom: 8 },
                    }}
                  />
                )}
              </div>

              {/* Schema preview */}
              {data?.schemas && (
                <div className="shrink-0 border-t border-border/20 px-3 py-1.5 bg-background/15">
                  <div className="text-[8.5px] font-mono text-muted-foreground/35 uppercase tracking-widest">
                    {data.schemas.filter((s: any) => {
                      const fname = s?.function?.name ?? ""
                      const toolFns = tools.find(t => t.path === selectedPath)?.functions ?? []
                      return toolFns.includes(fname)
                    }).length} function(s) registered
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showNew && (
          <NewFileDialog
            onClose={() => setShowNew(false)}
            onCreated={(path) => { setShowNew(false); handleSelect(path) }}
          />
        )}
      </AnimatePresence>
    </Card>
  )
}
