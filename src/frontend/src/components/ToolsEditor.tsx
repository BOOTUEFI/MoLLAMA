import { useState, useCallback, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import Editor from "@monaco-editor/react"
import {
  Code2, Plus, Trash2, RefreshCcw, Save, ChevronRight,
  Loader2, CheckCircle2, Wrench, FileCode, ArrowLeft,
} from "lucide-react"
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

// ── ToolFileList ───────────────────────────────────────────────────────────────

export function ToolFileList({
  selectedPath,
  onSelect,
}: {
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const { data, isLoading } = useTools()
  const { mutateAsync: reload, isPending: isReloading } = useReloadTools()
  const [showNew, setShowNew] = useState(false)
  const tools: ToolFile[] = data?.tools ?? []

  const handleReload = async () => {
    try {
      const { loaded } = await reload(undefined)
      toast.success(`Reloaded — ${loaded} tool(s) active`)
    } catch (e: any) {
      toast.error("Reload failed", { description: e.message })
    }
  }

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      <div className="shrink-0 border-b border-border/40 px-3 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Wrench size={12} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">Tools</span>
          {data && (
            <span className="text-[9px] font-mono text-muted-foreground/40 ml-1">
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

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={14} className="animate-spin text-muted-foreground/40" />
          </div>
        ) : tools.length === 0 ? (
          <div className="p-4 text-center space-y-2">
            <Code2 size={22} className="mx-auto text-muted-foreground/20" />
            <p className="text-[10px] font-mono text-muted-foreground/30">No tools yet</p>
            <button
              onClick={() => setShowNew(true)}
              className="text-[9px] font-mono text-primary/60 hover:text-primary transition-colors"
            >
              + Create your first tool
            </button>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {tools.map(tool => (
              <button
                key={tool.path}
                onClick={() => onSelect(tool.path)}
                className={[
                  "w-full text-left rounded-lg px-2.5 py-2 transition-colors group",
                  selectedPath === tool.path
                    ? "bg-primary/12 border border-primary/20"
                    : "hover:bg-secondary/40 border border-transparent",
                ].join(" ")}
              >
                <div className="flex items-center gap-1.5">
                  <Code2 size={10} className={selectedPath === tool.path ? "text-primary" : "text-muted-foreground/40"} />
                  <span className={[
                    "text-[10px] font-mono truncate flex-1",
                    selectedPath === tool.path ? "text-foreground" : "text-muted-foreground/70",
                  ].join(" ")}>
                    {tool.path.replace(/\.py$/, "")}
                  </span>
                  {tool.functions.length > 0 && (
                    <span className="text-[8px] font-mono text-muted-foreground/30 shrink-0">
                      {tool.functions.length} fn{tool.functions.length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>
                {tool.functions.length > 0 && (
                  <div className="mt-1 pl-4 space-y-px">
                    {tool.functions.slice(0, 3).map(fn => (
                      <div key={fn} className="text-[8.5px] font-mono text-muted-foreground/30 truncate flex items-center gap-1">
                        <ChevronRight size={7} />
                        {fn}
                      </div>
                    ))}
                    {tool.functions.length > 3 && (
                      <div className="text-[8px] font-mono text-muted-foreground/20">
                        +{tool.functions.length - 3} more
                      </div>
                    )}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showNew && (
          <NewFileDialog
            onClose={() => setShowNew(false)}
            onCreated={(path) => { setShowNew(false); onSelect(path) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── ToolEditorPane ─────────────────────────────────────────────────────────────

export function ToolEditorPane({
  selectedPath,
  onClose,
}: {
  selectedPath: string
  onClose: () => void
}) {
  const { data } = useTools()
  const { mutateAsync: save, isPending: isSaving } = useSaveToolFile()
  const { mutateAsync: del, isPending: isDeleting } = useDeleteToolFile()
  const { data: fileCode, isLoading: isFileLoading } = useToolFile(selectedPath)

  const [editorCode, setEditorCode] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const lastLoadedRef = useRef<string | null>(null)

  useEffect(() => {
    if (fileCode !== undefined && lastLoadedRef.current !== selectedPath) {
      lastLoadedRef.current = selectedPath
      setEditorCode(fileCode)
      setDirty(false)
      setSaved(false)
    }
  }, [fileCode, selectedPath])

  const handleEditorChange = useCallback((value: string | undefined) => {
    setEditorCode(value ?? "")
    setDirty(true)
    setSaved(false)
  }, [])

  const handleSave = async () => {
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
    if (!window.confirm(`Delete ${selectedPath}?`)) return
    try {
      await del(selectedPath)
      toast.success("Deleted")
      onClose()
    } catch (e: any) {
      toast.error("Delete failed", { description: e.message })
    }
  }

  const handleClose = () => {
    if (dirty && !window.confirm("Discard unsaved changes?")) return
    onClose()
  }

  const tools: ToolFile[] = data?.tools ?? []

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24 }}
      transition={{ duration: 0.22, ease: "easeOut" }}
      className="h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden"
    >
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-border/30 bg-muted/10">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={handleClose}
            className="p-1 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors shrink-0"
            title="Back to chat"
          >
            <ArrowLeft size={13} />
          </button>
          <FileCode size={11} className="text-primary/70 shrink-0" />
          <span className="text-[10px] font-mono text-muted-foreground/70 truncate">{selectedPath}</span>
          {dirty && (
            <span className="text-[8px] font-mono text-amber-400/70 uppercase shrink-0">● unsaved</span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
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
              "flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
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

      {/* Schema footer */}
      {data?.schemas && (
        <div className="shrink-0 border-t border-border/20 px-3 py-1.5 bg-background/15">
          <span className="text-[8.5px] font-mono text-muted-foreground/35 uppercase tracking-widest">
            {data.schemas.filter((s: any) => {
              const fname = s?.function?.name ?? ""
              const toolFns = tools.find(t => t.path === selectedPath)?.functions ?? []
              return toolFns.includes(fname)
            }).length} function(s) registered
          </span>
        </div>
      )}
    </motion.div>
  )
}
