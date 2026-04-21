import { useState, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Brain, Save, Plus, Loader2, CheckCircle2, RefreshCcw, Eye, EyeOff, Copy, Check } from "lucide-react"
import { Card } from "@/components/ui/card"
import { API_BASE_URL } from "@/lib/api"
import { toast } from "sonner"

// ── Markdown renderer ─────────────────────────────────────────────────────────

function CopyCodeBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {}) }}
      className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono border border-border/20 bg-background/30 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check size={8} className="text-emerald-400" /> : <Copy size={8} />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function renderMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  const codeRx = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0, i = 0, m: RegExpExecArray | null
  while ((m = codeRx.exec(text)) !== null) {
    const before = text.slice(last, m.index)
    if (before) parts.push(<MarkdownLines key={`t${i++}`} text={before} />)
    parts.push(
      <div key={`c${i++}`} className="my-2 rounded-xl border border-border/25 overflow-hidden bg-background/50">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/15 bg-secondary/12">
          <span className="text-[8px] font-mono uppercase tracking-wider text-muted-foreground">{m[1] || "code"}</span>
          <CopyCodeBtn text={m[2]} />
        </div>
        <pre className="px-3 py-2.5 text-[10px] font-mono text-foreground/80 overflow-x-auto leading-relaxed whitespace-pre-wrap">{m[2]}</pre>
      </div>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<MarkdownLines key={`t${i}`} text={text.slice(last)} />)
  return <>{parts}</>
}

function MarkdownLines({ text }: { text: string }) {
  const b = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-secondary/35 text-[9px] font-mono text-primary/80">$1</code>').replace(/\*(.*?)\*/g, "<em>$1</em>")
  return (
    <>
      {text.split("\n").map((line, i) => {
        if (line.startsWith("# ")) return <h1 key={i} className="text-[15px] font-bold text-foreground/90 mt-4 mb-1.5 pb-1 border-b border-border/20" dangerouslySetInnerHTML={{ __html: b(line.slice(2)) }} />
        if (line.startsWith("## ")) return <h2 key={i} className="text-[13px] font-semibold text-foreground/85 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: b(line.slice(3)) }} />
        if (line.startsWith("### ")) return <h3 key={i} className="text-[11.5px] font-semibold text-foreground/80 mt-2 mb-0.5" dangerouslySetInnerHTML={{ __html: b(line.slice(4)) }} />
        if (/^[-*] /.test(line)) return <div key={i} className="flex gap-1.5 my-0.5"><span className="text-primary/50 mt-[3px] shrink-0">•</span><span className="text-[11px] text-foreground/80 leading-relaxed" dangerouslySetInnerHTML={{ __html: b(line.slice(2)) }} /></div>
        if (/^\d+\. /.test(line)) return <div key={i} className="flex gap-1.5 my-0.5"><span className="text-primary/50 mt-[3px] shrink-0 tabular-nums text-[10px]">{line.match(/^\d+/)![0]}.</span><span className="text-[11px] text-foreground/80 leading-relaxed" dangerouslySetInnerHTML={{ __html: b(line.replace(/^\d+\. /, "")) }} /></div>
        if (line.startsWith("---")) return <hr key={i} className="my-2 border-border/20" />
        if (!line.trim()) return <div key={i} className="h-1.5" />
        return <p key={i} className="text-[11px] text-foreground/80 leading-relaxed my-0.5" dangerouslySetInnerHTML={{ __html: b(line) }} />
      })}
    </>
  )
}

// ── API helpers ────────────────────────────────────────────────────────────────

async function fetchMemory(): Promise<string> {
  const r = await fetch(`${API_BASE_URL}/admin/soul`)
  if (!r.ok) throw new Error("Failed to fetch memory")
  const d = await r.json()
  return d.content ?? ""
}

async function saveMemory(content: string): Promise<void> {
  const r = await fetch(`${API_BASE_URL}/admin/soul`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  })
  if (!r.ok) throw new Error("Failed to save memory")
}

async function addMemoryEntry(entry: string, section: string): Promise<void> {
  const r = await fetch(`${API_BASE_URL}/admin/soul/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entry, section }),
  })
  if (!r.ok) throw new Error("Failed to add memory entry")
}

// ── MemoryPanel ────────────────────────────────────────────────────────────────

export function MemoryPanel() {
  const [content, setContent] = useState("")
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [newEntry, setNewEntry] = useState("")
  const [newSection, setNewSection] = useState("General")
  const [addPending, setAddPending] = useState(false)
  const [preview, setPreview] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const c = await fetchMemory()
      setContent(c)
      setDraft(c)
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveMemory(draft)
      setContent(draft)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      toast.success("SOUL.md saved")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = async () => {
    if (!newEntry.trim()) return
    setAddPending(true)
    try {
      await addMemoryEntry(newEntry.trim(), newSection.trim() || "General")
      await load()
      setNewEntry("")
      setShowAdd(false)
      toast.success("Memory entry added")
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setAddPending(false)
    }
  }

  const isDirty = draft !== content

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <Brain size={13} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">SOUL.md</span>
          <span className="text-[8px] font-mono text-muted-foreground/40 uppercase tracking-widest">Persistent Memory</span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowAdd(s => !s)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 transition-colors"
          >
            <Plus size={9} /> Add Entry
          </button>
          <button
            onClick={() => setPreview(p => !p)}
            title={preview ? "Edit mode" : "Preview markdown"}
            className={`p-1.5 rounded-lg transition-colors ${preview ? "bg-primary/10 text-primary border border-primary/20" : "hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground"}`}
          >
            {preview ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
          <button
            onClick={load}
            className="p-1.5 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors"
            title="Reload"
          >
            <RefreshCcw size={12} />
          </button>
        </div>
      </div>

      {/* Add entry form */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-b border-border/30"
          >
            <div className="px-4 py-3 space-y-2 bg-primary/3">
              <div className="flex gap-2">
                <input
                  value={newSection}
                  onChange={e => setNewSection(e.target.value)}
                  placeholder="Section (e.g. User Preferences)"
                  className="flex-none w-44 px-2 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/30"
                />
                <input
                  value={newEntry}
                  onChange={e => setNewEntry(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAdd()}
                  placeholder="Memory entry…"
                  className="flex-1 px-2 py-1.5 text-[10px] font-mono bg-background/40 border border-border/30 rounded-lg focus:outline-none focus:border-primary/40 placeholder:text-muted-foreground/30"
                />
                <button
                  onClick={handleAdd}
                  disabled={addPending || !newEntry.trim()}
                  className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-[9px] font-mono font-bold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {addPending ? <Loader2 size={10} className="animate-spin" /> : "Add"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor / Preview */}
      <div className="flex-1 min-h-0 relative overflow-hidden">
        {loading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-muted-foreground/50" />
          </div>
        ) : preview ? (
          <div className="h-full overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
            {draft.trim() ? renderMarkdown(draft) : (
              <p className="text-[10px] font-mono text-muted-foreground/30 italic">No content to preview.</p>
            )}
          </div>
        ) : (
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            className="w-full h-full resize-none px-4 py-3 text-[11px] font-mono leading-relaxed bg-transparent border-none focus:outline-none text-foreground/80 placeholder:text-muted-foreground/20 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full"
            placeholder={"# SOUL.md — Agent Memory\n\nNo memories recorded yet.\nUse 'Add Entry' or ask the agent to add_to_memory."}
          />
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-border/30 px-4 py-2.5 flex items-center justify-between bg-muted/5">
        <span className="text-[8px] font-mono text-muted-foreground/30 tabular-nums">
          {draft.split("\n").length} lines · {draft.length} chars
          {isDirty && " · unsaved"}
        </span>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          className={[
            "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wider transition-all",
            saved
              ? "bg-primary/15 text-primary border border-primary/25"
              : isDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-secondary/20 text-muted-foreground/40 border border-border/20 cursor-not-allowed",
          ].join(" ")}
        >
          {saving ? <Loader2 size={10} className="animate-spin" /> : saved ? <CheckCircle2 size={10} /> : <Save size={10} />}
          {saving ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
      </div>
    </Card>
  )
}
