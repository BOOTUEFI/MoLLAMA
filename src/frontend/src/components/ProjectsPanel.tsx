import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react"
import Editor from "@monaco-editor/react"
import type { Monaco } from "@monaco-editor/react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FolderOpen, Plus, Trash2, Save, Loader2, CheckCircle2,
  MessageSquare, Brain, Send, X, BookOpen, ChevronRight,
  Zap, Sparkles, Copy, Check, Square, ArrowLeft, Upload,
  File, FileCode, FileText, FileJson, FolderPlus, Folder,
  Code2, Search, RefreshCcw, ChevronDown, Edit2,
} from "lucide-react"
import { toast } from "sonner"
import {
  fetchProjects, saveProject, deleteProject, sendAgenticMessage,
  fetchProjectFiles, readProjectFile, writeProjectFile, deleteProjectFile,
  mkdirProject, uploadProjectFile,
  type Project, type ChatMessage, type ProjectFileEntry,
} from "@/lib/api"

function uuid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2)
}

// ── Monaco theme (same as ToolsEditor) ────────────────────────────────────────

const THEME = "mollama-proj"

function applyTheme(monaco: Monaco) {
  monaco.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "525e6e", fontStyle: "italic" },
      { token: "keyword", foreground: "c084fc" },
      { token: "keyword.control", foreground: "e879f9" },
      { token: "string", foreground: "86efac" },
      { token: "number", foreground: "fbbf24" },
      { token: "type", foreground: "34d399" },
      { token: "function", foreground: "38bdf8" },
      { token: "variable", foreground: "cbd5e1" },
      { token: "operator", foreground: "94a3b8" },
    ],
    colors: {
      "editor.background": "#00000000",
      "editor.foreground": "#cbd5e1",
      "editor.lineHighlightBackground": "#0f0f1c",
      "editor.lineHighlightBorder": "#1e1e35",
      "editor.selectionBackground": "#7c3aed28",
      "editorLineNumber.foreground": "#2a2a40",
      "editorLineNumber.activeForeground": "#525e6e",
      "editorCursor.foreground": "#c084fc",
      "editorWidget.background": "#0d0d1c",
      "editorWidget.border": "#1e1e35",
      "scrollbarSlider.background": "#1e1e3550",
      "scrollbarSlider.hoverBackground": "#2a2a5060",
      "minimap.background": "#00000000",
    },
  })
}

const EDITOR_OPTIONS = {
  fontSize: 13,
  fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
  fontLigatures: true,
  lineHeight: 22,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: "on" as const,
  renderLineHighlight: "all" as const,
  bracketPairColorization: { enabled: true },
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "on" as const,
  padding: { top: 14, bottom: 14 },
  cursorSmoothCaretAnimation: "on" as const,
  cursorBlinking: "smooth" as const,
  smoothScrolling: true,
  scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5, vertical: "auto" as const, horizontal: "auto" as const },
  overviewRulerLanes: 0,
}

// ── Language helpers ───────────────────────────────────────────────────────────

const EXT_LANG: Record<string, string> = {
  py: "python", md: "markdown", json: "json", yaml: "yaml", yml: "yaml",
  toml: "toml", txt: "plaintext", sh: "shell", js: "javascript",
  ts: "typescript", tsx: "typescript", jsx: "javascript", css: "css",
  html: "html", env: "plaintext", cfg: "ini", ini: "ini",
  rs: "rust", go: "go", rb: "ruby", php: "php",
}

function getLang(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  return EXT_LANG[ext] ?? "plaintext"
}

function ProjFileIcon({ path, size = 10, className = "" }: { path: string; size?: number; className?: string }) {
  const ext = path.split(".").pop()?.toLowerCase() ?? ""
  if (ext === "py") return <Code2 size={size} className={className} />
  if (ext === "json") return <FileJson size={size} className={className} />
  if (["md", "txt"].includes(ext)) return <FileText size={size} className={className} />
  if (["ts", "tsx", "js", "jsx"].includes(ext)) return <FileCode size={size} className={className} />
  return <File size={size} className={className} />
}

// ── Markdown renderer ──────────────────────────────────────────────────────────

function CopyBtn({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono text-muted-foreground/40 hover:text-foreground hover:bg-white/[0.08] transition-colors"
    >
      {copied ? <Check size={9} className="text-emerald-400" /> : <Copy size={9} />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function renderMd(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const blockRe = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0; let m: RegExpExecArray | null; let idx = 0
  while ((m = blockRe.exec(text)) !== null) {
    if (m.index > last) {
      const slice = text.slice(last, m.index)
      nodes.push(
        <div key={idx++} className="text-[11px] leading-relaxed whitespace-pre-wrap break-words space-y-0.5">
          {slice.split("\n").map((line, li) => {
            if (line.startsWith("### ")) return <p key={li} className="text-[11px] font-bold text-foreground/90 mt-2">{line.slice(4)}</p>
            if (line.startsWith("## ")) return <p key={li} className="text-[12px] font-bold text-foreground/90 mt-2">{line.slice(3)}</p>
            if (line.startsWith("# ")) return <p key={li} className="text-[13px] font-bold text-foreground/90 mt-2">{line.slice(2)}</p>
            if (line.startsWith("- ") || line.startsWith("* ")) return <p key={li} className="pl-2 before:content-['•'] before:mr-1.5 before:text-muted-foreground/40">{line.slice(2)}</p>
            return <p key={li}>{line}</p>
          })}
        </div>
      )
    }
    nodes.push(
      <div key={idx++} className="my-2 rounded-lg overflow-hidden border border-border/30 bg-black/30">
        <div className="flex items-center justify-between px-3 py-1 border-b border-border/20 bg-black/20">
          {m[1] ? <span className="text-[9px] font-mono text-muted-foreground/40 uppercase">{m[1]}</span> : <span />}
          <CopyBtn code={m[2]} />
        </div>
        <pre className="p-3 text-[11px] font-mono text-foreground/80 overflow-x-auto leading-relaxed whitespace-pre">{m[2]}</pre>
      </div>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) {
    const remaining = text.slice(last)
    nodes.push(
      <div key={idx++} className="text-[11px] leading-relaxed whitespace-pre-wrap break-words">
        {remaining.split("\n").map((line, li) => {
          if (line.startsWith("### ")) return <p key={li} className="text-[11px] font-bold text-foreground/90 mt-1">{line.slice(4)}</p>
          if (line.startsWith("## ")) return <p key={li} className="text-[12px] font-bold text-foreground/90 mt-2">{line.slice(3)}</p>
          if (line.startsWith("# ")) return <p key={li} className="text-[13px] font-bold text-foreground/90 mt-2">{line.slice(2)}</p>
          if (line.startsWith("- ") || line.startsWith("* ")) return <p key={li} className="pl-2 before:content-['•'] before:mr-1.5 before:text-muted-foreground/40">{line.slice(2)}</p>
          return <p key={li}>{line}</p>
        })}
      </div>
    )
  }
  return nodes
}

// ── FileTree ───────────────────────────────────────────────────────────────────

function FileTreeNode({
  entry, depth, selectedPath, onSelect, onDelete,
}: {
  entry: ProjectFileEntry
  depth: number
  selectedPath: string | null
  onSelect: (path: string) => void
  onDelete: (path: string, isDir: boolean) => void
}) {
  const [open, setOpen] = useState(depth === 0 || entry.type === "dir")
  const isDir = entry.type === "dir"
  const isSelected = !isDir && selectedPath === entry.path
  const name = entry.path.split("/").pop() ?? entry.path

  if (isDir) {
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="w-full flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-secondary/30 transition-colors group"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
        >
          {open ? <ChevronDown size={9} className="text-muted-foreground/40 shrink-0" /> : <ChevronRight size={9} className="text-muted-foreground/40 shrink-0" />}
          {open ? <FolderOpen size={10} className="text-amber-400/60 shrink-0" /> : <Folder size={10} className="text-amber-400/40 shrink-0" />}
          <span className="text-[10px] font-mono text-muted-foreground/70 truncate flex-1 text-left">{name}</span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(entry.path, true) }}
            className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/20 hover:text-red-400 transition-all shrink-0"
          >
            <Trash2 size={8} />
          </button>
        </button>
        <AnimatePresence>
          {open && entry.children && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
              {entry.children.map(child => (
                <FileTreeNode key={child.path} entry={child} depth={depth + 1} selectedPath={selectedPath} onSelect={onSelect} onDelete={onDelete} />
              ))}
              {entry.children.length === 0 && (
                <p className="text-[8.5px] font-mono text-muted-foreground/20 py-1" style={{ paddingLeft: `${20 + (depth + 1) * 12}px` }}>empty</p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <button
      onClick={() => onSelect(entry.path)}
      className={[
        "w-full flex items-center gap-1.5 px-2 py-1.5 rounded-lg transition-all group border",
        isSelected ? "bg-primary/10 border-primary/25" : "hover:bg-secondary/40 border-transparent",
      ].join(" ")}
      style={{ paddingLeft: `${8 + depth * 12}px` }}
    >
      <ProjFileIcon path={entry.path} size={10} className={isSelected ? "text-primary/80 shrink-0" : "text-muted-foreground/30 shrink-0"} />
      <span className={["text-[10px] font-mono truncate flex-1 text-left", isSelected ? "text-foreground" : "text-muted-foreground/60"].join(" ")}>
        {name}
      </span>
      <button
        onClick={e => { e.stopPropagation(); onDelete(entry.path, false) }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/20 hover:text-red-400 transition-all shrink-0"
      >
        <Trash2 size={8} />
      </button>
    </button>
  )
}

// ── ProjectFileExplorer ────────────────────────────────────────────────────────

function ProjectFileExplorer({
  project, selectedPath, onSelect, onRefresh,
}: {
  project: Project
  selectedPath: string | null
  onSelect: (path: string | null) => void
  onRefresh: () => void
}) {
  const [files, setFiles] = useState<ProjectFileEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showMkdir, setShowMkdir] = useState(false)
  const [newName, setNewName] = useState("")
  const [query, setQuery] = useState("")
  const uploadRef = useRef<HTMLInputElement>(null)
  const [isUploading, setIsUploading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const f = await fetchProjectFiles(project.id)
      setFiles(f)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [project.id])

  useEffect(() => { load() }, [load])

  const handleDelete = async (path: string, isDir: boolean) => {
    if (!window.confirm(`Delete ${isDir ? "folder" : "file"} "${path}"?`)) return
    try {
      await deleteProjectFile(project.id, path)
      if (selectedPath === path) onSelect(null)
      await load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleCreateFile = async () => {
    const n = newName.trim()
    if (!n) return
    try {
      await writeProjectFile(project.id, n, "")
      setShowNew(false); setNewName("")
      await load()
      onSelect(n)
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleMkdir = async () => {
    const n = newName.trim()
    if (!n) return
    try {
      await mkdirProject(project.id, n)
      setShowMkdir(false); setNewName("")
      await load()
    } catch (e: any) {
      toast.error(e.message)
    }
  }

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploading(true)
    try {
      const { path } = await uploadProjectFile(project.id, file)
      await load()
      onSelect(path)
      toast.success(`Uploaded ${path}`)
    } catch (err: any) {
      toast.error("Upload failed", { description: err.message })
    } finally {
      setIsUploading(false)
      if (uploadRef.current) uploadRef.current.value = ""
    }
  }

  // Flatten for search
  function flattenFiles(entries: ProjectFileEntry[]): ProjectFileEntry[] {
    const result: ProjectFileEntry[] = []
    for (const e of entries) {
      if (e.type === "file") result.push(e)
      if (e.children) result.push(...flattenFiles(e.children))
    }
    return result
  }

  const allFiles = query.trim() ? flattenFiles(files).filter(f => f.path.toLowerCase().includes(query.toLowerCase())) : null

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/30 bg-muted/5">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={10} className="text-amber-400/60" />
          <span className="text-[9px] font-mono font-black uppercase tracking-widest text-foreground/70">{project.name}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => uploadRef.current?.click()} disabled={isUploading} title="Upload" className="p-1.5 rounded-lg hover:bg-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors disabled:opacity-30">
            {isUploading ? <Loader2 size={10} className="animate-spin" /> : <Upload size={10} />}
          </button>
          <button onClick={() => { setShowMkdir(true); setNewName("") }} title="New folder" className="p-1.5 rounded-lg hover:bg-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <FolderPlus size={10} />
          </button>
          <button onClick={() => { setShowNew(true); setNewName("") }} title="New file" className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors">
            <Plus size={10} />
          </button>
          <button onClick={load} title="Refresh" className="p-1.5 rounded-lg hover:bg-white/[0.05] text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <RefreshCcw size={10} />
          </button>
        </div>
        <input ref={uploadRef} type="file" className="hidden" onChange={handleUpload} />
      </div>

      {/* Search */}
      <div className="shrink-0 px-2 py-1.5 border-b border-white/[0.04]">
        <div className="flex items-center gap-1.5 rounded-lg border border-border/25 bg-background/40 px-2 py-1">
          <Search size={9} className="text-muted-foreground/30 shrink-0" />
          <input className="flex-1 bg-transparent text-[10px] font-mono outline-none placeholder:text-muted-foreground/25" placeholder="filter files…" value={query} onChange={e => setQuery(e.target.value)} />
          {query && <button onClick={() => setQuery("")} className="text-muted-foreground/30 hover:text-muted-foreground"><X size={8} /></button>}
        </div>
      </div>

      {/* Inline new file/folder input */}
      <AnimatePresence>
        {(showNew || showMkdir) && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden shrink-0 border-b border-border/20">
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-primary/5">
              {showMkdir ? <Folder size={9} className="text-amber-400/60 shrink-0" /> : <File size={9} className="text-primary/60 shrink-0" />}
              <input
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") showMkdir ? handleMkdir() : handleCreateFile(); if (e.key === "Escape") { setShowNew(false); setShowMkdir(false) } }}
                placeholder={showMkdir ? "folder/name" : "file.ts"}
                className="flex-1 bg-transparent text-[10px] font-mono outline-none placeholder:text-muted-foreground/20"
              />
              <button onClick={showMkdir ? handleMkdir : handleCreateFile} disabled={!newName.trim()} className="text-primary/60 hover:text-primary disabled:opacity-30 transition-colors"><Check size={10} /></button>
              <button onClick={() => { setShowNew(false); setShowMkdir(false) }} className="text-muted-foreground/30 hover:text-muted-foreground/60 transition-colors"><X size={10} /></button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* File tree */}
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
        {loading ? (
          <div className="flex items-center justify-center py-8"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
        ) : allFiles !== null ? (
          <div className="p-1.5 space-y-0.5">
            {allFiles.length === 0 ? (
              <p className="text-[9px] font-mono text-muted-foreground/25 text-center py-4">No files match</p>
            ) : allFiles.map(f => (
              <FileTreeNode key={f.path} entry={f} depth={0} selectedPath={selectedPath} onSelect={onSelect} onDelete={handleDelete} />
            ))}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <FolderOpen size={20} className="text-muted-foreground/15" />
            <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No files yet</p>
            <button onClick={() => setShowNew(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">+ Create first file</button>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {files.map(f => (
              <FileTreeNode key={f.path} entry={f} depth={0} selectedPath={selectedPath} onSelect={onSelect} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ProjectAgent chat ──────────────────────────────────────────────────────────

interface AgentMsg { role: "user" | "assistant"; content: string; streaming?: boolean }

function ProjectAgent({ project, selectedFile, fileCode }: {
  project: Project
  selectedFile: string | null
  fileCode: string
}) {
  const [msgs, setMsgs] = useState<AgentMsg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 100) + "px"
  }, [input])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput("")
    const userMsg: AgentMsg = { role: "user", content: text }
    const newMsgs = [...msgs, userMsg]
    setMsgs(newMsgs)
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const knowledge = project.knowledge ?? []
    const fileCtx = selectedFile && fileCode
      ? `\n\nCurrently editing: ${selectedFile}\nFile contents:\n\`\`\`\n${fileCode.slice(0, 6000)}\n\`\`\``
      : ""

    const history: ChatMessage[] = [
      {
        role: "system",
        content: `You are a coding assistant for project "${project.name}".${project.description ? ` Project: ${project.description}` : ""}${knowledge.length ? `\n\nKnowledge:\n${knowledge.join("\n")}` : ""}${fileCtx}`,
      },
      ...newMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ]
    setMsgs(p => [...p, { role: "assistant", content: "", streaming: true }])
    try {
      let acc = ""
      for await (const ev of sendAgenticMessage(history, "mollama", ctrl.signal)) {
        if (ev.type === "delta") {
          acc += ev.text
          setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, content: acc } : m))
        } else if (ev.type === "done") {
          setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, content: ev.text || acc, streaming: false } : m))
          break
        } else if (ev.type === "error") {
          toast.error(ev.error)
          setMsgs(p => p.filter(m => !m.streaming))
          break
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") toast.error(e.message)
      setMsgs(p => p.filter(m => !m.streaming))
    } finally {
      setBusy(false); abortRef.current = null
    }
  }, [input, msgs, busy, project, selectedFile, fileCode])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/25">
            <MessageSquare size={20} strokeWidth={1} />
            <p className="text-[9px] font-mono">Ask about this project…</p>
            {selectedFile && <p className="text-[8px] font-mono text-muted-foreground/20">Context: {selectedFile}</p>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={["flex gap-2", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
            <div className={[
              "max-w-[90%] px-3 py-2 rounded-xl text-[10px] font-mono leading-relaxed break-words",
              m.role === "user"
                ? "bg-primary/15 text-foreground/80 border border-primary/15"
                : "bg-muted/20 text-foreground/70 border border-border/15",
            ].join(" ")}>
              {m.role === "assistant" ? (
                <div className="space-y-1">
                  {renderMd(m.content)}
                  {m.streaming && <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }} className="inline-block w-[5px] h-[11px] bg-primary/40 ml-0.5 align-middle" />}
                </div>
              ) : <p className="whitespace-pre-wrap">{m.content}</p>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 border-t border-border/30 px-3 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Ask the agent… (Shift+Enter for newline)"
          disabled={busy}
          rows={1}
          className="flex-1 bg-transparent text-[10px] font-mono placeholder:text-muted-foreground/20 outline-none disabled:opacity-50 resize-none overflow-hidden leading-relaxed min-h-8 pt-1.5"
        />
        {busy ? (
          <button onClick={() => abortRef.current?.abort()} className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors shrink-0"><Square size={11} /></button>
        ) : (
          <button onClick={send} disabled={!input.trim()} className="p-1.5 text-primary/60 hover:text-primary disabled:opacity-30 transition-colors shrink-0"><Send size={11} /></button>
        )}
      </div>
    </div>
  )
}

// ── KnowledgeVault ────────────────────────────────────────────────────────────

function KnowledgeVault({ entries, onAdd, onRemove }: {
  entries: string[]
  onAdd: (entry: string) => void
  onRemove: (i: number) => void
}) {
  const [input, setInput] = useState("")
  const submit = () => {
    const t = input.trim()
    if (!t) return
    onAdd(t); setInput("")
  }
  return (
    <div className="border border-border/40 bg-card/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 bg-muted/10">
        <BookOpen size={10} className="text-primary/60" />
        <span className="text-[9px] font-mono font-black uppercase tracking-widest">Knowledge Vault</span>
        <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">{entries.length}</span>
      </div>
      <div className="max-h-36 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {entries.length === 0 ? (
          <p className="text-[9px] font-mono text-muted-foreground/25 text-center py-4">No knowledge entries yet</p>
        ) : (
          <ul className="py-1 divide-y divide-border/10">
            {entries.map((e, i) => (
              <li key={i} className="flex items-start gap-2 px-3 py-1.5 group">
                <span className="text-[9px] font-mono text-muted-foreground/60 flex-1 leading-relaxed">{e}</span>
                <button onClick={() => onRemove(i)} className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/30 hover:text-red-400 transition-all"><X size={9} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex gap-1.5 px-2 py-1.5 border-t border-border/20">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Add knowledge entry…"
          className="flex-1 bg-transparent text-[9px] font-mono placeholder:text-muted-foreground/20 outline-none text-foreground/70" />
        <button onClick={submit} disabled={!input.trim()} className="text-primary/50 hover:text-primary disabled:opacity-30 transition-colors"><Plus size={10} /></button>
      </div>
    </div>
  )
}

// ── ProjectChat (overview when no file selected) ───────────────────────────────

interface ChatMsg { role: "user" | "assistant"; content: string; streaming?: boolean }

function ProjectChat({ project, onUpdateProject }: {
  project: Project
  onUpdateProject: (p: Partial<Project>) => void
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>(() =>
    (project.messages ?? []).filter(m => m.role === "user" || m.role === "assistant") as ChatMsg[]
  )
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [showBriefing, setShowBriefing] = useState(false)
  const [briefing, setBriefing] = useState("")
  const abortRef = useRef<AbortController | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setMsgs((project.messages ?? []).filter(m => m.role === "user" || m.role === "assistant") as ChatMsg[])
  }, [project.id])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }) }, [msgs])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 100) + "px"
  }, [input])

  const generateBriefing = useCallback(async () => {
    if (msgs.length === 0) { toast.info("No history yet"); return }
    setBusy(true); setBriefing(""); setShowBriefing(true)
    const knowledge = project.knowledge ?? []
    const history: ChatMessage[] = [
      { role: "system", content: `You are a project assistant for "${project.name}". ${project.description ?? ""}\n${knowledge.length ? `Knowledge:\n${knowledge.join("\n")}` : ""}` },
      ...msgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
      { role: "user", content: "Give me a brief 'Previously on this project' summary — key decisions, current status, what to focus on next. Under 150 words." },
    ]
    try {
      let acc = ""
      for await (const ev of sendAgenticMessage(history, "mollama")) {
        if (ev.type === "delta") { acc += ev.text; setBriefing(acc) }
        else if (ev.type === "done") { setBriefing(ev.text || acc); break }
        else if (ev.type === "error") { toast.error(ev.error); break }
      }
    } catch (e: any) { if (e.name !== "AbortError") toast.error(e.message) }
    finally { setBusy(false) }
  }, [msgs, project])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput("")
    const userMsg: ChatMsg = { role: "user", content: text }
    const newMsgs = [...msgs, userMsg]
    setMsgs(newMsgs)
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    const knowledge = project.knowledge ?? []
    const history: ChatMessage[] = [
      { role: "system", content: `You are a project assistant for "${project.name}". ${project.description ?? ""}\n${knowledge.length ? `Knowledge:\n${knowledge.join("\n")}` : ""}` },
      ...newMsgs.map(m => ({ role: m.role as "user" | "assistant", content: m.content })),
    ]
    setMsgs(p => [...p, { role: "assistant", content: "", streaming: true }])
    try {
      let acc = ""
      for await (const ev of sendAgenticMessage(history, "mollama", ctrl.signal)) {
        if (ev.type === "delta") {
          acc += ev.text
          setMsgs(p => p.map((m, i) => i === p.length - 1 ? { ...m, content: acc } : m))
        } else if (ev.type === "done") {
          const finalMsgs = [...newMsgs, { role: "assistant" as const, content: ev.text || acc }]
          setMsgs(finalMsgs.map(m => ({ ...m, streaming: false })) as ChatMsg[])
          onUpdateProject({ messages: finalMsgs })
          break
        } else if (ev.type === "error") {
          toast.error(ev.error)
          setMsgs(p => p.filter(m => !m.streaming))
          break
        }
      }
    } catch (e: any) {
      if (e.name !== "AbortError") toast.error(e.message)
      setMsgs(p => p.filter(m => !m.streaming))
    } finally { setBusy(false) }
  }, [input, msgs, busy, project, onUpdateProject])

  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 px-3 py-1.5 border-b border-border/30 bg-muted/5 flex items-center gap-2">
        <button onClick={generateBriefing} disabled={busy || msgs.length === 0}
          className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary/70 text-[9px] font-mono hover:bg-primary/20 disabled:opacity-40 transition-colors">
          <Sparkles size={9} />Previously on this project…
        </button>
        <span className="text-[8px] font-mono text-muted-foreground/25">{msgs.filter(m => m.role === "user").length} msgs</span>
      </div>
      <AnimatePresence>
        {showBriefing && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden border-b border-primary/20 bg-primary/[0.04]">
            <div className="px-4 py-3 relative">
              <button onClick={() => setShowBriefing(false)} className="absolute top-2 right-2 text-muted-foreground/30 hover:text-foreground transition-colors"><X size={10} /></button>
              <div className="flex items-center gap-1.5 mb-2">
                <Brain size={9} className="text-primary/60" />
                <span className="text-[8.5px] font-mono uppercase tracking-widest text-primary/50">Project Briefing</span>
              </div>
              <p className="text-[10px] font-mono text-foreground/70 leading-relaxed whitespace-pre-wrap pr-4">
                {briefing || <span className="text-muted-foreground/30 animate-pulse">Generating…</span>}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex-1 overflow-y-auto min-h-0 px-3 py-3 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
        {msgs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/25">
            <MessageSquare size={22} strokeWidth={1} />
            <p className="text-[9px] font-mono uppercase tracking-widest">Chat with your project agent</p>
          </div>
        ) : msgs.map((m, i) => (
          <div key={i} className={["flex gap-2", m.role === "user" ? "justify-end" : "justify-start"].join(" ")}>
            <div className={[
              "max-w-[85%] px-3 py-2 rounded-2xl text-xs leading-relaxed break-words",
              m.role === "user" ? "bg-primary text-primary-foreground rounded-tr-none" : "bg-secondary/40 border border-border/10 rounded-tl-none",
            ].join(" ")}>
              {m.role === "assistant" ? (
                <div className="space-y-1">
                  {renderMd(m.content)}
                  {m.streaming && <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }} className="inline-block w-[5px] h-[11px] bg-foreground/40 ml-px align-middle" />}
                </div>
              ) : <p className="whitespace-pre-wrap">{m.content}</p>}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="shrink-0 border-t border-border/30 px-3 py-2 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
          placeholder="Chat with your project… (Shift+Enter for newline)"
          disabled={busy}
          rows={1}
          className="flex-1 bg-transparent text-[10px] font-mono placeholder:text-muted-foreground/20 outline-none disabled:opacity-50 resize-none overflow-hidden leading-relaxed min-h-8 pt-1.5"
        />
        {busy ? (
          <button onClick={() => abortRef.current?.abort()} className="p-1.5 text-red-400/60 hover:text-red-400 transition-colors shrink-0"><Square size={11} /></button>
        ) : (
          <button onClick={send} disabled={!input.trim()} className="p-1.5 text-primary/60 hover:text-primary disabled:opacity-30 transition-colors shrink-0"><Send size={11} /></button>
        )}
      </div>
    </div>
  )
}

// ── ProjectEditor (Monaco) ─────────────────────────────────────────────────────

function ProjectEditor({
  project, filePath, onClose, onFileSaved,
}: {
  project: Project
  filePath: string
  onClose: () => void
  onFileSaved: () => void
}) {
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(true)
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 })
  const saveRef = useRef<() => Promise<void>>(async () => {})
  const editorRef = useRef<any>(null)

  useEffect(() => {
    setLoading(true)
    readProjectFile(project.id, filePath)
      .then(c => { setCode(c); setDirty(false); setSaved(false) })
      .catch(e => toast.error(e.message))
      .finally(() => setLoading(false))
  }, [project.id, filePath])

  const handleSave = useCallback(async () => {
    try {
      await writeProjectFile(project.id, filePath, code)
      setDirty(false); setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      toast.success("Saved")
      onFileSaved()
    } catch (e: any) {
      toast.error("Save failed", { description: e.message })
    }
  }, [project.id, filePath, code, onFileSaved])

  useEffect(() => { saveRef.current = handleSave }, [handleSave])

  const handleBeforeMount = useCallback((monaco: Monaco) => { applyTheme(monaco) }, [])

  const handleMount = useCallback((editor: any, monaco: Monaco) => {
    editorRef.current = editor
    editor.onDidChangeCursorPosition((e: any) => setCursorPos({ line: e.position.lineNumber, col: e.position.column }))
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current())
  }, [])

  const name = filePath.split("/").pop() ?? filePath

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-muted/10">
        <button onClick={() => { if (dirty && !window.confirm("Discard unsaved changes?")) return; onClose() }}
          className="p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/40 hover:text-foreground transition-colors">
          <ArrowLeft size={13} />
        </button>
        <div className="w-px h-4 bg-white/[0.06]" />
        <ProjFileIcon path={filePath} size={11} className="text-primary/60 shrink-0" />
        <span className="text-[10px] font-mono text-muted-foreground/60 truncate flex-1 min-w-0">{filePath}</span>
        {dirty && <span className="text-[8px] font-mono text-amber-400/60 uppercase shrink-0">●</span>}
        {saved && !dirty && <CheckCircle2 size={11} className="text-emerald-400/60 shrink-0" />}
        <button onClick={handleSave} disabled={!dirty}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary/15 border border-primary/20 text-[9px] font-mono text-primary/70 hover:bg-primary/25 disabled:opacity-30 transition-colors">
          <Save size={9} /> Save
        </button>
      </div>

      {/* Editor */}
      <div className="flex-1 min-h-0 overflow-hidden bg-black/20">
        {loading ? (
          <div className="flex items-center justify-center h-full"><Loader2 size={16} className="animate-spin text-muted-foreground/30" /></div>
        ) : (
          <Editor
            language={getLang(filePath)}
            theme={THEME}
            value={code}
            onChange={v => { setCode(v ?? ""); setDirty(true); setSaved(false) }}
            options={EDITOR_OPTIONS}
            beforeMount={handleBeforeMount}
            onMount={handleMount}
          />
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 h-[22px] shrink-0 border-t border-border/40 bg-muted/10 select-none">
        <div className="flex items-center gap-3">
          <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-primary/40">{getLang(filePath)}</span>
          {dirty && <span className="text-[8px] font-mono text-amber-400/50 flex items-center gap-1"><span className="w-[5px] h-[5px] rounded-full bg-amber-400/60 inline-block" />modified</span>}
          {saved && !dirty && <span className="text-[8px] font-mono text-emerald-400/50 flex items-center gap-1"><CheckCircle2 size={8} />saved</span>}
        </div>
        <div className="flex items-center gap-3 text-[8px] font-mono text-muted-foreground/20">
          <span>Ln {cursorPos.line}  Col {cursorPos.col}</span>
          <span>UTF-8</span>
        </div>
      </div>
    </div>
  )
}

// ── Context ────────────────────────────────────────────────────────────────────

interface ProjectsContextValue {
  projects: Project[]
  loading: boolean
  selected: string | null
  showNew: boolean
  newName: string
  newDesc: string
  creating: boolean
  setSelected: (id: string | null) => void
  setShowNew: (v: boolean) => void
  setNewName: (v: string) => void
  setNewDesc: (v: string) => void
  handleCreate: () => Promise<void>
  handleDelete: (id: string) => Promise<void>
  handleUpdateProject: (projectId: string, updates: Partial<Project>) => Promise<void>
  selectedProject: Project | null
}

const ProjectsCtx = createContext<ProjectsContextValue | null>(null)
function useProjectsCtx() {
  const c = useContext(ProjectsCtx)
  if (!c) throw new Error("No ProjectsProvider")
  return c
}

function useProjectsState(): ProjectsContextValue {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [newName, setNewName] = useState("")
  const [newDesc, setNewDesc] = useState("")
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const list = await fetchProjects()
      setProjects(list)
    } catch (e: any) { toast.error(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const selectedProject = projects.find(p => p.id === selected) ?? null

  const handleCreate = useCallback(async () => {
    if (!newName.trim()) return
    setCreating(true)
    const id = uuid()
    try {
      await saveProject(id, { id, name: newName.trim(), description: newDesc.trim() || undefined, knowledge: [] })
      await load()
      setSelected(id); setShowNew(false); setNewName(""); setNewDesc("")
    } catch (e: any) { toast.error(e.message) }
    finally { setCreating(false) }
  }, [newName, newDesc, load])

  const handleDelete = useCallback(async (id: string) => {
    if (!window.confirm("Delete this project and all its files?")) return
    try {
      await deleteProject(id)
      if (selected === id) setSelected(null)
      await load()
    } catch (e: any) { toast.error(e.message) }
  }, [selected, load])

  const handleUpdateProject = useCallback(async (projectId: string, updates: Partial<Project>) => {
    setProjects(prev => prev.map(p => p.id === projectId ? { ...p, ...updates } : p))
    try { await saveProject(projectId, updates) }
    catch (e: any) { toast.error("Failed to save project", { description: e.message }) }
  }, [])

  return { projects, loading, selected, showNew, newName, newDesc, creating, setSelected, setShowNew, setNewName, setNewDesc, handleCreate, handleDelete, handleUpdateProject, selectedProject }
}

export function ProjectsProvider({ children }: { children: React.ReactNode }) {
  const state = useProjectsState()
  return <ProjectsCtx.Provider value={state}>{children}</ProjectsCtx.Provider>
}

// ── NewProjectDialog ───────────────────────────────────────────────────────────

function NewProjectDialog() {
  const { showNew, setShowNew, newName, setNewName, newDesc, setNewDesc, handleCreate, creating } = useProjectsCtx()
  if (!showNew) return null
  return (
    <AnimatePresence>
      {showNew && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 bg-background/70 backdrop-blur-xl z-50 flex items-center justify-center p-4"
          onClick={() => setShowNew(false)}>
          <motion.div initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
            onClick={e => e.stopPropagation()}
            className="w-72 rounded-2xl border border-white/[0.07] bg-card/95 backdrop-blur-2xl shadow-2xl p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FolderOpen size={13} className="text-primary/70" />
              <span className="text-[10px] font-mono font-black uppercase tracking-[0.22em]">New Project</span>
            </div>
            <div className="space-y-2">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Project name" className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] font-mono outline-none placeholder:text-muted-foreground/25 focus:border-primary/30 transition-colors" />
              <input value={newDesc} onChange={e => setNewDesc(e.target.value)} onKeyDown={e => e.key === "Enter" && handleCreate()}
                placeholder="Description (optional)" className="w-full rounded-xl border border-border/25 bg-background/40 px-3 py-2 text-[11px] font-mono outline-none placeholder:text-muted-foreground/25 focus:border-primary/30 transition-colors" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setShowNew(false)} className="flex-1 h-8 rounded-xl border border-white/[0.07] text-[9px] font-mono uppercase tracking-widest text-muted-foreground hover:bg-white/[0.04] transition-colors">Cancel</button>
              <button onClick={handleCreate} disabled={creating || !newName.trim()}
                className="flex-1 h-8 rounded-xl bg-primary text-[9px] font-mono font-black uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5">
                {creating ? <Loader2 size={10} className="animate-spin" /> : <Plus size={10} />} Create
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

// ── ProjectsList (standalone export) ─────────────────────────────────────────

export function ProjectsList() {
  const { projects, loading, selected, setSelected, setShowNew, handleDelete } = useProjectsCtx()
  return (
    <div className="h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/40 bg-muted/10">
        <div className="flex items-center gap-1.5">
          <FolderOpen size={11} className="text-primary/60" />
          <span className="text-[9.5px] font-mono font-black uppercase tracking-[0.2em]">Projects</span>
          {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">{projects.length}</span>}
        </div>
        <button onClick={() => setShowNew(true)} className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors"><Plus size={11} /></button>
      </div>
      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
        ) : projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
            <FolderOpen size={20} className="text-muted-foreground/15" />
            <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No projects yet</p>
            <button onClick={() => setShowNew(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">+ Create first project</button>
          </div>
        ) : (
          <div className="p-1.5 space-y-0.5">
            {projects.map(p => (
              <button key={p.id} onClick={() => setSelected(p.id)}
                className={["w-full text-left rounded-lg px-2.5 py-2 transition-all group border", selected === p.id ? "bg-primary/10 border-primary/25" : "hover:bg-secondary/40 border-transparent"].join(" ")}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <FolderOpen size={10} className={selected === p.id ? "text-primary/80 shrink-0" : "text-muted-foreground/30 shrink-0"} />
                  <span className={["text-[10px] font-mono truncate flex-1", selected === p.id ? "text-foreground" : "text-muted-foreground/60"].join(" ")}>{p.name}</span>
                  <button onClick={e => { e.stopPropagation(); handleDelete(p.id) }} className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/20 hover:text-red-400 transition-all shrink-0"><Trash2 size={8} /></button>
                </div>
                {p.description && <p className="mt-0.5 pl-4 text-[8px] font-mono text-muted-foreground/30 truncate">{p.description}</p>}
              </button>
            ))}
          </div>
        )}
      </div>
      <NewProjectDialog />
    </div>
  )
}

// ── ProjectsMain (standalone export) ─────────────────────────────────────────

export function ProjectsMain() {
  const { selectedProject, handleUpdateProject, setShowNew } = useProjectsCtx()
  const [showVault, setShowVault] = useState(false)
  return (
    <div className="h-full border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
      <AnimatePresence mode="wait">
        {selectedProject ? (
          <motion.div key={selectedProject.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full flex flex-col">
            <div className="shrink-0 px-4 py-2.5 border-b border-border/40 bg-muted/10 flex items-center gap-2">
              <FolderOpen size={11} className="text-primary/60 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono font-black uppercase tracking-widest truncate">{selectedProject.name}</p>
                {selectedProject.description && <p className="text-[8px] font-mono text-muted-foreground/40 truncate">{selectedProject.description}</p>}
              </div>
              <button onClick={() => setShowVault(v => !v)}
                className={["flex items-center gap-1 px-2 py-1 rounded-lg border text-[9px] font-mono transition-colors", showVault ? "bg-primary/10 border-primary/25 text-primary/70" : "border-border/20 text-muted-foreground/40 hover:border-border/40"].join(" ")}>
                <BookOpen size={9} /> Vault {(selectedProject.knowledge ?? []).length > 0 && `(${selectedProject.knowledge!.length})`}
              </button>
            </div>
            <AnimatePresence>
              {showVault && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden border-b border-border/30">
                  <div className="p-3">
                    <KnowledgeVault entries={selectedProject.knowledge ?? []}
                      onAdd={entry => { const k = [...(selectedProject.knowledge ?? []), entry]; handleUpdateProject(selectedProject.id, { knowledge: k }) }}
                      onRemove={i => { const k = (selectedProject.knowledge ?? []).filter((_, idx) => idx !== i); handleUpdateProject(selectedProject.id, { knowledge: k }) }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <div className="flex-1 min-h-0 overflow-hidden">
              <ProjectChat project={selectedProject} onUpdateProject={u => handleUpdateProject(selectedProject.id, u)} />
            </div>
          </motion.div>
        ) : (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground/20">
            <FolderOpen size={32} strokeWidth={1} />
            <div className="space-y-1 text-center">
              <p className="text-[10px] font-mono uppercase tracking-widest">No project selected</p>
              <p className="text-[9px] font-mono text-muted-foreground/15">Select or create a project to begin</p>
            </div>
            <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-[9px] font-mono font-bold uppercase tracking-widest text-muted-foreground/40 hover:border-primary/30 hover:text-primary transition-colors">
              <Plus size={9} /> New Project
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <NewProjectDialog />
    </div>
  )
}

// ── Left Panel (projects + file tree + agent tabs) ────────────────────────────

type LeftTab = "projects" | "files" | "agent"

export function ProjectsLeftPanel({
  selectedFile, onSelectFile, fileCode,
}: {
  selectedFile: string | null
  onSelectFile: (path: string | null) => void
  fileCode: string
}) {
  const { projects, loading, selected, setSelected, selectedProject, setShowNew, handleDelete } = useProjectsCtx()
  const [tab, setTab] = useState<LeftTab>("projects")
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    if (selected && tab === "projects") setTab("files")
  }, [selected])

  return (
    <div className="h-full flex flex-col overflow-hidden border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg">
      {/* Tab strip */}
      <div className="shrink-0 flex items-center gap-0.5 px-1 py-1 border-b border-border/30 bg-muted/5">
        {(["projects", "files", "agent"] as LeftTab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={["flex items-center gap-1 px-2.5 py-1 rounded-lg text-[9px] font-mono uppercase tracking-widest transition-colors border",
              tab === t ? "bg-background/60 text-foreground border-border/40" : "text-muted-foreground/40 hover:text-muted-foreground/70 border-transparent"].join(" ")}>
            {t === "projects" && <FolderOpen size={8} />}
            {t === "files" && <Code2 size={8} />}
            {t === "agent" && <MessageSquare size={8} />}
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "projects" && (
          <div className="h-full flex flex-col">
            <div className="shrink-0 px-3 py-2 flex items-center justify-between border-b border-border/30 bg-muted/5">
              <div className="flex items-center gap-1.5">
                <FolderOpen size={10} className="text-primary/60" />
                <span className="text-[9px] font-mono font-black uppercase tracking-widest">Projects</span>
                {!loading && <span className="text-[8px] font-mono text-muted-foreground/30 ml-1">{projects.length}</span>}
              </div>
              <button onClick={() => setShowNew(true)} className="p-1.5 rounded-lg hover:bg-primary/15 text-primary/50 hover:text-primary transition-colors"><Plus size={10} /></button>
            </div>
            <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/[0.07] [&::-webkit-scrollbar-thumb]:rounded-full">
              {loading ? (
                <div className="flex items-center justify-center py-8"><Loader2 size={13} className="animate-spin text-muted-foreground/25" /></div>
              ) : projects.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-10 px-4">
                  <FolderOpen size={20} className="text-muted-foreground/15" />
                  <p className="text-[9px] font-mono text-muted-foreground/25 text-center">No projects yet</p>
                  <button onClick={() => setShowNew(true)} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">+ Create first</button>
                </div>
              ) : (
                <div className="p-1.5 space-y-0.5">
                  {projects.map(p => (
                    <button key={p.id} onClick={() => { setSelected(p.id); setTab("files") }}
                      className={["w-full text-left rounded-lg px-2.5 py-2 transition-all group border", selected === p.id ? "bg-primary/10 border-primary/25" : "hover:bg-secondary/40 border-transparent"].join(" ")}>
                      <div className="flex items-center gap-1.5 min-w-0">
                        <FolderOpen size={10} className={selected === p.id ? "text-primary/80 shrink-0" : "text-muted-foreground/30 shrink-0"} />
                        <span className={["text-[10px] font-mono truncate flex-1", selected === p.id ? "text-foreground" : "text-muted-foreground/60"].join(" ")}>{p.name}</span>
                        <button onClick={e => { e.stopPropagation(); handleDelete(p.id) }} className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground/20 hover:text-red-400 transition-all shrink-0"><Trash2 size={8} /></button>
                      </div>
                      {p.description && <p className="mt-0.5 pl-4 text-[8px] font-mono text-muted-foreground/30 truncate">{p.description}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {tab === "files" && (
          <div className="h-full">
            {selectedProject ? (
              <ProjectFileExplorer
                key={refreshKey}
                project={selectedProject}
                selectedPath={selectedFile}
                onSelect={onSelectFile}
                onRefresh={() => setRefreshKey(k => k + 1)}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/25">
                <FolderOpen size={20} />
                <p className="text-[9px] font-mono">Select a project first</p>
                <button onClick={() => setTab("projects")} className="text-[8.5px] font-mono text-primary/50 hover:text-primary transition-colors">→ Projects</button>
              </div>
            )}
          </div>
        )}

        {tab === "agent" && (
          <div className="h-full">
            {selectedProject ? (
              <ProjectAgent project={selectedProject} selectedFile={selectedFile} fileCode={fileCode} />
            ) : (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/25">
                <MessageSquare size={20} />
                <p className="text-[9px] font-mono">Select a project first</p>
              </div>
            )}
          </div>
        )}
      </div>

      <NewProjectDialog />
    </div>
  )
}

// ── ProjectsPanel (main layout) ───────────────────────────────────────────────

export function ProjectsPanel() {
  return (
    <ProjectsProvider>
      <ProjectsPanelInner />
    </ProjectsProvider>
  )
}

function ProjectsPanelInner() {
  const { selectedProject, handleUpdateProject } = useProjectsCtx()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [fileCode, setFileCode] = useState("")
  const [showVault, setShowVault] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  // When project changes, deselect file
  useEffect(() => { setSelectedFile(null); setFileCode("") }, [selectedProject?.id])

  // Load code when file selected (for agent context)
  useEffect(() => {
    if (!selectedProject || !selectedFile) { setFileCode(""); return }
    readProjectFile(selectedProject.id, selectedFile)
      .then(c => setFileCode(c))
      .catch(() => setFileCode(""))
  }, [selectedProject?.id, selectedFile])

  return (
    <div className="h-full flex gap-2">
      {/* Left panel */}
      <div className="w-56 shrink-0">
        <ProjectsLeftPanel
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          fileCode={fileCode}
        />
      </div>

      {/* Center */}
      <div className="flex-1 min-w-0 border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden">
        <AnimatePresence mode="wait">
          {selectedProject && selectedFile ? (
            <motion.div key={`file-${selectedFile}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.1 }} className="h-full">
              <ProjectEditor
                project={selectedProject}
                filePath={selectedFile}
                onClose={() => setSelectedFile(null)}
                onFileSaved={() => setRefreshTick(t => t + 1)}
              />
            </motion.div>
          ) : selectedProject ? (
            <motion.div key={`proj-${selectedProject.id}`} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full flex flex-col">
              {/* Project header */}
              <div className="shrink-0 px-4 py-2.5 border-b border-border/40 bg-muted/10 flex items-center gap-2">
                <FolderOpen size={11} className="text-primary/60 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-mono font-black uppercase tracking-widest truncate">{selectedProject.name}</p>
                  {selectedProject.description && <p className="text-[8px] font-mono text-muted-foreground/40 truncate">{selectedProject.description}</p>}
                </div>
                <button onClick={() => setShowVault(v => !v)}
                  className={["flex items-center gap-1 px-2 py-1 rounded-lg border text-[9px] font-mono transition-colors", showVault ? "bg-primary/10 border-primary/25 text-primary/70" : "border-border/20 text-muted-foreground/40 hover:border-border/40"].join(" ")}>
                  <BookOpen size={9} /> Vault {(selectedProject.knowledge ?? []).length > 0 && `(${selectedProject.knowledge!.length})`}
                </button>
              </div>
              <AnimatePresence>
                {showVault && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="shrink-0 overflow-hidden border-b border-border/30">
                    <div className="p-3">
                      <KnowledgeVault entries={selectedProject.knowledge ?? []}
                        onAdd={entry => { const k = [...(selectedProject.knowledge ?? []), entry]; handleUpdateProject(selectedProject.id, { knowledge: k }) }}
                        onRemove={i => { const k = (selectedProject.knowledge ?? []).filter((_, idx) => idx !== i); handleUpdateProject(selectedProject.id, { knowledge: k }) }} />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
              <div className="flex-1 min-h-0 overflow-hidden">
                <ProjectChat project={selectedProject} onUpdateProject={u => handleUpdateProject(selectedProject.id, u)} />
              </div>
            </motion.div>
          ) : (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center gap-4 text-muted-foreground/20">
              <FolderOpen size={32} strokeWidth={1} />
              <div className="space-y-1 text-center">
                <p className="text-[10px] font-mono uppercase tracking-widest">No project selected</p>
                <p className="text-[9px] font-mono text-muted-foreground/15">Select or create a project to begin</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
