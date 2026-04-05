import {
  useState, useEffect, useLayoutEffect, useRef, useCallback, type ReactNode,
} from "react"
import { motion, AnimatePresence } from "framer-motion"
import { useEvents } from "@/hooks/use-api"
import { fetchStreamLog, type StreamEntry } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { Activity, ArrowDown, ArrowUp, Terminal, Brain } from "lucide-react"
import { toast } from "sonner"

type Tab = "requests" | "stream"

interface Event {
  kind: "in" | "out" | "error" | "routed" | "ban" | "ban_or_fail" | "resp" | "mollama"
  req_id: string
  method?: string
  path?: string
  msg?: string
  instance?: string
  status?: number
  elapsed?: number
  phase?: string
  model?: string
  ts: number
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max))

// ── Lerp scroll ───────────────────────────────────────────────────────────────

function useLerpScroll(factor = 0.1) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const targetY = useRef<number | null>(null)
  const currentY = useRef(0)
  const rafId = useRef<number | null>(null)
  const autoScrolling = useRef(false)
  const userScrolling = useRef(false)
  const userScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearUserScrollLock = useCallback(() => {
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
    userScrollTimer.current = null
    userScrolling.current = false
  }, [])

  const stop = useCallback(() => {
    if (rafId.current != null) cancelAnimationFrame(rafId.current)
    rafId.current = null; targetY.current = null; autoScrolling.current = false
    const el = scrollRef.current
    if (el) currentY.current = el.scrollTop
  }, [])

  const tick = useCallback(() => {
    const el = scrollRef.current
    if (!el || targetY.current === null) { rafId.current = null; autoScrolling.current = false; return }
    const diff = targetY.current - currentY.current
    if (Math.abs(diff) < 0.5) {
      el.scrollTop = targetY.current; currentY.current = targetY.current
      targetY.current = null; rafId.current = null; autoScrolling.current = false; return
    }
    currentY.current += diff * factor
    el.scrollTop = currentY.current
    rafId.current = requestAnimationFrame(tick)
  }, [factor])

  const scrollTo = useCallback((y: number, force = false) => {
    const el = scrollRef.current
    if (!el) return
    if (force) clearUserScrollLock()
    else if (userScrolling.current) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    targetY.current = clamp(y, 0, max)
    currentY.current = el.scrollTop
    autoScrolling.current = true
    if (rafId.current != null) cancelAnimationFrame(rafId.current)
    rafId.current = requestAnimationFrame(tick)
  }, [tick, clearUserScrollLock])

  const onScroll = useCallback(() => {
    if (autoScrolling.current) return
    userScrolling.current = true
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
    userScrollTimer.current = setTimeout(() => { userScrolling.current = false }, 2000)
  }, [])

  const isAutoScrolling = useCallback(() => autoScrolling.current, [])

  useEffect(() => () => {
    if (rafId.current != null) cancelAnimationFrame(rafId.current)
    if (userScrollTimer.current) clearTimeout(userScrollTimer.current)
  }, [])

  return { scrollRef, scrollTo, onScroll, isAutoScrolling, stop }
}

// ── Stream log hook ───────────────────────────────────────────────────────────

export function useStreamLog(intervalMs = 500) {
  const [streams, setStreams] = useState<StreamEntry[]>([])

  useEffect(() => {
    let cancelled = false
    const poll = async () => {
      try {
        const res = await fetchStreamLog(50)
        if (!cancelled) setStreams(res.streams)
      } catch (err: any) {
        if (cancelled) return
        toast.error("Stream fetch failed", { description: err.message })
      }
    }
    poll()
    const id = setInterval(poll, intervalMs)
    return () => { cancelled = true; clearInterval(id) }
  }, [intervalMs])

  return streams
}

// ── Typewriter hook ───────────────────────────────────────────────────────────

const CHARS_PER_TICK = 8
const TICK_MS = 16

export function useTypewriter(targets: Record<string, string>): Record<string, string> {
  const [displayed, setDisplayed] = useState<Record<string, string>>({})
  const pendingRef = useRef<Record<string, string>>({})
  const seenLenRef = useRef<Record<string, number>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let dirty = false
    for (const [id, full] of Object.entries(targets)) {
      const seen = seenLenRef.current[id] ?? 0
      if (full.length > seen) {
        pendingRef.current[id] = (pendingRef.current[id] ?? "") + full.slice(seen)
        seenLenRef.current[id] = full.length
        dirty = true
      }
    }
    if (dirty && !timerRef.current) {
      timerRef.current = setInterval(() => {
        const updates: Record<string, string> = {}
        let anyLeft = false
        for (const id of Object.keys(pendingRef.current)) {
          const q = pendingRef.current[id]
          if (!q || q.length === 0) continue
          anyLeft = true
          updates[id] = q.slice(0, CHARS_PER_TICK)
          pendingRef.current[id] = q.slice(CHARS_PER_TICK)
        }
        if (!anyLeft) { clearInterval(timerRef.current!); timerRef.current = null; return }
        setDisplayed(prev => {
          const next = { ...prev }
          for (const [id, batch] of Object.entries(updates)) next[id] = (next[id] ?? "") + batch
          return next
        })
      }, TICK_MS)
    }
  }, [targets])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])
  return displayed
}

// ── Shared styles ─────────────────────────────────────────────────────────────

const SCROLL_CLS = [
  "absolute inset-0 overflow-y-auto",
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb:hover]:bg-border/50",
].join(" ")

function FollowButton({ direction, label, onClick }: { direction: "up" | "down"; label: string; onClick: () => void }) {
  const isUp = direction === "up"
  return (
    <motion.button
      initial={{ opacity: 0, y: isUp ? -6 : 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: isUp ? -6 : 6 }}
      onClick={onClick}
      className={["absolute left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded border border-primary/25 bg-background/90 backdrop-blur-sm text-[10px] font-mono uppercase tracking-widest text-primary/60 hover:text-primary hover:bg-primary/10 transition-colors shadow-lg", isUp ? "top-3" : "bottom-3"].join(" ")}>
      {isUp ? <ArrowUp size={9} /> : <ArrowDown size={9} />}
      {label}
    </motion.button>
  )
}

// ── Request row builder ───────────────────────────────────────────────────────

interface RequestRow {
  req_id: string
  method?: string
  path?: string
  instance?: string
  elapsed?: number
  status?: number
  error?: string
  banned: boolean
  ts: number
  pending: boolean
  mollamaModel?: string   // chosen model from smart routing
  isMollama: boolean
}

function buildRequestRows(events: Event[]): RequestRow[] {
  const map = new Map<string, RequestRow>()

  events.slice().reverse().forEach((e) => {
    if (!map.has(e.req_id)) {
      map.set(e.req_id, { req_id: e.req_id, ts: e.ts, pending: true, banned: false, isMollama: false })
    }
    const row = map.get(e.req_id)!

    if (e.kind === "in")          { row.method = e.method; row.path = e.path; row.ts = e.ts }
    if (e.kind === "routed")      { row.instance = e.instance }
    if (e.kind === "resp")        { row.elapsed = e.elapsed; row.status = e.status; row.pending = false }
    if (e.kind === "error")       { row.error = e.msg; row.pending = false }
    if (e.kind === "ban")         { row.banned = true }
    if (e.kind === "ban_or_fail") { row.banned = true }

    if (e.kind === "mollama") {
      row.isMollama = true
      if (e.phase === "resolved" || e.phase === "fallback") row.mollamaModel = e.model
    }
  })

  return Array.from(map.values()).sort((a, b) => b.ts - a.ts)
}

// ── Requests Feed ─────────────────────────────────────────────────────────────

function RequestsFeed({ events }: { events: Event[] }) {
  const { scrollRef, scrollTo, onScroll, isAutoScrolling, stop } = useLerpScroll(0.11)
  const [following, setFollowing] = useState(true)
  const [rows, setRows] = useState<RequestRow[]>([])

  const breakFollow = useCallback(() => { stop(); setFollowing(false) }, [stop])
  const handleScroll = useCallback(() => { if (isAutoScrolling()) return; onScroll(); setFollowing(false) }, [onScroll, isAutoScrolling])

  useEffect(() => {
    const incoming = buildRequestRows(events)
    setRows(prev => {
      const prevMap = new Map(prev.map(r => [r.req_id, r]))
      let changed = false
      for (const row of incoming) {
        const old = prevMap.get(row.req_id)
        if (!old || JSON.stringify(old) !== JSON.stringify(row)) { prevMap.set(row.req_id, row); changed = true }
      }
      if (!changed) return prev
      return Array.from(prevMap.values()).sort((a, b) => b.ts - a.ts)
    })
  }, [events])

  useLayoutEffect(() => {
    if (!following) return
    const id = requestAnimationFrame(() => scrollTo(0, true))
    return () => cancelAnimationFrame(id)
  }, [rows, following, scrollTo])

  const fmt = (ts: number) =>
    new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} onWheelCapture={breakFollow}
        onPointerDownCapture={breakFollow} onTouchStartCapture={breakFollow} className={SCROLL_CLS}>
        <div className="p-2 overflow-hidden">
          {rows.length === 0 && (
            <div className="text-xs text-muted-foreground/30 text-center py-8 font-mono">waiting for requests...</div>
          )}

          {rows.filter(r => r.method).map((row) => (
            <motion.div key={row.req_id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.18 }}
              className={["text-xs font-mono rounded px-2 py-1.5 transition-colors hover:bg-secondary/20",
                row.isMollama ? "border-l-2 border-amber-500/20 ml-0.5" : ""].join(" ")}>
              <div className="flex items-center gap-1 min-w-0">
                {/* Mollama indicator */}
                {row.isMollama && <Brain size={9} className="shrink-0 text-amber-400/60" />}

                <span className={["shrink-0 text-[10px] font-bold",
                  row.method === "POST" ? "text-sky-400/70" : "text-primary/50"].join(" ")}>
                  {row.method}
                </span>
                <span className="text-muted-foreground/60 truncate flex-1 text-[11px]">{row.path ?? "—"}</span>

                {/* Mollama resolved model */}
                {row.mollamaModel && (
                  <span className="text-amber-400/50 text-[9px] shrink-0 truncate max-w-20 font-mono">
                    ⟶ {row.mollamaModel.split(":")[0]}
                  </span>
                )}

                {row.instance && !row.mollamaModel && (
                  <span className="text-sky-400/40 text-[10px] shrink-0 truncate max-w-24">{row.instance.replace("mollama_", "")}</span>
                )}
                {row.elapsed != null && (
                  <span className="text-emerald-500/60 text-[10px] shrink-0">{row.elapsed.toFixed(2)}s</span>
                )}
                {row.pending && !row.error && !row.banned && (
                  <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity }}
                    className="text-primary/40 text-[10px] shrink-0">…</motion.span>
                )}
                {row.error && (
                  <span className="text-red-400/70 text-[10px] truncate max-w-28 shrink-0">{row.error}</span>
                )}
                {row.banned && (
                  <span className="text-orange-400/70 text-[10px] shrink-0">⊘ banned</span>
                )}
                <span className="text-muted-foreground/25 text-[10px] shrink-0">{fmt(row.ts)}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
      <AnimatePresence>
        {!following && (
          <FollowButton direction="up" label="Follow" onClick={() => { setFollowing(true); scrollTo(0, true) }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Stream Feed ───────────────────────────────────────────────────────────────

function StreamFeed() {
  const streams = useStreamLog(500)
  const { scrollRef, scrollTo, onScroll, isAutoScrolling, stop } = useLerpScroll(0.1)
  const [following, setFollowing] = useState(true)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const targetId = streams[0]?.req_id
  const liveId   = streams.find(s => !s.done)?.req_id
  const hasActiveStream = Boolean(liveId)

  const computeTargetY = useCallback(() => {
    const container = scrollRef.current
    if (!container) return 0
    const targetCard = targetId ? cardRefs.current[targetId] : null
    if (!targetCard) return Math.max(0, container.scrollHeight - container.clientHeight)
    return Math.max(0, targetCard.offsetTop + targetCard.offsetHeight - container.clientHeight + 24)
  }, [scrollRef, targetId])

  const followLatest = useCallback((force = true) => scrollTo(computeTargetY(), force), [computeTargetY, scrollTo])
  const breakFollow  = useCallback(() => { stop(); setFollowing(false) }, [stop])

  const handleScroll = useCallback(() => {
    if (isAutoScrolling()) return
    onScroll(); breakFollow()
  }, [onScroll, isAutoScrolling, breakFollow])

  const targets: Record<string, string> = {}
  for (const s of streams) targets[s.req_id] = s.content
  const displayed = useTypewriter(targets)

  useLayoutEffect(() => {
    if (!following) return
    const id = requestAnimationFrame(() => followLatest(true))
    return () => cancelAnimationFrame(id)
  }, [following, streams, displayed, followLatest])

  const buttonDirection: "up" | "down" = (() => {
    const el = scrollRef.current
    if (!el) return "down"
    const diff = el.scrollTop - computeTargetY()
    if (Math.abs(diff) < 60) return "down"
    return diff > 0 ? "up" : "down"
  })()

  return (
    <div className="relative flex-1 min-h-0">
      <div ref={scrollRef} onScroll={handleScroll} onWheelCapture={breakFollow}
        onPointerDownCapture={breakFollow} onTouchStartCapture={breakFollow} className={SCROLL_CLS}>
        <div className="p-4 font-mono text-xs leading-relaxed space-y-5">
          {streams.length === 0 && (
            <span className="text-muted-foreground/25 animate-pulse">waiting for stream...</span>
          )}

          {streams.map((stream) => {
            const text   = displayed[stream.req_id] ?? ""
            const isLive = stream.req_id === liveId

            return (
              <motion.div key={stream.req_id} ref={(el) => { cardRefs.current[stream.req_id] = el as HTMLDivElement | null }}
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
                <div className="flex items-center gap-2 mb-1 text-[11px]">
                  <span className="text-emerald-500/60 select-none">❯</span>
                  <span className="text-emerald-300/70">{stream.path}</span>
                  <span className="text-sky-400/35 text-[10px]">➢ {stream.instance?.replace("mollama_", "")}</span>
                  {isLive && (
                    <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }}
                      className="ml-auto text-[9px] text-emerald-400/40 uppercase tracking-widest">live</motion.span>
                  )}
                </div>

                {(text || isLive) && (
                  <div className="pl-3.5 text-foreground/75 whitespace-pre-wrap break-words leading-[1.65]">
                    {text}
                    {isLive && (
                      <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }}
                        className="inline-block w-[5px] h-[12px] bg-primary/50 ml-px align-middle" />
                    )}
                  </div>
                )}

                {stream.done && (
                  <div className="text-[10px] text-muted-foreground/25 mt-1.5 pl-3.5 flex items-center gap-1.5">
                    <span>✓ done</span>
                  </div>
                )}
              </motion.div>
            )
          })}
        </div>
      </div>

      <AnimatePresence>
        {!following && (
          <FollowButton direction={buttonDirection} label={hasActiveStream ? "Follow" : "Scroll to latest"}
            onClick={() => { setFollowing(true); followLatest(true) }} />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── LiveFeed ──────────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "stream",   label: "Stream",   icon: <Terminal size={11} /> },
  { id: "requests", label: "Requests", icon: <Activity size={11} /> },
]

export function LiveFeed() {
  const [tab, setTab] = useState<Tab>("stream")
  const { data: eventsData } = useEvents()
  const events: Event[] = eventsData?.events || []
  const streams = useStreamLog(500)

  const isActive = streams.some(s => !s.done) || events.some(e => Date.now() / 1000 - e.ts < 1)

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/30 backdrop-blur-xl rounded-lg overflow-hidden">
      <div className="shrink-0 border-b border-border/40 px-2.5 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-0.5 bg-muted/20 rounded-md p-0.5">
          {TABS.map(({ id, label, icon }) => (
            <button key={id} onClick={() => setTab(id)}
              className={["relative flex items-center gap-1.5 px-2.5 py-1.5 rounded text-[11px] font-mono font-medium transition-colors",
                tab === id ? "text-foreground" : "text-muted-foreground/40 hover:text-muted-foreground/70"].join(" ")}>
              {tab === id && (
                <motion.span layoutId="livefeed-tab-bg" className="absolute inset-0 bg-background/60 rounded shadow-sm"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }} />
              )}
              <span className="relative flex items-center gap-1.5">{icon}{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 pr-1">
          <motion.span
            animate={isActive ? { scale: [1,1.7,1], opacity: [0.6,1,0.6] } : { scale: [1,1.15,1], opacity: [0.25,0.45,0.25] }}
            transition={{ duration: isActive ? 0.75 : 2.5, repeat: Infinity, ease: "easeInOut" }}
            className={["size-1.5 rounded-full", isActive ? "bg-emerald-400" : "bg-muted-foreground/40"].join(" ")} />
          <span className={["text-[10px] font-mono uppercase tracking-widest transition-colors duration-700",
            isActive ? "text-emerald-400/70" : "text-muted-foreground/25"].join(" ")}>
            {isActive ? "live" : "idle"}
          </span>
        </div>
      </div>

      <div className="relative flex-1 min-h-0 overflow-hidden bg-transparent">
        {(["requests", "stream"] as Tab[]).map(t => (
          <motion.div key={t}
            animate={{ opacity: tab === t ? 1 : 0, y: tab === t ? 0 : 4 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-0 flex flex-col"
            style={{ pointerEvents: tab === t ? "auto" : "none", zIndex: tab === t ? 10 : 0, visibility: tab === t ? "visible" : "hidden" }}>
            {t === "requests" ? <RequestsFeed events={events} /> : <StreamFeed />}
          </motion.div>
        ))}
      </div>
    </Card>
  )
}