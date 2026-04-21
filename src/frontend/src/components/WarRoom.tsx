import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Swords, RotateCcw, Play, CheckCircle2, Loader2,
  Users, AlertTriangle, ChevronDown, ChevronUp, Copy, Check,
  MessageSquare, Minimize2, Maximize2,
} from "lucide-react"
import { runWarRoom, fetchAgents, type Agent, type WarRoomEvent } from "@/lib/api"
import { toast } from "sonner"

// ── Scrollbar ────────────────────────────────────────────────────────────────

const SB = "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full overflow-y-auto"

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentRound {
  name: string
  round: number
  text: string
  status: "idle" | "thinking" | "done" | "error"
}

// ── Markdown renderer ────────────────────────────────────────────────────────

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }
  return (
    <button onClick={copy} className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase tracking-wider border border-border/20 bg-background/30 text-muted-foreground hover:text-foreground transition-colors">
      {copied ? <Check size={8} className="text-emerald-400" /> : <Copy size={8} />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function renderMd(text: string) {
  const parts: React.ReactNode[] = []
  const codeBlockRx = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0, i = 0, m: RegExpExecArray | null

  while ((m = codeBlockRx.exec(text)) !== null) {
    const before = text.slice(last, m.index)
    if (before) parts.push(<InlineMd key={`t${i++}`} text={before} />)
    const lang = m[1] || "code"
    const code = m[2]
    parts.push(
      <div key={`c${i++}`} className="my-2 rounded-xl border border-border/25 overflow-hidden bg-background/60">
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/20 bg-secondary/15">
          <span className="text-[8.5px] font-mono uppercase tracking-wider text-muted-foreground">{lang}</span>
          <CopyBtn text={code} />
        </div>
        <pre className={`px-3 py-2.5 text-[10px] font-mono text-foreground/80 overflow-x-auto leading-relaxed ${SB}`}>{code}</pre>
      </div>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(<InlineMd key={`t${i++}`} text={text.slice(last)} />)
  return <>{parts}</>
}

function InlineMd({ text }: { text: string }) {
  const lines = text.split("\n")
  return (
    <>
      {lines.map((line, i) => {
        const isH2 = line.startsWith("## ")
        const isH3 = line.startsWith("### ")
        const isBullet = /^[-*] /.test(line)
        const isNum = /^\d+\. /.test(line)
        const bold = (s: string) => s.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-secondary/40 text-[9.5px] font-mono text-primary/80">$1</code>')
        if (isH2) return <div key={i} className="text-[12px] font-semibold text-foreground/90 mt-3 mb-1" dangerouslySetInnerHTML={{ __html: bold(line.slice(3)) }} />
        if (isH3) return <div key={i} className="text-[11px] font-semibold text-foreground/85 mt-2 mb-0.5" dangerouslySetInnerHTML={{ __html: bold(line.slice(4)) }} />
        if (isBullet) return <div key={i} className="flex gap-1.5 my-0.5"><span className="text-primary/50 mt-[3px] shrink-0">•</span><span className="text-[11px] text-foreground/80 leading-relaxed" dangerouslySetInnerHTML={{ __html: bold(line.slice(2)) }} /></div>
        if (isNum) return <div key={i} className="flex gap-1.5 my-0.5"><span className="text-primary/50 mt-[3px] shrink-0 tabular-nums text-[10px]">{line.match(/^\d+/)![0]}.</span><span className="text-[11px] text-foreground/80 leading-relaxed" dangerouslySetInnerHTML={{ __html: bold(line.replace(/^\d+\. /, "")) }} /></div>
        if (!line.trim()) return <div key={i} className="h-2" />
        return <p key={i} className="text-[11px] text-foreground/80 leading-relaxed my-0.5" dangerouslySetInnerHTML={{ __html: bold(line) }} />
      })}
    </>
  )
}

// ── Cursor ───────────────────────────────────────────────────────────────────

function Cursor() {
  return (
    <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }}
      className="inline-block w-[4px] h-[10px] bg-foreground/40 ml-px align-middle" />
  )
}

// ── Agent chip ───────────────────────────────────────────────────────────────

function AgentChip({ agent, selected, disabled, onToggle }: { agent: Agent; selected: boolean; disabled: boolean; onToggle: () => void }) {
  return (
    <button type="button" disabled={disabled} onClick={onToggle}
      className={[
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-mono uppercase tracking-widest transition-all select-none shrink-0",
        selected ? "border-primary/40 bg-primary/10 text-primary" : "border-border/25 text-muted-foreground/40 hover:border-border/50 hover:text-muted-foreground/70",
        disabled ? "opacity-50 pointer-events-none" : "",
      ].join(" ")}>
      <span className={["size-1.5 rounded-full shrink-0", selected ? "bg-primary" : "bg-muted-foreground/30"].join(" ")} />
      {agent.name}
    </button>
  )
}

// ── Debate message card ───────────────────────────────────────────────────────

function DebateCard({ item, roundLabel }: { item: AgentRound; roundLabel?: string }) {
  const [expanded, setExpanded] = useState(true)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current && item.status === "thinking") bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [item.text, item.status])

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18 }}
      className="border border-border/30 rounded-xl overflow-hidden bg-card/20"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 bg-secondary/8 border-b border-border/20">
        {roundLabel && <span className="text-[7.5px] font-mono uppercase tracking-[0.22em] text-primary/50 shrink-0">{roundLabel}</span>}
        <span className="flex-1 text-[9.5px] font-mono font-black uppercase tracking-widest text-foreground/75 truncate">{item.name}</span>
        <div className="flex items-center gap-1">
          {item.status === "thinking" && <Loader2 size={8} className="animate-spin text-amber-400/60" />}
          {item.status === "done" && <CheckCircle2 size={8} className="text-emerald-400/60" />}
          {item.status === "error" && <AlertTriangle size={8} className="text-red-400/60" />}
          <span className={`text-[8px] font-mono uppercase tracking-widest ${item.status === "done" ? "text-emerald-400/50" : item.status === "error" ? "text-red-400/50" : "text-amber-400/50"}`}>
            {item.status === "done" ? "done" : item.status === "error" ? "error" : "…"}
          </span>
          <button onClick={() => setExpanded(e => !e)} className="ml-1 text-muted-foreground/30 hover:text-muted-foreground transition-colors">
            {expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden">
            <div ref={bodyRef} className={`px-3 py-2.5 max-h-40 ${SB}`}>
              {item.text ? (
                <div className="text-[11px] font-mono text-foreground/75 leading-relaxed whitespace-pre-wrap break-words">
                  {item.text}
                  {item.status === "thinking" && <Cursor />}
                </div>
              ) : item.status === "thinking" ? (
                <motion.span animate={{ opacity: [0.2, 0.7, 0.2] }} transition={{ duration: 1.4, repeat: Infinity }}
                  className="text-[10px] font-mono text-muted-foreground/35">composing…</motion.span>
              ) : null}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Final output card ─────────────────────────────────────────────────────────

function FinalCard({ item }: { item: AgentRound }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="border border-primary/20 rounded-xl overflow-hidden bg-primary/4"
    >
      <div className="flex items-center gap-2 px-3 py-2 bg-primary/8 border-b border-primary/15">
        <CheckCircle2 size={10} className="text-primary/60 shrink-0" />
        <span className="flex-1 text-[9.5px] font-mono font-black uppercase tracking-widest text-foreground/80">{item.name}</span>
        <CopyBtn text={item.text} />
      </div>
      <div className={`px-3 py-3 max-h-64 ${SB}`}>
        <div className="text-[11px] leading-relaxed">
          {renderMd(item.text)}
        </div>
      </div>
    </motion.div>
  )
}

// ── Main ─────────────────────────────────────────────────────────────────────

export function WarRoom() {
  const [prompt, setPrompt] = useState("")
  const [rounds, setRounds] = useState(2)
  const [agents, setAgents] = useState<Agent[]>([])
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set())
  const [loadingAgents, setLoadingAgents] = useState(true)

  // Debate log: all rounds' messages
  const [debateLog, setDebateLog] = useState<AgentRound[]>([])
  const [currentRound, setCurrentRound] = useState(0)
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [debateMinimized, setDebateMinimized] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const formRef = useRef<HTMLFormElement>(null)

  useEffect(() => {
    fetchAgents()
      .then(list => {
        const enabled = list.filter(a => a.enabled !== false)
        setAgents(enabled)
        setSelectedNames(new Set(enabled.map(a => a.name)))
      })
      .catch(() => toast.error("Failed to load agents"))
      .finally(() => setLoadingAgents(false))
  }, [])

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }, [prompt])

  const toggleAgent = useCallback((name: string) => {
    setSelectedNames(prev => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }, [])

  const handleClear = useCallback(() => {
    abortRef.current?.abort()
    setDebateLog([])
    setCurrentRound(0)
    setFinished(false)
    setRunning(false)
    setPrompt("")
    setDebateMinimized(false)
  }, [])

  // Run a single round of the war room
  const runRound = useCallback(async (
    roundNum: number,
    question: string,
    ctrl: AbortController,
  ) => {
    const selected = agents.filter(a => selectedNames.has(a.name))
    setCurrentRound(roundNum)

    // Add initial idle entries for this round
    const initEntries: AgentRound[] = selected.map(a => ({
      name: a.name, round: roundNum, text: "", status: "idle",
    }))
    setDebateLog(prev => [...prev, ...initEntries])

    const updateEntry = (name: string, round: number, updater: (e: AgentRound) => AgentRound) => {
      setDebateLog(prev => prev.map(e => e.name === name && e.round === round ? updater(e) : e))
    }

    for await (const ev of runWarRoom(question, selected.map(a => a.name))) {
      if (ctrl.signal.aborted) return false
      if (ev.type === "agent_start") {
        updateEntry(ev.agent, roundNum, e => ({ ...e, status: "thinking" }))
      } else if (ev.type === "delta") {
        updateEntry(ev.agent, roundNum, e => ({ ...e, text: e.text + ev.text }))
      } else if (ev.type === "agent_done") {
        updateEntry(ev.agent, roundNum, e => ({ ...e, status: "done", text: ev.text || e.text }))
      } else if (ev.type === "error") {
        setDebateLog(prev => prev.map(e => e.round === roundNum && e.status === "thinking" ? { ...e, status: "error" } : e))
        toast.error("War Room error", { description: (ev as any).error })
        return false
      } else if (ev.type === "done") {
        setDebateLog(prev => prev.map(e => e.round === roundNum && e.status === "thinking" ? { ...e, status: "done" } : e))
        return true
      }
    }
    return true
  }, [agents, selectedNames])

  const handleConvene = useCallback(async () => {
    const q = prompt.trim()
    if (!q) { toast.error("Enter a prompt first"); return }
    if (selectedNames.size === 0) { toast.error("Select at least one agent"); return }

    setDebateLog([])
    setCurrentRound(0)
    setFinished(false)
    setRunning(true)
    setDebateMinimized(false)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      let prevContext = ""

      for (let r = 1; r <= rounds; r++) {
        let question = q
        if (r > 1 && prevContext) {
          question = `Original question: ${q}\n\nPrevious round responses:\n${prevContext}\n\nGiven the above responses, provide your refined position or rebuttal:`
        }

        const ok = await runRound(r, question, ctrl)
        if (!ok || ctrl.signal.aborted) break

        // Build context for next round using setState callback to get fresh state
        await new Promise<void>(resolve => {
          setDebateLog(prev => {
            const entries = prev.filter(e => e.round === r)
            prevContext = entries.map(e => `${e.name}: ${e.text}`).join("\n\n")
            resolve()
            return prev
          })
        })
      }

      if (!ctrl.signal.aborted) {
        setFinished(true)
        setDebateMinimized(rounds > 1) // Auto-minimize debate if multi-round
      }
    } catch (err: any) {
      if (err.name !== "AbortError") {
        toast.error("War Room failed", { description: err.message })
      }
    } finally {
      setRunning(false)
    }
  }, [prompt, selectedNames, rounds, runRound])

  // Get final round entries (for display)
  const finalRoundEntries = debateLog.filter(e => e.round === currentRound && (e.status === "done" || e.status === "error"))
  const lastRound = Math.max(0, ...debateLog.map(e => e.round))
  const finalEntries = debateLog.filter(e => e.round === lastRound && e.text)

  const allDone = running === false && finished

  // Group debate log by round
  const byRound = debateLog.reduce<Record<number, AgentRound[]>>((acc, e) => {
    if (!acc[e.round]) acc[e.round] = []
    acc[e.round].push(e)
    return acc
  }, {})

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!running && prompt.trim() && selectedNames.size > 0) formRef.current?.requestSubmit()
    }
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-card/10 rounded-xl border border-border/25">

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center gap-2.5 px-4 py-2.5 border-b border-border/30 bg-secondary/8">
        <Swords size={12} className="text-primary/60 shrink-0" />
        <span className="text-[10px] font-mono font-black uppercase tracking-[0.25em] text-foreground/80">War Room</span>
        {running && (
          <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}
            className="text-[8.5px] font-mono uppercase tracking-widest text-amber-400/60">
            Round {currentRound} / {rounds}
          </motion.span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {debateLog.length > 0 && !running && (
            <button onClick={handleClear}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-border/20 text-muted-foreground/40 hover:text-foreground hover:border-border/50 text-[8.5px] font-mono uppercase tracking-widest transition-colors">
              <RotateCcw size={8} /> Reset
            </button>
          )}
          {running && (
            <button onClick={() => { abortRef.current?.abort(); setRunning(false) }}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-red-500/20 bg-red-500/6 text-red-400 text-[8.5px] font-mono uppercase tracking-widest transition-colors hover:bg-red-500/12">
              Stop
            </button>
          )}
        </div>
      </div>

      {/* ── Prompt area ── */}
      <form ref={formRef} onSubmit={e => { e.preventDefault(); handleConvene() }}
        className="shrink-0 border-b border-border/20 bg-secondary/5">
        <div className="px-3 pt-3 pb-2">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={running}
            rows={1}
            placeholder="Pose a question for all agents to debate and iterate on…"
            className={`w-full resize-none rounded-xl px-3 py-2.5 text-[11px] font-mono bg-background/40 border border-border/30 focus:border-primary/35 focus:ring-1 focus:ring-primary/20 placeholder:text-muted-foreground/25 text-foreground/85 outline-none transition-all leading-relaxed disabled:opacity-50 overflow-hidden ${SB}`}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-2 px-3 pb-2.5 flex-wrap">
          {/* Agents */}
          <div className="flex items-center gap-1.5 shrink-0">
            <Users size={8} className="text-muted-foreground/30" />
            <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30">Agents</span>
          </div>
          {loadingAgents ? (
            <span className="text-[8.5px] font-mono text-muted-foreground/25 animate-pulse">Loading…</span>
          ) : agents.length === 0 ? (
            <span className="text-[8.5px] font-mono text-muted-foreground/30">No agents configured</span>
          ) : (
            agents.map(a => (
              <AgentChip key={a.name} agent={a} selected={selectedNames.has(a.name)} disabled={running} onToggle={() => toggleAgent(a.name)} />
            ))
          )}

          {/* Rounds selector */}
          <div className="ml-auto flex items-center gap-1.5 shrink-0">
            <span className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30">Rounds</span>
            {[1, 2, 3].map(n => (
              <button key={n} type="button" onClick={() => setRounds(n)} disabled={running}
                className={`w-6 h-6 rounded-lg border text-[9px] font-mono font-black transition-all disabled:opacity-50 ${rounds === n ? "bg-primary/15 border-primary/35 text-primary" : "border-border/25 text-muted-foreground/40 hover:border-border/50 hover:text-muted-foreground"}`}>
                {n}
              </button>
            ))}
            <button type="submit" disabled={running || !prompt.trim() || selectedNames.size === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[9px] font-mono font-black uppercase tracking-wider disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-all active:scale-95 ml-1">
              {running ? <Loader2 size={9} className="animate-spin" /> : <Play size={9} />}
              Convene
            </button>
          </div>
        </div>
      </form>

      {/* ── Content area ── */}
      <div className={`flex-1 min-h-0 flex flex-col overflow-hidden ${SB}`}>

        {debateLog.length === 0 && !running ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <motion.div animate={{ opacity: [0.25, 0.5, 0.25], scale: [1, 1.04, 1] }} transition={{ duration: 3.5, repeat: Infinity }}>
              <Swords size={28} className="text-muted-foreground/20" />
            </motion.div>
            <div className="space-y-1">
              <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground/25">Awaiting the convening…</p>
              <p className="text-[9px] font-mono text-muted-foreground/18">Pose a prompt · select agents · set rounds · press Convene</p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-3 flex-1">

            {/* ── Final output (shown when done) ── */}
            <AnimatePresence>
              {allDone && finalEntries.length > 0 && (
                <motion.div key="final" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2">
                  <div className="flex items-center gap-2 pb-1">
                    <div className="h-px flex-1 bg-primary/15" />
                    <span className="text-[8px] font-mono font-black uppercase tracking-[0.28em] text-primary/50">Final Output</span>
                    <div className="h-px flex-1 bg-primary/15" />
                  </div>
                  {finalEntries.map(e => <FinalCard key={e.name} item={e} />)}
                </motion.div>
              )}
            </AnimatePresence>

            {/* ── Debate process (minimizable) ── */}
            {debateLog.length > 0 && (
              <div className="border border-border/25 rounded-xl overflow-hidden">
                <button type="button" onClick={() => setDebateMinimized(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-secondary/8 hover:bg-secondary/15 transition-colors">
                  <MessageSquare size={9} className="text-muted-foreground/40" />
                  <span className="text-[9px] font-mono font-black uppercase tracking-[0.22em] text-muted-foreground/50 flex-1 text-left">
                    Debate Process {running ? `(Round ${currentRound}/${rounds})` : `(${Object.keys(byRound).length} round${Object.keys(byRound).length !== 1 ? "s" : ""})`}
                  </span>
                  {running && <Loader2 size={8} className="animate-spin text-amber-400/50" />}
                  {debateMinimized ? <Maximize2 size={9} className="text-muted-foreground/30" /> : <Minimize2 size={9} className="text-muted-foreground/30" />}
                </button>
                <AnimatePresence initial={false}>
                  {!debateMinimized && (
                    <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                      <div className="p-2.5 space-y-2">
                        {Object.entries(byRound).map(([roundStr, entries]) => {
                          const r = parseInt(roundStr)
                          return (
                            <div key={r} className="space-y-1.5">
                              <div className="flex items-center gap-2">
                                <div className="h-px flex-1 bg-border/15" />
                                <span className="text-[7.5px] font-mono uppercase tracking-[0.25em] text-muted-foreground/30">Round {r}</span>
                                <div className="h-px flex-1 bg-border/15" />
                              </div>
                              {entries.map(e => <DebateCard key={`${e.name}-${e.round}`} item={e} />)}
                            </div>
                          )
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
