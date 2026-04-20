import { useState, useRef, useEffect, useCallback, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Send, MessageSquare, Loader2, ArrowDown, Brain, Zap,
  Square, Plus, ChevronDown, Wrench, CheckCircle2, AlertCircle,
  Trash2, History, Terminal, Scissors, Paperclip, ImagePlus,
  Lightbulb, X as XIcon, FileText, Activity,
} from "lucide-react"
import { sendChatMessage, sendAgenticMessage, compactChatMessages, type ChatMessage } from "@/lib/api"
import { useTools, useAppSettings, useModelContextLength } from "@/hooks/use-api"
import { toast } from "sonner"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup,
  DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"

const SCROLL_CLS = [
  "absolute inset-0 overflow-y-auto",
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb:hover]:bg-border/50",
].join(" ")

// ── Sessions ──────────────────────────────────────────────────────────────────

interface Session {
  id: string
  name: string
  messages: ChatMessage[]
  displays?: DisplayMsg[]
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

function newSession(): Session {
  return { id: uuid(), name: "New Chat", messages: [] }
}

function loadSessions(): Session[] {
  try {
    const raw = localStorage.getItem("mollama_sessions")
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch { /* */ }
  return [newSession()]
}

function saveSessions(sessions: Session[]) {
  try { localStorage.setItem("mollama_sessions", JSON.stringify(sessions)) } catch { /* */ }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function applyInlineStyles(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Order matters: links before bold/italic to avoid conflicts
  const re = /(\[([^\]]+)\]\((https?:\/\/[^)]+)\)|`[^`]+`|\*\*(?:[^*]|\*(?!\*))+\*\*|__(?:[^_]|_(?!_))+__|\*(?:[^*])+\*|_(?:[^_])+_|~~[^~]+~~)/g
  let last = 0; let m: RegExpExecArray | null; let k = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{text.slice(last, m.index)}</span>)
    const tok = m[0]
    if (tok.startsWith("[")) {
      // Markdown link [text](url)
      const linkText = m[2]; const href = m[3]
      parts.push(<a key={k++} href={href} target="_blank" rel="noopener noreferrer" className="text-primary/80 underline underline-offset-2 hover:text-primary transition-colors">{linkText}</a>)
    } else if (tok.startsWith("`")) {
      parts.push(<code key={k++} className="px-1 py-0.5 rounded bg-black/30 text-primary/80 text-[10px] font-mono">{tok.slice(1, -1)}</code>)
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      parts.push(<strong key={k++} className="font-semibold">{applyInlineStyles(tok.slice(2, -2))}</strong>)
    } else if (tok.startsWith("~~")) {
      parts.push(<del key={k++} className="opacity-60">{tok.slice(2, -2)}</del>)
    } else if (tok.startsWith("*") || tok.startsWith("_")) {
      parts.push(<em key={k++} className="italic opacity-90">{applyInlineStyles(tok.slice(1, -1))}</em>)
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<span key={k++}>{text.slice(last)}</span>)
  return parts
}

function renderBlock(text: string, baseKey: number): React.ReactNode {
  const lines = text.split("\n")
  const nodes: React.ReactNode[] = []
  let i = 0; let k = baseKey * 10000

  while (i < lines.length) {
    const line = lines[i]

    // ATX headings
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (hMatch) {
      const level = hMatch[1].length
      const hClasses: Record<number, string> = {
        1: "text-base font-bold mt-3 mb-1",
        2: "text-[13px] font-bold mt-2.5 mb-1",
        3: "text-[12px] font-semibold mt-2 mb-0.5",
        4: "text-[11px] font-semibold mt-1.5 mb-0.5",
        5: "text-[11px] font-medium mt-1",
        6: "text-[10px] font-medium mt-1 text-muted-foreground/70",
      }
      nodes.push(<div key={k++} className={hClasses[level] ?? "font-semibold"}>{applyInlineStyles(hMatch[2])}</div>)
      i++; continue
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(line.trim())) {
      nodes.push(<hr key={k++} className="my-2 border-border/20" />)
      i++; continue
    }

    // Unordered list
    if (/^[\s]*[-*+]\s/.test(line)) {
      const items: React.ReactNode[] = []
      while (i < lines.length && /^[\s]*[-*+]\s/.test(lines[i])) {
        const indent = lines[i].match(/^(\s*)/)?.[1].length ?? 0
        const content = lines[i].replace(/^[\s]*[-*+]\s/, "")
        items.push(
          <li key={k++} className="flex items-start gap-1.5" style={{ paddingLeft: `${indent * 4}px` }}>
            <span className="mt-[4px] shrink-0 w-1 h-1 rounded-full bg-foreground/40" />
            <span>{applyInlineStyles(content)}</span>
          </li>
        )
        i++
      }
      nodes.push(<ul key={k++} className="my-1.5 space-y-0.5 text-[11px]">{items}</ul>)
      continue
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s/.test(line)) {
      const items: React.ReactNode[] = []
      let idx = 1
      while (i < lines.length && /^[\s]*\d+[.)]\s/.test(lines[i])) {
        const content = lines[i].replace(/^[\s]*\d+[.)]\s/, "")
        items.push(
          <li key={k++} className="flex items-start gap-1.5">
            <span className="shrink-0 text-muted-foreground/50 text-[9px] font-mono w-4 text-right mt-px">{idx++}.</span>
            <span>{applyInlineStyles(content)}</span>
          </li>
        )
        i++
      }
      nodes.push(<ol key={k++} className="my-1.5 space-y-0.5 text-[11px]">{items}</ol>)
      continue
    }

    // Blockquote
    if (line.startsWith(">")) {
      const qLines: string[] = []
      while (i < lines.length && lines[i].startsWith(">")) {
        qLines.push(lines[i].replace(/^>\s?/, ""))
        i++
      }
      nodes.push(
        <blockquote key={k++} className="my-1.5 pl-3 border-l-2 border-primary/30 text-muted-foreground/70 italic text-[11px]">
          {qLines.map((ql, qi) => <div key={qi}>{applyInlineStyles(ql)}</div>)}
        </blockquote>
      )
      continue
    }

    // Table (| header | header |)
    if (line.includes("|") && i + 1 < lines.length && /^\|[-| :]+\|$/.test(lines[i + 1]?.trim() ?? "")) {
      const headers = line.split("|").map(c => c.trim()).filter(Boolean)
      i += 2 // skip header + separator
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(lines[i].split("|").map(c => c.trim()).filter(Boolean))
        i++
      }
      nodes.push(
        <div key={k++} className="my-2 overflow-x-auto">
          <table className="w-full text-[10px] font-mono border-collapse">
            <thead>
              <tr className="border-b border-border/30">
                {headers.map((h, hi) => <th key={hi} className="px-2 py-1 text-left font-semibold text-foreground/80">{applyInlineStyles(h)}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className="border-b border-border/10 hover:bg-white/[0.02] transition-colors">
                  {row.map((cell, ci) => <td key={ci} className="px-2 py-1 text-foreground/70">{applyInlineStyles(cell)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }

    // Empty line → paragraph break (skip)
    if (line.trim() === "") {
      i++; continue
    }

    // Paragraph: collect consecutive non-special lines
    const paraLines: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^#{1,6}\s/.test(lines[i]) &&
      !/^[\s]*[-*+]\s/.test(lines[i]) &&
      !/^[\s]*\d+[.)]\s/.test(lines[i]) &&
      !lines[i].startsWith(">") &&
      !/^[-*_]{3,}$/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i])
      i++
    }
    if (paraLines.length) {
      nodes.push(
        <p key={k++} className="leading-relaxed break-words">
          {paraLines.map((pl, pli) => (
            <span key={pli}>{pli > 0 && <br />}{applyInlineStyles(pl)}</span>
          ))}
        </p>
      )
    }
  }
  return <div key={baseKey} className="space-y-1">{nodes}</div>
}

function renderContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0; let match: RegExpExecArray | null; let idx = 0

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > last) {
      nodes.push(renderBlock(text.slice(last, match.index), idx++))
    }
    const lang = match[1]
    nodes.push(
      <div key={`cb-${match.index}`} className="my-2 rounded-lg overflow-hidden border border-border/30 bg-black/30">
        {lang && (
          <div className="px-3 py-1 text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest border-b border-border/20 bg-black/20">{lang}</div>
        )}
        <pre className="p-3 text-[11px] font-mono text-foreground/80 overflow-x-auto leading-relaxed whitespace-pre">{match[2]}</pre>
      </div>
    )
    last = match.index + match[0].length
  }
  if (last < text.length) nodes.push(renderBlock(text.slice(last), idx++))
  return nodes
}

// ── Slash commands ────────────────────────────────────────────────────────────

interface SlashCmd {
  cmd: string
  desc: string
  icon: React.ElementType
  action?: "clear" | "new" | "compact"
}

const SLASH_COMMANDS: SlashCmd[] = [
  { cmd: "/mollama", desc: "Smart routing · internal tool loop", icon: Brain                        },
  { cmd: "/compact", desc: "Summarise old messages, keep last 3", icon: Scissors, action: "compact" },
  { cmd: "/new",     desc: "Start a new chat session",            icon: Plus,     action: "new"     },
  { cmd: "/clear",   desc: "Clear current session",               icon: Trash2,   action: "clear"   },
]

function SlashCommandPicker({ matches, activeIdx, onSelect }: {
  matches: SlashCmd[]; activeIdx: number; onSelect: (c: SlashCmd) => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 6, scale: 0.98 }}
      transition={{ duration: 0.12, ease: "easeOut" }}
      className="absolute bottom-full left-0 right-0 mb-2 z-30"
    >
      <div className="rounded-xl border border-white/[0.07] bg-[#0a0a18]/98 backdrop-blur-2xl shadow-2xl shadow-black/60 overflow-hidden">
        <div className="px-3 py-1.5 border-b border-white/[0.05] flex items-center gap-1.5">
          <Terminal size={8} className="text-muted-foreground/25" />
          <span className="text-[7.5px] font-mono uppercase tracking-[0.25em] text-muted-foreground/25">Commands</span>
        </div>
        <div className="py-1">
          {matches.map((c, i) => {
            const Icon = c.icon
            const active = i === activeIdx
            return (
              <button
                key={c.cmd}
                onMouseDown={e => { e.preventDefault(); onSelect(c) }}
                className={[
                  "w-full flex items-center gap-3 px-3 py-2 text-left transition-colors group",
                  active ? "bg-primary/8" : "hover:bg-white/[0.03]",
                ].join(" ")}
              >
                <div className={[
                  "shrink-0 w-5 h-5 rounded-md flex items-center justify-center transition-colors",
                  active ? "bg-primary/15 text-primary" : "bg-white/[0.04] text-muted-foreground/30",
                ].join(" ")}>
                  <Icon size={10} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={[
                    "text-[11px] font-mono font-bold transition-colors",
                    active ? "text-foreground" : "text-muted-foreground/55",
                  ].join(" ")}>
                    {c.cmd}
                  </span>
                </div>
                <span className="text-[8.5px] font-mono text-muted-foreground/25 truncate shrink-0 max-w-[120px]">
                  {c.desc}
                </span>
                {active && (
                  <kbd className="shrink-0 text-[7.5px] font-mono px-1 py-0.5 rounded border border-primary/20 bg-primary/8 text-primary/50">↵</kbd>
                )}
              </button>
            )
          })}
        </div>
        <div className="px-3 py-1.5 border-t border-white/[0.04] flex items-center gap-3">
          <span className="text-[7px] font-mono text-muted-foreground/20">↑↓ navigate</span>
          <span className="text-[7px] font-mono text-muted-foreground/20">↵ Tab select</span>
          <span className="text-[7px] font-mono text-muted-foreground/20">Esc dismiss</span>
        </div>
      </div>
    </motion.div>
  )
}

// ── Model picker ─────────────────────────────────────────────────────────────

function ModelPicker({ model, models, routedModel, isLoading, isMollama, onModelChange }: {
  model: string; models: string[]; routedModel: string | null
  isLoading: boolean; isMollama: boolean; onModelChange: (m: string) => void
}) {
  const displayName = isMollama && routedModel ? routedModel : (model || "—")
  const shortName = displayName.length > 18 ? displayName.slice(0, 16) + "…" : displayName

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={[
          "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px] font-mono font-bold",
          "transition-all outline-none select-none",
          "bg-secondary/30 border-border/20 hover:border-border/40 hover:bg-secondary/50",
          "data-[state=open]:border-primary/30 data-[state=open]:bg-primary/5",
        ].join(" ")}>
          <span className={isMollama ? "text-amber-400/80" : "text-primary/80"}>{shortName}</span>
          {isMollama && isLoading && !routedModel && (
            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 0.9, repeat: Infinity }}
              className="text-[8px] text-amber-400/50">●</motion.span>
          )}
          <ChevronDown size={8} className="text-muted-foreground/40 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        className="min-w-[180px] max-w-[240px] max-h-[280px] overflow-y-auto rounded-xl border border-white/[0.07] bg-[#0d0d1c]/98 backdrop-blur-2xl shadow-2xl shadow-black/50 p-1.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-border/50"
      >
        <DropdownMenuLabel className="px-2 py-1 text-[8px] font-mono uppercase tracking-[0.22em] text-muted-foreground/40">
          Select Model
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="my-1 bg-white/[0.05]" />
        <DropdownMenuRadioGroup value={model} onValueChange={onModelChange}>
          <DropdownMenuRadioItem
            value="mollama"
            className="rounded-lg pl-8 pr-2 py-1.5 text-[10px] font-mono cursor-pointer focus:bg-amber-500/10 focus:text-amber-300 data-[state=checked]:text-amber-300 text-muted-foreground/70 transition-colors"
          >
            <span className="flex items-center gap-2 min-w-0">
              <Brain size={9} className="shrink-0 text-amber-400/60" />
              <span className="truncate">mollama</span>
              <span className="ml-auto text-[8px] text-amber-500/40 shrink-0">smart</span>
            </span>
          </DropdownMenuRadioItem>
          {models.length > 0 && <DropdownMenuSeparator className="my-1 bg-white/[0.05]" />}
          {models.map(m => (
            <DropdownMenuRadioItem
              key={m}
              value={m}
              className="rounded-lg pl-8 pr-2 py-1.5 text-[10px] font-mono cursor-pointer focus:bg-primary/10 focus:text-foreground data-[state=checked]:text-primary text-muted-foreground/60 transition-colors"
            >
              <span className="truncate block">{m}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Display message types ─────────────────────────────────────────────────────

interface AgenticStep {
  id: string
  name: string
  args: Record<string, unknown>
  result?: string
  ok?: boolean
}

interface AgenticContentBlock { kind: "content"; text: string; streaming?: boolean }
interface AgenticToolGroup { kind: "tools"; steps: AgenticStep[] }
type AgenticItem = AgenticContentBlock | AgenticToolGroup

type DisplayMsg =
  | { kind: "chat"; role: "user" | "assistant"; content: string; streaming?: boolean }
  | { kind: "agentic"; items: AgenticItem[]; streaming: boolean; routedModel?: string }

// ── Agentic step detail row ───────────────────────────────────────────────────

const STEP_SCROLL = [
  "max-h-40 overflow-y-auto",
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb:hover]:bg-border/40",
].join(" ")

function AgenticStepRow({ step }: { step: AgenticStep }) {
  const [expanded, setExpanded] = useState(false)
  const pending = step.result === undefined
  const argsStr = Object.entries(step.args)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ")

  return (
    <div className="rounded-lg border border-border/10 overflow-hidden bg-background/20">
      <button
        onClick={() => !pending && setExpanded(e => !e)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[0.02] transition-colors"
      >
        {pending ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}>
            <Loader2 size={8} className="text-primary/50 shrink-0" />
          </motion.div>
        ) : step.ok ? (
          <CheckCircle2 size={8} className="text-emerald-400/70 shrink-0" />
        ) : (
          <AlertCircle size={8} className="text-red-400/70 shrink-0" />
        )}
        <span className="text-[9.5px] font-mono font-bold text-foreground/70 shrink-0">{step.name}</span>
        <span className="text-[8.5px] font-mono text-muted-foreground/35 truncate min-w-0">
          ({argsStr || "∅"})
        </span>
        {!pending && (
          <ChevronDown size={8} className={`ml-auto shrink-0 text-muted-foreground/30 transition-transform ${expanded ? "rotate-180" : ""}`} />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden border-t border-border/10"
          >
            <div className="px-2.5 py-2 space-y-2 bg-black/20">
              <div>
                <div className="text-[7.5px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 mb-1">Input</div>
                <pre className={`text-[9px] font-mono text-foreground/60 whitespace-pre-wrap break-all leading-relaxed ${STEP_SCROLL}`}>
                  {JSON.stringify(step.args, null, 2)}
                </pre>
              </div>
              {step.result !== undefined && (
                <div>
                  <div className="text-[7.5px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 mb-1">Output</div>
                  <pre className={`text-[9px] font-mono text-foreground/60 whitespace-pre-wrap break-all leading-relaxed ${STEP_SCROLL}`}>
                    {step.result}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Agentic response card ─────────────────────────────────────────────────────

function AgenticResponseCard({ msg }: { msg: Extract<DisplayMsg, { kind: "agentic" }> }) {
  const [closedGroups, setClosedGroups] = useState<Set<number>>(new Set())

  const toggleGroup = (idx: number) => setClosedGroups(prev => {
    const next = new Set(prev)
    next.has(idx) ? next.delete(idx) : next.add(idx)
    return next
  })

  return (
    <motion.div
      initial={{ opacity: 0, y: 6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2 }}
      className="flex justify-start"
    >
      <div className="max-w-[88%] rounded-2xl rounded-tl-none bg-secondary/40 border border-border/10 backdrop-blur-md shadow-sm overflow-hidden">

        {/* Initial streaming: no items yet */}
        {msg.streaming && msg.items.length === 0 && (
          <div className="px-3 py-2.5 flex items-center gap-2">
            <motion.div
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 1.2, repeat: Infinity }}
              className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"
            />
            <span className="text-[8.5px] font-mono text-muted-foreground/50">Thinking…</span>
          </div>
        )}

        {/* Render items in sequence — tools groups + content blocks interleaved */}
        {msg.items.map((item, idx) => {
          if (item.kind === "tools") {
            const isOpen = !closedGroups.has(idx)
            const doneCt = item.steps.filter(s => s.result !== undefined).length
            const running = doneCt < item.steps.length && msg.streaming
            const currentStep = item.steps[doneCt]

            return (
              <div key={idx} className={idx > 0 ? "border-t border-border/10" : ""}>
                <button
                  onClick={() => toggleGroup(idx)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    {running ? (
                      <motion.div
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0"
                      />
                    ) : (
                      <CheckCircle2 size={8} className="text-emerald-400/60 shrink-0" />
                    )}
                    <span className="text-[8.5px] font-mono text-muted-foreground/50 truncate">
                      {running && currentStep
                        ? `Running ${currentStep.name}…`
                        : `${item.steps.length} tool${item.steps.length !== 1 ? "s" : ""} used`}
                    </span>
                  </div>
                  <ChevronDown size={8} className={`shrink-0 text-muted-foreground/25 transition-transform ${isOpen ? "rotate-180" : ""}`} />
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }}
                      transition={{ duration: 0.15 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-2 pt-1 space-y-1.5 border-t border-border/[0.06]">
                        {item.steps.map(step => (
                          <AgenticStepRow key={step.id} step={step} />
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )
          }

          // Content block
          return (
            <div key={idx} className={[
              "px-4 py-3 text-xs leading-relaxed",
              idx > 0 ? "border-t border-border/10" : "",
            ].join(" ")}>
              {!item.text && item.streaming ? (
                <motion.span
                  animate={{ opacity: [0.3, 0.8, 0.3] }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  className="text-muted-foreground/40 text-[10px] font-mono"
                >
                  Composing response…
                </motion.span>
              ) : (
                <div className="space-y-1">
                  {renderContent(item.text)}
                  {item.streaming && item.text && (
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }}
                      className="inline-block w-[5px] h-[11px] bg-foreground/40 ml-px align-middle"
                    />
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}

// ── Sessions panel ────────────────────────────────────────────────────────────

function SessionsPanel({
  sessions, activeId, onSelect, onCreate, onDelete, onClose,
}: {
  sessions: Session[]
  activeId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/50 backdrop-blur-md z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.94, y: 12 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.94, y: 12 }}
        onClick={e => e.stopPropagation()}
        className="w-72 rounded-2xl border border-border/40 bg-card/96 backdrop-blur-2xl shadow-2xl overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30 bg-secondary/10">
          <div className="flex items-center gap-2">
            <History size={12} className="text-primary/70" />
            <span className="text-[10px] font-mono font-black uppercase tracking-[0.22em]">Sessions</span>
          </div>
          <button
            onClick={onCreate}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary/80 text-[9px] font-mono hover:bg-primary/20 transition-colors"
          >
            <Plus size={9} /> New
          </button>
        </div>
        <div className="max-h-72 overflow-y-auto divide-y divide-border/20 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-border/50">
          {sessions.map(s => (
            <div
              key={s.id}
              onClick={() => { onSelect(s.id); onClose() }}
              className={[
                "flex items-center gap-2 px-4 py-2.5 cursor-pointer transition-colors",
                s.id === activeId ? "bg-primary/8" : "hover:bg-secondary/30",
              ].join(" ")}
            >
              <MessageSquare size={11} className={s.id === activeId ? "text-primary/70" : "text-muted-foreground/30"} />
              <span className={[
                "flex-1 text-[10px] font-mono truncate",
                s.id === activeId ? "text-foreground font-semibold" : "text-muted-foreground/70",
              ].join(" ")}>
                {s.name}
              </span>
              <span className="text-[8.5px] font-mono text-muted-foreground/30">{s.messages.filter(m => m.role === "user").length} msgs</span>
              {sessions.length > 1 && (
                <button
                  onClick={e => { e.stopPropagation(); onDelete(s.id) }}
                  className="p-0.5 rounded hover:bg-red-500/15 text-muted-foreground/20 hover:text-red-400 transition-colors"
                >
                  <Trash2 size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

// ── ChatHub ────────────────────────────────────────────────────────────────────

interface ChatHubProps { model: string; models?: string[]; onModelChange?: (m: string) => void }

export function ChatHub({ model, models = [], onModelChange }: ChatHubProps) {
  const [sessions, setSessions] = useState<Session[]>(loadSessions)
  const [activeId, setActiveId] = useState(() => loadSessions()[0].id)
  const [display, setDisplay] = useState<DisplayMsg[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [following, setFollowing] = useState(true)
  const [routedModel, setRoutedModel] = useState<string | null>(null)
  const [showSessions, setShowSessions] = useState(false)
  // Agentic on by default unless explicitly disabled
  const [agentMode, setAgentMode] = useState(() => localStorage.getItem("mollama_agent_mode") !== "false")
  // Thinking mode for capable models (deepseek-r1, qwq, etc.)
  const [thinking, setThinking] = useState(false)
  // File / image attachments
  const [attachments, setAttachments] = useState<Array<{ type: "file" | "image"; name: string; content: string }>>([])
  const fileRef = useRef<HTMLInputElement>(null)
  const imgRef = useRef<HTMLInputElement>(null)

  useEffect(() => { localStorage.setItem("mollama_agent_mode", String(agentMode)) }, [agentMode])

  const { data: toolsData } = useTools()
  const { data: appSettings } = useAppSettings()
  const { data: ctxWindowRaw } = useModelContextLength(model)
  const hasTools = (toolsData?.tools?.length ?? 0) > 0

  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const isMollama = model === "mollama"
  // mollama natively routes tool calls — always use agentic endpoint when tools exist
  const useAgentic = hasTools && (agentMode || isMollama)
  // Thinking capability: deepseek-r1, qwq, qvq, and similar reasoning models
  const isThinkingModel = /\b(r1|qwq|qvq|think|reflect|reason)\b/i.test(model) && !useAgentic

  // ── Attachment handlers ────────────────────────────────────────────────────
  const handleFileAttach = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setAttachments(a => [...a, { type: "file", name: file.name, content: ev.target?.result as string }])
    }
    reader.readAsText(file)
    e.target.value = ""
  }, [])

  const handleImageAttach = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const dataUrl = ev.target?.result as string
      const base64 = dataUrl.split(",")[1]
      setAttachments(a => [...a, { type: "image", name: file.name, content: base64 }])
    }
    reader.readAsDataURL(file)
    e.target.value = ""
  }, [])

  const removeAttachment = useCallback((i: number) => {
    setAttachments(a => a.filter((_, idx) => idx !== i))
  }, [])

  const handleModelChange = useCallback((m: string) => {
    onModelChange?.(m)
    setRoutedModel(null)
  }, [onModelChange])

  const activeSession = useMemo(() => sessions.find(s => s.id === activeId) ?? sessions[0], [sessions, activeId])

  // Context window from Ollama, with fallback
  const CTX_WINDOW = ctxWindowRaw ?? 8192
  const autoCompactThreshold = (appSettings?.compression_threshold ?? 70) / 100
  const ctxTokens = useMemo(() => {
    const chars = activeSession.messages.reduce((n, m) => n + (m.content?.length ?? 0), 0)
    return Math.round(chars / 4)
  }, [activeSession.messages])
  const ctxPct = Math.min(ctxTokens / CTX_WINDOW, 1)
  const ctxOverThreshold = ctxPct >= autoCompactThreshold

  // Persist whenever sessions change
  useEffect(() => { saveSessions(sessions) }, [sessions])

  // Rebuild display from session messages when switching sessions
  useEffect(() => {
    if (activeSession.displays && activeSession.displays.length > 0) {
      // Restore full display (includes agentic cards with tool call history)
      setDisplay(activeSession.displays.map(d => {
        // Ensure no items are left streaming from a previous session
        if (d.kind === "agentic") return { ...d, streaming: false, items: d.items.map(i => i.kind === "content" ? { ...i, streaming: false } : i) }
        if (d.kind === "chat") return { ...d, streaming: false }
        return d
      }))
    } else {
      const rebuilt: DisplayMsg[] = []
      const msgs = activeSession.messages.filter(m => m.role === "user" || m.role === "assistant")
      for (const m of msgs) {
        rebuilt.push({ kind: "chat", role: m.role as "user" | "assistant", content: m.content })
      }
      setDisplay(rebuilt)
    }
    setRoutedModel(null)
  }, [activeId])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setFollowing(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }, [])

  useEffect(() => {
    if (following) scrollToBottom()
  }, [display, following, scrollToBottom])

  useEffect(() => { setRoutedModel(null) }, [model])

  const updateSession = useCallback((id: string, updater: (s: Session) => Session) => {
    setSessions(prev => {
      const updated = prev.map(s => s.id === id ? updater(s) : s)
      saveSessions(updated)
      return updated
    })
  }, [])

  const handleStop = useCallback(() => {
    abortRef.current?.abort()
    // Finalise any streaming display items
    setDisplay(prev => prev.map(d => {
      if (d.kind === "chat" && d.streaming) return { ...d, streaming: false }
      if (d.kind === "agentic" && d.streaming) return {
        ...d,
        streaming: false,
        items: d.items.map(i => i.kind === "content" ? { ...i, streaming: false } : i),
      }
      return d
    }))
    setIsLoading(false)
  }, [])

  // ── Slash command autocomplete ─────────────────────────────────────────────
  const [cmdIdx, setCmdIdx] = useState(0)

  const cmdMatches = useMemo(() => {
    if (!input.startsWith("/")) return []
    const q = input.slice(1).toLowerCase()
    if (q.includes(" ")) return []
    return SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q))
  }, [input])

  const showCmds = cmdMatches.length > 0 && !isLoading

  useEffect(() => { setCmdIdx(0) }, [cmdMatches.length])

  const applyCmd = useCallback((c: SlashCmd) => {
    if (c.action === "clear") {
      updateSession(activeId, s => ({ ...s, messages: [] }))
      setDisplay([])
      setInput("")
    } else if (c.action === "new") {
      const s = newSession()
      setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
      setActiveId(s.id)
      setDisplay([])
      setInput("")
    } else if (c.action === "compact") {
      setInput("")
      setSessions(prev => {
        const session = prev.find(s => s.id === activeId)
        if (!session || session.messages.length <= 3) {
          toast.info("Nothing to compact — fewer than 3 messages")
          return prev
        }
        setIsLoading(true)
        compactChatMessages(session.messages, model)
          .then(({ messages: compacted, compacted: didCompact }) => {
            if (didCompact) {
              const rebuilt: DisplayMsg[] = compacted
                .filter(m => m.role === "user" || m.role === "assistant")
                .map(m => ({ kind: "chat" as const, role: m.role as "user" | "assistant", content: m.content }))
              setSessions(p => {
                const updated = p.map(s => s.id === activeId ? { ...s, messages: compacted } : s)
                saveSessions(updated)
                return updated
              })
              setDisplay(rebuilt)
              toast.success("Context compacted")
            } else {
              toast.info("Nothing to compact")
            }
          })
          .catch(e => toast.error("Compact failed", { description: e.message }))
          .finally(() => setIsLoading(false))
        return prev
      })
    } else {
      setInput(c.cmd + " ")
    }
    setCmdIdx(0)
  }, [activeId, model, updateSession])

  const handleInputKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showCmds) return
    if (e.key === "ArrowDown") {
      e.preventDefault(); setCmdIdx(i => (i + 1) % cmdMatches.length)
    } else if (e.key === "ArrowUp") {
      e.preventDefault(); setCmdIdx(i => (i - 1 + cmdMatches.length) % cmdMatches.length)
    } else if (e.key === "Tab" || e.key === "Enter") {
      e.preventDefault(); applyCmd(cmdMatches[Math.min(cmdIdx, cmdMatches.length - 1)])
    } else if (e.key === "Escape") {
      setInput(""); setCmdIdx(0)
    }
  }, [showCmds, cmdMatches, cmdIdx, applyCmd])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userText = input.trim()
    setInput("")
    setIsLoading(true)
    setFollowing(true)
    if (isMollama) setRoutedModel(null)

    // Capture current messages (may be updated by auto-compact below)
    let currentMessages = activeSession.messages

    // Auto-compact when context window exceeds threshold and compression is enabled
    if (appSettings?.context_compression && ctxOverThreshold && currentMessages.length > 3) {
      try {
        const { messages: compacted, compacted: didCompact } = await compactChatMessages(currentMessages, model)
        if (didCompact) {
          const rebuilt: DisplayMsg[] = compacted
            .filter(m => m.role === "user" || m.role === "assistant")
            .map(m => ({ kind: "chat" as const, role: m.role as "user" | "assistant", content: m.content }))
          setSessions(prev => {
            const updated = prev.map(s => s.id === activeId ? { ...s, messages: compacted } : s)
            saveSessions(updated)
            return updated
          })
          setDisplay(rebuilt)
          currentMessages = compacted  // use compacted messages for send
          toast.success("Context auto-compacted", { description: "History summarised to stay within limits." })
        }
      } catch {
        // Non-fatal — continue with send using original messages
      }
    }

    // Build message with optional file content + images
    const fileTexts = attachments.filter(a => a.type === "file")
      .map(a => `\n\n---\n**${a.name}**\n\`\`\`\n${a.content}\n\`\`\``).join("")
    const images = attachments.filter(a => a.type === "image").map(a => a.content)
    setAttachments([])

    const userMsg: ChatMessage = {
      role: "user",
      content: userText + fileTexts,
      ...(images.length > 0 && { images }),
    }
    const newMessages = [...currentMessages, userMsg]

    updateSession(activeId, s => ({
      ...s,
      name: s.messages.length === 0 ? userText.slice(0, 30) : s.name,
      messages: newMessages,
    }))

    setDisplay(prev => [...prev, { kind: "chat", role: "user", content: userText }])

    const ctrl = new AbortController()
    abortRef.current = ctrl

    if (useAgentic) {
      setDisplay(prev => [...prev, { kind: "agentic", items: [], streaming: true }])

      try {
        // Mutable items array — updated on each event then pushed to React state
        let agenticItems: AgenticItem[] = []

        // Captures agenticItems by value at call site to avoid closure staleness
        const pushDisplay = (items: AgenticItem[], streaming: boolean) => {
          const snapshot = [...items]
          setDisplay(prev => {
            const next = [...prev]
            const idx = next.findLastIndex(d => d.kind === "agentic")
            if (idx >= 0) next[idx] = { kind: "agentic", items: snapshot, streaming }
            return next
          })
        }

        for await (const ev of sendAgenticMessage(newMessages, model, ctrl.signal)) {
          if (ctrl.signal.aborted) break

          if (ev.type === "delta") {
            // Append to last streaming content block (or start a new one)
            const last = agenticItems[agenticItems.length - 1]
            if (last?.kind === "content" && last.streaming) {
              agenticItems = [...agenticItems.slice(0, -1), { kind: "content", text: last.text + ev.text, streaming: true }]
            } else {
              agenticItems = [...agenticItems, { kind: "content", text: ev.text, streaming: true }]
            }
            pushDisplay(agenticItems, true)

          } else if (ev.type === "content_done") {
            // Intermediate content before tool calls — mark block as not streaming
            const last = agenticItems[agenticItems.length - 1]
            if (last?.kind === "content") {
              agenticItems = [...agenticItems.slice(0, -1), { kind: "content", text: ev.text, streaming: false }]
            } else {
              agenticItems = [...agenticItems, { kind: "content", text: ev.text, streaming: false }]
            }
            pushDisplay(agenticItems, true)

          } else if (ev.type === "tool_call") {
            // Add step to last tool group, or create a new group
            const last = agenticItems[agenticItems.length - 1]
            const newStep: AgenticStep = { id: ev.id, name: ev.name, args: ev.args }
            if (last?.kind === "tools") {
              agenticItems = [...agenticItems.slice(0, -1), { kind: "tools", steps: [...last.steps, newStep] }]
            } else {
              agenticItems = [...agenticItems, { kind: "tools", steps: [newStep] }]
            }
            pushDisplay(agenticItems, true)

          } else if (ev.type === "tool_result") {
            // Update matching step in the last tool group
            const lastToolIdx = agenticItems.map((it, i) => it.kind === "tools" ? i : -1).filter(i => i >= 0).pop() ?? -1
            if (lastToolIdx >= 0) {
              const group = agenticItems[lastToolIdx] as AgenticToolGroup
              agenticItems = [
                ...agenticItems.slice(0, lastToolIdx),
                { kind: "tools", steps: group.steps.map(s => s.id === ev.id ? { ...s, result: ev.result, ok: ev.ok } : s) },
                ...agenticItems.slice(lastToolIdx + 1),
              ]
            }
            pushDisplay(agenticItems, true)

          } else if (ev.type === "done") {
            // Final response — close streaming content block or create one
            const last = agenticItems[agenticItems.length - 1]
            if (last?.kind === "content" && last.streaming) {
              agenticItems = [...agenticItems.slice(0, -1), { kind: "content", text: ev.text, streaming: false }]
            } else if (ev.text) {
              agenticItems = [...agenticItems, { kind: "content", text: ev.text, streaming: false }]
            }
            if (isMollama && ev.model) setRoutedModel(ev.model)
            pushDisplay(agenticItems, false)

          } else if (ev.type === "error") {
            const errText = `⚠ ${ev.error}`
            const last = agenticItems[agenticItems.length - 1]
            if (last?.kind === "content" && last.streaming) {
              agenticItems = [...agenticItems.slice(0, -1), { kind: "content", text: errText, streaming: false }]
            } else {
              agenticItems = [...agenticItems, { kind: "content", text: errText, streaming: false }]
            }
            pushDisplay(agenticItems, false)
          }
        }

        // Compose final text from all content blocks for session history
        const finalItems: AgenticItem[] = agenticItems.map(i =>
          i.kind === "content" ? { ...i, streaming: false } : i
        )
        const finalContent = finalItems
          .filter(i => i.kind === "content")
          .map(i => (i as AgenticContentBlock).text)
          .filter(Boolean)
          .join("\n\n")

        // Save display + messages to session (updateSession inside setDisplay to get latest prev)
        setDisplay(prev => {
          const finalDisplay: DisplayMsg[] = prev.map(d =>
            d.kind === "agentic" && d.streaming
              ? { kind: "agentic", items: finalItems, streaming: false }
              : d
          )
          updateSession(activeId, s => ({
            ...s,
            messages: finalContent ? [...newMessages, { role: "assistant" as const, content: finalContent }] : newMessages,
            displays: finalDisplay,
          }))
          return finalDisplay
        })

      } catch (err: any) {
        setDisplay(prev => {
          const next = [...prev]
          const idx = next.findLastIndex(d => d.kind === "agentic")
          if (idx >= 0) {
            const d = next[idx] as Extract<DisplayMsg, { kind: "agentic" }>
            if (err.name !== "AbortError") {
              const errItem: AgenticContentBlock = { kind: "content", text: `Error: ${err.message}`, streaming: false }
              next[idx] = { ...d, items: [...d.items, errItem], streaming: false }
            } else {
              next[idx] = { ...d, streaming: false }
            }
          }
          return next
        })
      }
    } else {
      // Normal streaming mode
      setDisplay(prev => [...prev, { kind: "chat", role: "assistant", content: "", streaming: true }])

      try {
        let assistantContent = ""
        let modelCaptured = false

        for await (const chunk of sendChatMessage(newMessages, model, ctrl.signal, { think: thinking && isThinkingModel })) {
          if (ctrl.signal.aborted) break
          if (chunk.model && !modelCaptured) {
            if (isMollama) setRoutedModel(chunk.model)
            modelCaptured = true
          }
          if (chunk.content) {
            assistantContent += chunk.content
            setDisplay(prev => {
              const next = [...prev]
              const lastIdx = next.findLastIndex(d => d.kind === "chat" && d.role === "assistant" && d.streaming)
              if (lastIdx >= 0) next[lastIdx] = { kind: "chat", role: "assistant", content: assistantContent, streaming: true }
              return next
            })
          }
        }

        setDisplay(prev => prev.map(d =>
          d.kind === "chat" && d.role === "assistant" && d.streaming ? { ...d, streaming: false } : d
        ))

        if (assistantContent) {
          updateSession(activeId, s => ({
            ...s,
            messages: [...s.messages, { role: "assistant", content: assistantContent }],
          }))
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          setDisplay(prev => prev.map(d =>
            d.kind === "chat" && d.role === "assistant" && d.streaming
              ? { kind: "chat", role: "assistant", content: `Error: ${err.message}` }
              : d
          ))
        } else {
          setDisplay(prev => prev.map(d =>
            d.kind === "chat" && d.role === "assistant" && d.streaming ? { ...d, streaming: false } : d
          ))
        }
      }
    }

    setIsLoading(false)
  }

  const handleNewSession = useCallback(() => {
    const s = newSession()
    setSessions(prev => { const next = [...prev, s]; saveSessions(next); return next })
    setActiveId(s.id)
    setDisplay([])
    setShowSessions(false)
  }, [])

  const handleDeleteSession = useCallback((id: string) => {
    setSessions(prev => {
      if (prev.length <= 1) return prev
      const next = prev.filter(s => s.id !== id)
      saveSessions(next)
      if (id === activeId) setActiveId(next[0].id)
      return next
    })
  }, [activeId])

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <MessageSquare size={13} className="text-primary/70" />
          <button
            onClick={() => setShowSessions(true)}
            className="flex items-center gap-1.5 hover:text-foreground text-foreground/80 transition-colors"
          >
            <span className="text-[10px] font-mono font-black uppercase tracking-widest truncate max-w-32">
              {activeSession.name}
            </span>
            <ChevronDown size={10} className="text-muted-foreground/40" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Agentic mode toggle */}
          {hasTools && (
            <button
              onClick={() => setAgentMode(a => !a)}
              title={agentMode ? "Agentic on — click to disable" : "Enable agentic mode (tools)"}
              className={[
                "flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[9px] font-mono font-bold uppercase tracking-widest transition-all",
                agentMode
                  ? "bg-primary/10 border-primary/25 text-primary"
                  : "border-border/20 text-muted-foreground/30 hover:text-muted-foreground/60 hover:border-border/40",
              ].join(" ")}
            >
              <Wrench size={9} />
              Agentic
            </button>
          )}

          {isMollama && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400/80"
            >
              <Brain size={9} />
              <span className="text-[9px] font-mono font-black uppercase tracking-widest">Smart</span>
            </motion.div>
          )}

          <ModelPicker
            model={model}
            models={models}
            routedModel={routedModel}
            isLoading={isLoading}
            isMollama={isMollama}
            onModelChange={handleModelChange}
          />

          <button
            onClick={handleNewSession}
            title="New chat"
            className="p-1 rounded-lg hover:bg-secondary/40 text-muted-foreground/30 hover:text-foreground transition-colors"
          >
            <Plus size={12} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} className={SCROLL_CLS}>
          <div className="p-4 space-y-3">
            {display.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/20 text-[10px] font-mono uppercase gap-3">
                <MessageSquare size={22} className="opacity-30" />
                <span>Awaiting Input...</span>
                {isMollama && (
                  <div className="flex items-center gap-1.5 text-amber-400/20">
                    <Brain size={10} />
                    <span className="text-[9px]">Smart routing enabled</span>
                  </div>
                )}
                {useAgentic && (
                  <div className="flex items-center gap-1.5 text-primary/20">
                    <Wrench size={10} />
                    <span className="text-[9px]">Agentic mode — tools active</span>
                  </div>
                )}
              </div>
            )}

            <AnimatePresence initial={false}>
              {display.map((msg, idx) => {
                // Agentic response — collapsible thought process card
                if (msg.kind === "agentic") {
                  return <AgenticResponseCard key={`agentic-${idx}`} msg={msg} />
                }

                // User / plain assistant chat
                const isStreaming = msg.streaming && idx === display.length - 1
                if (msg.role === "user") {
                  return (
                    <motion.div key={idx}
                      initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{ duration: 0.18 }}
                      className="flex justify-end"
                    >
                      <div className="max-w-[80%] rounded-2xl rounded-tr-none px-4 py-2.5 text-xs leading-relaxed shadow-sm bg-primary text-primary-foreground">
                        <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      </div>
                    </motion.div>
                  )
                }

                // Assistant message (non-agentic)
                return (
                  <motion.div key={idx}
                    initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.18 }}
                    className="flex justify-start"
                  >
                    <div className="max-w-[88%] rounded-2xl rounded-tl-none px-4 py-3 text-xs leading-relaxed shadow-sm bg-secondary/40 border border-border/10 backdrop-blur-md">
                      {isStreaming ? (
                        <>
                          {msg.content
                            ? <div className="space-y-1">{renderContent(msg.content)}
                                <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }}
                                  className="inline-block w-[5px] h-[11px] bg-foreground/40 ml-px align-middle" />
                              </div>
                            : <motion.span animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 1, repeat: Infinity }}
                                className="text-muted-foreground/40 text-[10px] font-mono">
                                {isMollama ? "Selecting model…" : "Thinking…"}
                              </motion.span>
                          }
                        </>
                      ) : (
                        <div className="space-y-1">{renderContent(msg.content)}</div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>

        <AnimatePresence>
          {!following && (
            <motion.button initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
              onClick={() => { setFollowing(true); scrollToBottom() }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1 rounded border border-primary/25 bg-background/90 backdrop-blur-sm text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors shadow-lg">
              <ArrowDown size={9} /> Follow
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* Context indicator */}
      {activeSession.messages.length > 0 && (
        <div className="shrink-0 px-3 pt-1.5 pb-0">
          <div className="flex items-center gap-2">
            <Activity size={9} className={ctxOverThreshold ? "text-amber-400/60" : "text-muted-foreground/20"} />
            <div className="flex-1 h-[2px] rounded-full bg-border/15 overflow-hidden">
              <motion.div
                animate={{ width: `${ctxPct * 100}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className={[
                  "h-full rounded-full",
                  ctxPct < 0.5 ? "bg-primary/30"
                    : ctxPct < autoCompactThreshold ? "bg-amber-500/40"
                    : "bg-amber-500/70",
                ].join(" ")}
              />
            </div>
            <span className={[
              "text-[7.5px] font-mono tabular-nums shrink-0",
              ctxOverThreshold ? "text-amber-400/70" : "text-muted-foreground/25",
            ].join(" ")}>
              {ctxTokens.toLocaleString()}/{ctxWindowRaw ? CTX_WINDOW.toLocaleString() : "…"}
              {ctxOverThreshold && appSettings?.context_compression && " · auto"}
            </span>
          </div>
        </div>
      )}

      {/* Input */}
      <div className="shrink-0 border-t border-border/30 px-3 pt-2.5 pb-3 bg-gradient-to-t from-background/60 to-transparent">
        {/* Attachment chips */}
        <AnimatePresence>
          {attachments.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-2"
            >
              <div className="flex items-center gap-1.5 flex-wrap pb-1">
                {attachments.map((a, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.85, opacity: 0 }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-lg border border-border/25 bg-secondary/20 text-[9px] font-mono text-muted-foreground/70 group"
                  >
                    {a.type === "image"
                      ? <ImagePlus size={9} className="text-primary/50 shrink-0" />
                      : <FileText size={9} className="text-muted-foreground/40 shrink-0" />
                    }
                    <span className="max-w-[100px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(i)}
                      className="text-muted-foreground/30 hover:text-foreground transition-colors shrink-0"
                    >
                      <XIcon size={9} />
                    </button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="relative">
          <AnimatePresence>
            {showCmds && (
              <SlashCommandPicker
                matches={cmdMatches}
                activeIdx={Math.min(cmdIdx, cmdMatches.length - 1)}
                onSelect={applyCmd}
              />
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="flex items-center gap-2">
            {/* Accessory buttons */}
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title="Attach file"
                className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
              >
                <Paperclip size={13} />
              </button>
              <button
                type="button"
                onClick={() => imgRef.current?.click()}
                title="Attach image"
                className="p-1.5 rounded-lg text-muted-foreground/30 hover:text-muted-foreground/70 hover:bg-secondary/40 transition-colors"
              >
                <ImagePlus size={13} />
              </button>
              {isThinkingModel && (
                <button
                  type="button"
                  onClick={() => setThinking(t => !t)}
                  title={thinking ? "Thinking enabled — click to disable" : "Enable extended thinking"}
                  className={[
                    "p-1.5 rounded-lg transition-all",
                    thinking
                      ? "text-amber-400 bg-amber-500/10 ring-1 ring-amber-500/20"
                      : "text-muted-foreground/30 hover:text-amber-400/70 hover:bg-amber-500/8",
                  ].join(" ")}
                >
                  <Lightbulb size={13} />
                </button>
              )}
            </div>

            {/* Hidden file inputs */}
            <input ref={fileRef} type="file" className="hidden" onChange={handleFileAttach}
              accept=".txt,.md,.py,.js,.ts,.json,.yaml,.yml,.toml,.sh,.csv,.xml,.html,.css,.env,.cfg,.ini" />
            <input ref={imgRef} type="file" className="hidden" accept="image/*" onChange={handleImageAttach} />

            {/* Text input */}
            <div className="relative flex-1">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleInputKeyDown}
                placeholder={
                  useAgentic
                    ? "Ask anything — tools available…"
                    : isMollama
                      ? "Ask anything — best model auto-selected…"
                      : "Type / for commands…"
                }
                disabled={isLoading}
                className="w-full h-10 px-3 text-xs rounded-xl bg-background/50 border border-border/40 focus:outline-none focus:ring-1 focus:ring-primary/40 focus:border-primary/30 placeholder:text-muted-foreground/25 transition-all disabled:opacity-50"
              />
            </div>

            {/* Send / Stop */}
            {isLoading ? (
              <Button
                type="button" onClick={handleStop} size="icon"
                className="h-10 w-10 shrink-0 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-white/[0.07] text-zinc-300 hover:text-white transition-all duration-200 active:scale-90"
                title="Stop generation"
              >
                <Square size={12} fill="currentColor" />
              </Button>
            ) : (
              <Button
                type="submit" disabled={!input.trim() && attachments.length === 0} size="icon"
                className="h-10 w-10 shrink-0 rounded-xl bg-primary hover:bg-primary/80 transition-all duration-200 active:scale-90"
              >
                {useAgentic ? <Zap size={15} /> : isMollama ? <Brain size={15} /> : <Send size={15} />}
              </Button>
            )}
          </form>
        </div>
      </div>

      <AnimatePresence>
        {showSessions && (
          <SessionsPanel
            sessions={sessions}
            activeId={activeId}
            onSelect={setActiveId}
            onCreate={handleNewSession}
            onDelete={handleDeleteSession}
            onClose={() => setShowSessions(false)}
          />
        )}
      </AnimatePresence>
    </Card>
  )
}
