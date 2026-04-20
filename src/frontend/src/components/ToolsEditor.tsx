import { useState, useCallback, useEffect, useRef } from "react"
import Editor from "@monaco-editor/react"
import type { Monaco } from "@monaco-editor/react"
import {
  Code2, Plus, Trash2, RefreshCcw, Save, ChevronRight, ChevronDown,
  Loader2, CheckCircle2, Wrench, FileCode, ArrowLeft,
  Search, Sparkles, Play, X, FileText, FileJson, File,
  AlertCircle, Upload,
} from "lucide-react"
import { AnimatePresence, motion } from "framer-motion"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  useTools, useToolFile, useSaveToolFile, useDeleteToolFile,
  useReloadTools, useRunTool, useGenerateTool, useModels,
} from "@/hooks/use-api"
import { uploadToolFile } from "@/lib/api"
import { toast } from "sonner"
import type { ToolFile } from "@/lib/api"

// ── Language helpers ───────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  py: "python", md: "markdown", json: "json",
  yaml: "yaml", yml: "yaml", toml: "toml",
  txt: "plaintext", sh: "shell", env: "plaintext",
  js: "javascript", ts: "typescript", tsx: "typescript",
  cfg: "ini", ini: "ini", css: "css", html: "html",
}

function getLang(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXT_LANG[ext] ?? "plaintext"
}

function FileIcon({ path, size = 10, className = "" }: { path: string; size?: number; className?: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "py") return <Code2 size={size} className={className} />
  if (ext === "json") return <FileJson size={size} className={className} />
  if (ext === "md") return <FileText size={size} className={className} />
  return <File size={size} className={className} />
}

// ── Monaco theme ───────────────────────────────────────────────────────────────

const THEME = "mollama"

function applyTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "525e6e", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "keyword.control", foreground: "e879f9" },
      { token: "string", foreground: "86efac" },
      { token: "string.escape", foreground: "fde68a" },
      { token: "number", foreground: "fbbf24" },
      { token: "regexp", foreground: "f97316" },
      { token: "type", foreground: "34d399" },
      { token: "class", foreground: "fbbf24", fontStyle: "bold" },
      { token: "function", foreground: "38bdf8" },
      { token: "variable", foreground: "cbd5e1" },
      { token: "parameter", foreground: "fb923c" },
      { token: "operator", foreground: "94a3b8" },
      { token: "delimiter", foreground: "64748b" },
      { token: "tag", foreground: "c084fc" },
    ],
    colors: {
      "editor.background": "#00000000",
      "editor.foreground": "#cbd5e1",
      "editor.lineHighlightBackground": "#0f0f1c",
      "editor.lineHighlightBorder": "#1e1e35",
      "editor.selectionBackground": "#7c3aed28",
      "editor.inactiveSelectionBackground": "#7c3aed12",
      "editor.findMatchBackground": "#fbbf2435",
      "editor.findMatchHighlightBackground": "#fbbf2418",
      "editorLineNumber.foreground": "#2a2a40",
      "editorLineNumber.activeForeground": "#525e6e",
      "editorCursor.foreground": "#c084fc",
      "editorCursor.background": "#080811",
      "editorIndentGuide.background1": "#13132a",
      "editorIndentGuide.activeBackground1": "#2a2a45",
      "editorWhitespace.foreground": "#1a1a2e",
      "editorBracketMatch.background": "#7c3aed22",
      "editorBracketMatch.border": "#7c3aed55",
      "editorWidget.background": "#0d0d1c",
      "editorWidget.border": "#1e1e35",
      "editorSuggestWidget.background": "#0d0d1c",
      "editorSuggestWidget.border": "#1e1e35",
      "editorSuggestWidget.selectedBackground": "#7c3aed22",
      "editorSuggestWidget.selectedForeground": "#e2e8f0",
      "editorHoverWidget.background": "#0d0d1c",
      "editorHoverWidget.border": "#1e1e35",
      "scrollbarSlider.background": "#1e1e3550",
      "scrollbarSlider.hoverBackground": "#2a2a5060",
      "scrollbarSlider.activeBackground": "#7c3aed40",
      "minimap.background": "#00000000",
      "stickyScroll.background": "#00000000",
    },
  })
}

const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  fontLigatures: true,
  lineHeight: 22,
  letterSpacing: 0.3,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: "on" as const,
  renderLineHighlight: "all" as const,
  bracketPairColorization: { enabled: true },
  formatOnPaste: true,
  tabSize: 4,
  insertSpaces: true,
  wordWrap: "on" as const,
  padding: { top: 14, bottom: 14 },
  cursorSmoothCaretAnimation: "on" as const,
  cursorBlinking: "smooth" as const,
  cursorWidth: 2,
  smoothScrolling: true,
  quickSuggestions: { other: true, comments: false, strings: true },
  suggestOnTriggerCharacters: true,
  wordBasedSuggestions: "currentDocument" as const,
  parameterHints: { enabled: true },
  autoClosingBrackets: "always" as const,
  autoClosingQuotes: "always" as const,
  autoIndent: "advanced" as const,
  renderWhitespace: "selection" as const,
  scrollbar: {
    verticalScrollbarSize: 5,
    horizontalScrollbarSize: 5,
    vertical: "auto" as const,
    horizontal: "auto" as const,
  },
  overviewRulerLanes: 0,
  hideCursorInOverviewRuler: true,
  overviewRulerBorder: false,
  guides: { indentation: true, bracketPairs: true },
}

// ── StatusBar ──────────────────────────────────────────────────────────────────

function StatusBar({ path, line, col, dirty, saved }: {
  path: string; line: number; col: number; dirty: boolean; saved: boolean
}) {
  const lang = getLang(path)
  return (
    <div className="flex items-center justify-between px-3 h-[22px] shrink-0 border-t border-border/40 bg-muted/10 select-none">
      <div className="flex items-center gap-3">
        <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-primary/40">{lang}</span>
        {dirty && (
          <span className="text-[8px] font-mono text-amber-400/50 flex items-center gap-1">
            <span className="w-[5px] h-[5px] rounded-full bg-amber-400/60 inline-block" />
            modified
          </span>
        )}
        {saved && !dirty && (
          <span className="text-[8px] font-mono text-emerald-400/50 flex items-center gap-1">
            <CheckCircle2 size={8} />
            saved
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 text-[8px] font-mono text-muted-foreground/20">
        <span>Ln {line}  Col {col}</span>
        <span>UTF-8</span>
        <span>4 spaces</span>
      </div>
    </div>
  )
}

// ── NewFileDialog ──────────────────────────────────────────────────────────────

const STARTER: Record<string, string> = {
  py: `"""
My new tool — describe what it does here.
"""

def my_function(param: str) -> str:
    """One-line description shown to the LLM."""
    return f"Result: {param}"
`,
  md: `# My Notes\n\nWrite context here.\n`,
  json: `{\n  \n}\n`,
}

function NewFileDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (path: string) => void
}) {
  const { mutateAsync: save, isPending } = useSaveToolFile()
  const [name, setName] = useState("")
  const [ext, setExt] = useState("py")
  const [error, setError] = useState("")

  const handleCreate = async () => {
    const clean = name.trim().replace(/\.[^.]+$/, "")
    if (!clean) { setError("Name required"); return }
    if (!/^[a-z0-9_/-]+$/i.test(clean)) { setError("Letters, digits, underscores only"); return }
    const path = `${clean}.${ext}`
    try {
      await save({ path, code: STARTER[ext] ?? "" })
      toast.success(`Created ${path}`)
      onCreated(path)
    } catch (e: any) {
      setError(e.message)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/70 backdrop-blur-xl z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
        onClick={e => e.stopPropagation()}
        className="w-72 rounded-2xl border border-white/[0.07] bg-[#0d0d1c]/95 backdrop-blur-2xl shadow-2xl shadow-black/60 p-5 space-y-4"
      >
        <div className="flex items-center gap-2">
          <FileCode size={13} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-[0.22em]">New File</span>
        </div>

        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-1 rounded-xl border border-border/25 bg-background/40 px-3 py-2">
              <input
                autoFocus
                className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground/25"
                placeholder="file_name"
                value={name}
                onChange={e => { setName(e.target.value); setError("") }}
                onKeyDown={e => e.key === "Enter" && handleCreate()}
              />
            </div>
            <select
              value={ext}
              onChange={e => setExt(e.target.value)}
              className="rounded-xl border border-border/25 bg-background/40 px-2 text-[10px] font-mono text-muted-foreground outline-none"
            >
              {["py", "md", "json", "txt", "yaml", "sh"].map(e => (
                <option key={e} value={e}>.{e}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-[9px] font-mono text-red-400/80">{error}</p>}
        </div>

        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 h-8 rounded-xl border border-white/[0.07] text-[9px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-white/[0.04] transition-colors">
            Cancel
          </button>
          <button
            onClick={handleCreate} disabled={isPending}
            className="flex-1 h-8 rounded-xl bg-primary text-[9px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
          >
            {isPending ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />}
            Create
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── AiGenerateDialog ───────────────────────────────────────────────────────────

function AiGenerateDialog({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (path: string) => void
}) {
  const { data: modelsData } = useModels()
  const { mutateAsync: generate, isPending: isGenerating } = useGenerateTool()
  const { mutateAsync: save, isPending: isSaving } = useSaveToolFile()
  const [description, setDescription] = useState("")
  const [fileName, setFileName] = useState("")
  const [model, setModel] = useState("")
  const [preview, setPreview] = useState("")
  const models = modelsData ?? []

  useEffect(() => {
    if (models.length && !model) setModel(models[0])
  }, [models])

  const handleGenerate = async () => {
    if (!description.trim()) return
    try {
      const res = await generate({ description, model })
      setPreview(res.code)
      if (!fileName) {
        const m = res.code.match(/^def (\w+)/m)
        if (m) setFileName(m[1])
      }
    } catch (e: any) {
      toast.error("Generation failed", { description: e.message })
    }
  }

  const handleSave = async () => {
    const clean = fileName.trim().replace(/\.py$/, "")
    if (!clean) { toast.error("Enter a file name"); return }
    const path = `${clean}.py`
    try {
      await save({ path, code: preview })
      toast.success(`Created ${path}`)
      onCreated(path)
    } catch (e: any) {
      toast.error("Save failed", { description: e.message })
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/70 backdrop-blur-xl z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
        onClick={e => e.stopPropagation()}
        className="w-[min(580px,calc(100vw-2rem))] rounded-2xl border border-white/[0.07] bg-[#0d0d1c]/98 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/[0.05] bg-primary/[0.06]">
          <div className="flex items-center gap-2">
            <Sparkles size={12} className="text-primary" />
            <span className="text-[10px] font-mono font-black uppercase tracking-[0.22em]">AI Tool Generator</span>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-white/[0.06] text-muted-foreground hover:text-foreground transition-colors">
            <X size={13} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/40">Describe what the tool should do</label>
            <textarea
              autoFocus rows={4}
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-[12px] font-mono outline-none resize-none placeholder:text-muted-foreground/20 focus:border-primary/30 focus:bg-white/[0.05] transition-all leading-relaxed"
              placeholder="e.g. fetch the current weather for a city and return temperature, humidity, and conditions in JSON format"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onKeyDown={e => e.key === "Enter" && e.metaKey && handleGenerate()}
            />
            <p className="text-[8px] font-mono text-muted-foreground/25">⌘ Enter to generate</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/50">Model</label>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="w-full flex items-center justify-between gap-2 rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[10px] font-mono text-muted-foreground outline-none hover:border-primary/30 hover:bg-white/[0.04] transition-colors data-[state=open]:border-primary/30 data-[state=open]:bg-white/[0.04]">
                    <span className="truncate text-left">{model || "Select model…"}</span>
                    <ChevronRight size={9} className="shrink-0 rotate-90 text-muted-foreground/30" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  sideOffset={4}
                  className="min-w-[180px] max-h-[220px] overflow-y-auto rounded-xl border border-white/[0.07] bg-[#0d0d1c]/98 backdrop-blur-2xl shadow-2xl shadow-black/50 p-1.5"
                >
                  <DropdownMenuRadioGroup value={model} onValueChange={setModel}>
                    {models.map(m => (
                      <DropdownMenuRadioItem
                        key={m} value={m}
                        className="rounded-lg pl-8 pr-2 py-1.5 text-[10px] font-mono cursor-pointer focus:bg-primary/10 focus:text-foreground data-[state=checked]:text-primary text-muted-foreground/60 transition-colors"
                      >
                        <span className="truncate">{m}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="space-y-1.5">
              <label className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground/50">File name</label>
              <div className="flex items-center gap-1 rounded-xl border border-border/25 bg-background/40 px-3 py-2">
                <input
                  className="flex-1 bg-transparent text-[11px] font-mono outline-none placeholder:text-muted-foreground/25"
                  placeholder="my_tool"
                  value={fileName} onChange={e => setFileName(e.target.value)}
                />
                <span className="text-[9px] font-mono text-muted-foreground/30">.py</span>
              </div>
            </div>
          </div>

          {preview && (
            <div className="rounded-xl border border-white/[0.06] overflow-hidden">
              <div className="px-3 py-1.5 bg-white/[0.03] border-b border-white/[0.04] flex items-center gap-2">
                <FileCode size={9} className="text-primary/50" />
                <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground/40">Preview</span>
              </div>
              <pre className="p-3 text-[10px] font-mono text-muted-foreground/60 overflow-auto max-h-44 bg-[#080811] leading-relaxed">{preview}</pre>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={onClose} className="flex-1 h-9 rounded-xl border border-white/[0.07] text-[9px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-white/[0.04] transition-colors">
              Cancel
            </button>
            {preview ? (
              <button onClick={handleSave} disabled={isSaving} className="flex-1 h-9 rounded-xl bg-primary text-[9px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                {isSaving ? <Loader2 size={10} className="animate-spin" /> : <Save size={10} />}
                Save File
              </button>
            ) : (
              <button onClick={handleGenerate} disabled={isGenerating || !description.trim()} className="flex-1 h-9 rounded-xl bg-primary text-[9px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                {isGenerating ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                {isGenerating ? "Generating…" : "Generate"}
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── ToolFileList ───────────────────────────────────────────────────────────────

export function ToolFileList({ selectedPath, onSelect }: {
  selectedPath: string | null
  onSelect: (path: string) => void
}) {
  const { data, isLoading, refetch } = useTools()
  const { mutateAsync: reload, isPending: isReloading } = useReloadTools()
  const [query, setQuery] = useState("")
  const [showNew, setShowNew] = useState(false)
  const [showAi, setShowAi] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const tools: ToolFile[] = data?.tools ?? []

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    try {
      const { path } = await uploadToolFile(file)
      toast.success(`Uploaded ${path}`)
      await refetch()
      onSelect(path)
    } catch (err: any) {
      toast.error("Upload failed", { description: err.message })
    } finally {
      setIsUploading(false)
      if (uploadRef.current) uploadRef.current.value = ""
    }
  }

  // Context files (e.g. CONTEXT.MD) referenced by tools but not in main list
  const contextPaths = [...new Set(
    tools.map(t => t.context_path).filter((p): p is string => !!p && !tools.some(t2 => t2.path === p))
  )]

  const filtered = query.trim()
    ? tools.filter(t => t.path.toLowerCase().includes(query.toLowerCase()))
    : tools

  const filteredCtx = query.trim()
    ? contextPaths.filter(p => p.toLowerCase().includes(query.toLowerCase()))
    : contextPaths

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
      {/* Header */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/40 bg-muted/10">
        <div className="flex items-center gap-1.5">
          <Wrench size={11} className="text-primary/60" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.2em]">Files</span>
          {data && (
            <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">
              {tools.length}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => setShowAi(true)} title="Generate with AI" className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/40 hover:text-primary transition-colors">
            <Sparkles size={11} />
          </button>
          <button onClick={() => uploadRef.current?.click()} disabled={isUploading} title="Upload file" className="p-1.5 rounded-lg hover:bg-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:opacity-30">
            {isUploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
          </button>
          <button onClick={handleReload} disabled={isReloading} title="Hot-reload" className="p-1.5 rounded-lg hover:bg-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:opacity-30">
            {isReloading ? <Loader2 size={11} className="animate-spin" /> : <RefreshCcw size={11} />}
          </button>
          <button onClick={() => setShowNew(true)} title="New file" className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors">
            <Plus size={11} />
          </button>
        </div>
        <input ref={uploadRef} type="file" className="hidden" onChange={handleUpload}
          accept=".py,.md,.txt,.json,.yaml,.yml,.toml,.sh,.env,.cfg,.ini" />
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 py-1.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 rounded-lg border border-border/25 bg-background/40 px-2 py-1">
          <Search size={9} className="text-muted-foreground/30 shrink-0" />
          <input
            className="flex-1 bg-transparent text-[10px] font-mono outline-none placeholder:text-muted-foreground/25"
            placeholder="filter files…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-muted-foreground/30 hover:text-muted-foreground transition-colors">
              <X size={8} />
            </button>
          )}
        </div>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
        {isLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 size={13} className="animate-spin text-muted-foreground/25" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            {query ? (
              <>
                <Search size={18} className="text-muted-foreground/15" />
                <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No files match "{query}"</p>
              </>
            ) : (
              <>
                <Code2 size={20} className="text-muted-foreground/15" />
                <p className="text-[9px] font-mono text-muted-foreground/25">No files yet</p>
                <button onClick={() => setShowNew(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">
                  + Create first file
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            {filteredCtx.map(ctxPath => {
              const isSelected = selectedPath === ctxPath
              return (
                <button
                  key={ctxPath}
                  onClick={() => onSelect(ctxPath)}
                  className={[
                    "w-full text-left rounded-lg px-2.5 py-2 transition-all group",
                    isSelected
                      ? "bg-amber-500/10 border border-amber-500/20"
                      : "hover:bg-secondary/40 border border-transparent",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText size={10} className={isSelected ? "text-amber-400/80" : "text-amber-500/30"} />
                    <span className={[
                      "text-[10px] font-mono truncate flex-1",
                      isSelected ? "text-foreground" : "text-muted-foreground/50",
                    ].join(" ")}>
                      {ctxPath}
                    </span>
                    <span className="text-[7px] font-mono uppercase tracking-widest text-amber-500/30 shrink-0">ctx</span>
                  </div>
                </button>
              )
            })}
            {filtered.map(tool => {
              const isSelected = selectedPath === tool.path
              return (
                <button
                  key={tool.path}
                  onClick={() => onSelect(tool.path)}
                  className={[
                    "w-full text-left rounded-lg px-2.5 py-2 transition-all group",
                    isSelected
                        ? "bg-primary/10 border border-primary/25"
                        : "hover:bg-secondary/40 border border-transparent",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-1.5">
                    <FileIcon
                      path={tool.path} size={10}
                      className={isSelected ? "text-primary/80" : "text-muted-foreground/30"}
                    />
                    <span className={[
                      "text-[10px] font-mono truncate flex-1",
                      isSelected ? "text-foreground" : "text-muted-foreground/60",
                    ].join(" ")}>
                      {tool.path}
                    </span>
                    {tool.functions.length > 0 && (
                      <span className="text-[7.5px] font-mono text-muted-foreground/25 shrink-0 tabular-nums">
                        {tool.functions.length}fn
                      </span>
                    )}
                  </div>
                  {isSelected && tool.functions.length > 0 && (
                    <div className="mt-1 pl-4 space-y-px">
                      {tool.functions.slice(0, 4).map(fn => (
                        <div key={fn} className="text-[8px] font-mono text-muted-foreground/30 truncate flex items-center gap-1">
                          <ChevronRight size={6} />
                          {fn}()
                        </div>
                      ))}
                      {tool.functions.length > 4 && (
                        <div className="text-[7.5px] font-mono text-muted-foreground/20">
                          +{tool.functions.length - 4} more
                        </div>
                      )}
                    </div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <AnimatePresence>
        {showNew && <NewFileDialog onClose={() => setShowNew(false)} onCreated={path => { setShowNew(false); onSelect(path) }} />}
        {showAi && <AiGenerateDialog onClose={() => setShowAi(false)} onCreated={path => { setShowAi(false); onSelect(path) }} />}
      </AnimatePresence>
    </div>
  )
}

// ── ToolEditorPane ─────────────────────────────────────────────────────────────

export function ToolEditorPane({ selectedPath, onClose }: {
  selectedPath: string
  onClose: () => void
}) {
  const { data } = useTools()
  const { mutateAsync: save, isPending: isSaving } = useSaveToolFile()
  const { mutateAsync: del, isPending: isDeleting } = useDeleteToolFile()
  const { mutateAsync: runTool, isPending: isRunning } = useRunTool()
  const { data: fileCode, isLoading: isFileLoading } = useToolFile(selectedPath)

  const [editorCode, setEditorCode] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const [runOpen, setRunOpen] = useState(false)
  const [runFn, setRunFn] = useState("")
  const [argValues, setArgValues] = useState<Record<string, string>>({})
  const [runResult, setRunResult] = useState<{ ok: boolean; result?: string; error?: string } | null>(null)

  const lastLoadedRef = useRef<string | null>(null)
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const editorRef = useRef<any>(null)

  useEffect(() => {
    if (fileCode !== undefined && lastLoadedRef.current !== selectedPath) {
      lastLoadedRef.current = selectedPath
      setEditorCode(fileCode)
      setDirty(false)
      setSaved(false)
      setRunResult(null)
    }
  }, [fileCode, selectedPath])

  const tools: ToolFile[] = data?.tools ?? []
  const currentTool = tools.find(t => t.path === selectedPath)
  const functions = currentTool?.functions ?? []

  useEffect(() => {
    if (functions.length && !runFn) setRunFn(functions[0])
  }, [functions])

  // Reset args when selected function changes
  useEffect(() => {
    setArgValues({})
    setRunResult(null)
  }, [runFn])

  // Resolve parameter schema for the currently selected function
  const schemas: any[] = (data as any)?.schemas ?? []
  const currentFnSchema = schemas.find(s => s.function?.name === runFn)
  const paramProps: Record<string, { type: string; description?: string }> =
    currentFnSchema?.function?.parameters?.properties ?? {}
  const paramRequired: string[] = currentFnSchema?.function?.parameters?.required ?? []

  const handleEditorChange = useCallback((value: string | undefined) => {
    setEditorCode(value ?? "")
    setDirty(true)
    setSaved(false)
  }, [])

  const handleSave = useCallback(async () => {
    try {
      await save({ path: selectedPath, code: editorCode })
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      toast.success("Saved")
    } catch (e: any) {
      toast.error("Save failed", { description: e.message })
    }
  }, [selectedPath, editorCode, save])

  useEffect(() => { saveRef.current = handleSave }, [handleSave])

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

  const handleRun = async () => {
    try {
      const args: Record<string, any> = {}
      for (const [k, v] of Object.entries(argValues)) {
        const schema = paramProps[k]
        if (schema?.type === "integer") args[k] = parseInt(v) || 0
        else if (schema?.type === "number") args[k] = parseFloat(v) || 0
        else if (schema?.type === "boolean") args[k] = v === "true"
        else args[k] = v
      }
      const result = await runTool({ tool: runFn, args })
      setRunResult(result)
    } catch (e: any) {
      setRunResult({ ok: false, error: e.message })
    }
  }

  const handleBeforeMount = useCallback((monaco: Monaco) => {
    applyTheme(monaco)
  }, [])

  const handleMount = useCallback((editor: any, monaco: Monaco) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e: any) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
    })
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      saveRef.current()
    })
  }, [])

  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
        <button
          onClick={handleClose}
          className="p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/40 hover:text-foreground transition-colors shrink-0"
          title="Back (← closes editor)"
        >
          <ArrowLeft size={13} />
        </button>

        <div className="w-px h-4 bg-white/[0.06] shrink-0" />

        <FileIcon path={selectedPath} size={11} className="text-primary/60 shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate flex-1 min-w-0">
          {selectedPath}
        </span>

        {dirty && (
          <span className="text-[8px] font-mono text-amber-400/60 uppercase shrink-0">●</span>
        )}

        <div className="flex items-center gap-0.5 shrink-0">
          {functions.length > 0 && (
            <button
              onClick={() => { setRunOpen(o => !o); setRunResult(null) }}
              title="Test runner"
              className={[
                "p-1.5 rounded-lg transition-colors",
                runOpen
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "hover:bg-white/[0.05] text-muted-foreground/35 hover:text-muted-foreground",
              ].join(" ")}
            >
              <Play size={11} />
            </button>
          )}
          <button
            onClick={handleDelete} disabled={isDeleting}
            className="p-1.5 rounded-lg hover:bg-red-500/12 text-muted-foreground/30 hover:text-red-400 transition-colors"
            title="Delete file"
          >
            {isDeleting ? <Loader2 size={11} className="animate-spin" /> : <Trash2 size={11} />}
          </button>
          <button
            onClick={handleSave} disabled={isSaving || !dirty}
            className={[
              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
              saved
                ? "bg-emerald-500/12 text-emerald-400 border border-emerald-500/20"
                : dirty
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "border border-white/[0.06] text-muted-foreground/25 cursor-default",
            ].join(" ")}
          >
            {isSaving ? <Loader2 size={9} className="animate-spin" /> : saved ? <CheckCircle2 size={9} /> : <Save size={9} />}
            {isSaving ? "Saving" : saved ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {/* Monaco */}
      <div className="flex-1 overflow-hidden min-h-0">
        {isFileLoading ? (
          <div className="flex items-center justify-center h-full bg-[#080811]">
            <Loader2 size={16} className="animate-spin text-muted-foreground/25" />
          </div>
        ) : (
          <Editor
            height="100%"
            language={getLang(selectedPath)}
            theme={THEME}
            value={editorCode}
            onChange={handleEditorChange}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
            options={EDITOR_OPTIONS}
          />
        )}
      </div>

      {/* Run panel */}
      <AnimatePresence>
        {runOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="shrink-0 border-t border-border/40 bg-background/50 overflow-hidden"
          >
            <div className="p-3 space-y-2.5">
              {/* Function selector + Run button */}
              <div className="flex items-center gap-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="flex-1 flex items-center justify-between gap-2 rounded-lg border border-border/25 bg-background/40 px-3 py-1.5 text-[10px] font-mono text-muted-foreground/70 outline-none hover:border-primary/20 data-[state=open]:border-primary/20 transition-colors min-w-0">
                      <span className="font-bold truncate">{runFn || "select…"}()</span>
                      <ChevronDown size={9} className="text-muted-foreground/30 shrink-0" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start" sideOffset={4}
                    className="min-w-[180px] rounded-xl border border-white/[0.07] bg-[#0d0d1c]/98 backdrop-blur-2xl shadow-2xl shadow-black/50 p-1.5"
                  >
                    <DropdownMenuRadioGroup value={runFn} onValueChange={v => setRunFn(v)}>
                      {functions.map(fn => (
                        <DropdownMenuRadioItem
                          key={fn} value={fn}
                          className="rounded-lg pl-8 pr-2 py-1.5 text-[10px] font-mono cursor-pointer focus:bg-primary/10 focus:text-foreground data-[state=checked]:text-primary text-muted-foreground/60 transition-colors"
                        >
                          {fn}()
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <button
                  onClick={handleRun} disabled={isRunning}
                  className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/22 text-[9px] font-mono font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                >
                  {isRunning ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
                  Run
                </button>
              </div>

              {/* Per-parameter fields */}
              {Object.keys(paramProps).length > 0 ? (
                <div className="rounded-lg border border-border/20 bg-black/15 p-2 space-y-1.5">
                  {Object.entries(paramProps).map(([name, schema]) => {
                    const isRequired = paramRequired.includes(name)
                    const val = argValues[name] ?? ""
                    return (
                      <div key={name} className="flex items-center gap-2">
                        <div className="shrink-0 w-24">
                          <span className="text-[9px] font-mono text-muted-foreground/60 block truncate">
                            {name}{isRequired && <span className="text-red-400/50 ml-0.5">*</span>}
                          </span>
                          <span className="text-[7.5px] font-mono text-muted-foreground/25">{schema.type}</span>
                        </div>
                        {schema.type === "boolean" ? (
                          <button
                            onClick={() => { setArgValues(p => ({ ...p, [name]: val === "true" ? "false" : "true" })); setRunResult(null) }}
                            className={[
                              "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-mono transition-colors",
                              val === "true"
                                ? "bg-primary/15 text-primary border border-primary/25"
                                : "bg-background/40 border border-border/25 text-muted-foreground/40 hover:border-border/40",
                            ].join(" ")}
                          >
                            <div className={[
                              "w-2.5 h-2.5 rounded-full border transition-colors shrink-0",
                              val === "true" ? "bg-primary border-primary" : "border-border/50 bg-transparent",
                            ].join(" ")} />
                            {val === "true" ? "true" : "false"}
                          </button>
                        ) : (
                          <input
                            type={schema.type === "integer" || schema.type === "number" ? "number" : "text"}
                            placeholder={`${name}…`}
                            value={val}
                            onChange={e => { setArgValues(p => ({ ...p, [name]: e.target.value })); setRunResult(null) }}
                            className="flex-1 rounded-lg border border-border/25 bg-background/40 px-2 py-1 text-[10px] font-mono text-muted-foreground/70 outline-none placeholder:text-muted-foreground/20 focus:border-primary/20 transition-colors"
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : runFn ? (
                <p className="text-[9px] font-mono text-muted-foreground/25 px-1">No parameters — click Run</p>
              ) : null}

              {/* Result */}
              <AnimatePresence>
                {runResult && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                    className={[
                      "rounded-lg px-3 py-2 text-[10px] font-mono flex items-start gap-2",
                      runResult.ok
                        ? "bg-emerald-500/8 border border-emerald-500/15 text-emerald-300/80"
                        : "bg-red-500/8 border border-red-500/15 text-red-400/80",
                    ].join(" ")}
                  >
                    {runResult.ok
                      ? <CheckCircle2 size={10} className="shrink-0 mt-px" />
                      : <AlertCircle size={10} className="shrink-0 mt-px" />
                    }
                    <span className="break-all whitespace-pre-wrap">{runResult.ok ? runResult.result : runResult.error}</span>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Status bar */}
      <StatusBar path={selectedPath} line={cursorPos.line} col={cursorPos.col} dirty={dirty} saved={saved} />
    </div>
  )
}
