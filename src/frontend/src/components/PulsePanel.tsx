import { useState, useEffect, useRef, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card } from "@/components/ui/card"
import {
  Activity, Zap, AlertTriangle, Route, Clock, Radio,
} from "lucide-react"
import { fetchEvents, type Event } from "@/lib/api"

// ── Helpers ───────────────────────────────────────────────────────────────────

const POLL_MS = 2000
const MAX_ROUTED = 20

function fmtElapsed(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${ms.toFixed(0)}ms`
}

function fmtTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

function shortInstance(instance: string | undefined): string {
  if (!instance) return "—"
  return instance.replace("mollama_", "")
}

// ── Scrollbar style ───────────────────────────────────────────────────────────

const SCROLL_CLS = [
  "overflow-y-auto",
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb:hover]:bg-border/50",
].join(" ")

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: React.ElementType
  label: string
  value: string | number
  accent?: "emerald" | "amber" | "red" | "sky"
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400/80",
    amber:   "text-amber-400/80",
    red:     "text-red-400/80",
    sky:     "text-sky-400/80",
  }
  const valueColor = accent ? colorMap[accent] : "text-foreground/80"

  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border/25 bg-muted/10">
      <Icon size={11} className="text-muted-foreground/35 shrink-0" />
      <div className="min-w-0">
        <p className="text-[8px] font-mono uppercase tracking-[0.2em] text-muted-foreground/30 leading-none mb-0.5">
          {label}
        </p>
        <p className={["text-[13px] font-mono font-black tabular-nums leading-none", valueColor].join(" ")}>
          {value}
        </p>
      </div>
    </div>
  )
}

// ── Routed event row ──────────────────────────────────────────────────────────

function RoutedRow({ ev }: { ev: Event }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18 }}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-muted/10 transition-colors group"
    >
      {/* Model name */}
      <span className="text-[11px] font-mono text-foreground/70 truncate flex-1 min-w-0">
        {ev.model ? ev.model.split(":")[0] : "—"}
      </span>

      {/* Instance chip */}
      {ev.instance && (
        <span className="text-[9px] font-mono text-sky-400/50 truncate max-w-24 shrink-0">
          {shortInstance(ev.instance)}
        </span>
      )}

      {/* Elapsed chip */}
      {ev.elapsed != null && (
        <span className={[
          "text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0",
          ev.elapsed < 500
            ? "border-emerald-500/20 text-emerald-400/60 bg-emerald-500/5"
            : ev.elapsed < 2000
              ? "border-amber-500/20 text-amber-400/60 bg-amber-500/5"
              : "border-red-500/20 text-red-400/60 bg-red-500/5",
        ].join(" ")}>
          {fmtElapsed(ev.elapsed)}
        </span>
      )}

      {/* Timestamp */}
      <span className="text-[9px] font-mono text-muted-foreground/20 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {fmtTime(ev.ts)}
      </span>
    </motion.div>
  )
}

// ── Active stream row ─────────────────────────────────────────────────────────

function ActiveRow({ ev }: { ev: Event }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.15 }}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-primary/10 bg-primary/5"
    >
      <motion.span
        animate={{ opacity: [0.3, 1, 0.3] }}
        transition={{ duration: 1.2, repeat: Infinity }}
        className="size-1.5 rounded-full bg-primary/60 shrink-0"
      />
      <span className="text-[10px] font-mono text-foreground/60 truncate flex-1 min-w-0">
        {ev.method && (
          <span className="text-sky-400/60 mr-1">{ev.method}</span>
        )}
        {ev.path ?? "—"}
      </span>
      {ev.instance && (
        <span className="text-[9px] font-mono text-muted-foreground/30 shrink-0 truncate max-w-20">
          {shortInstance(ev.instance)}
        </span>
      )}
    </motion.div>
  )
}

// ── Section header ────────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, count }: {
  icon: React.ElementType
  label: string
  count?: number
}) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <Icon size={10} className="text-muted-foreground/35 shrink-0" />
      <span className="text-[9px] font-mono uppercase tracking-[0.22em] text-muted-foreground/35 flex-1">
        {label}
      </span>
      {count != null && (
        <span className="text-[9px] font-mono text-muted-foreground/25 tabular-nums">
          {count}
        </span>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function PulsePanel() {
  const [events, setEvents] = useState<Event[]>([])
  const [sessionStart] = useState(() => Date.now() / 1000)
  const seenIdsRef = useRef<Set<string>>(new Set())
  const prevInRef = useRef<Set<string>>(new Set())

  // Polling
  const poll = useCallback(async () => {
    try {
      const { events: fresh } = await fetchEvents(300)
      setEvents(fresh)
    } catch {
      // silently ignore — panel will just show stale data
    }
  }, [])

  useEffect(() => {
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => clearInterval(id)
  }, [poll])

  // ── Derived data ────────────────────────────────────────────────────────────

  // Only events since the panel mounted
  const sessionEvents = events.filter(e => e.ts >= sessionStart - 60) // grace: 60s before mount

  // Total requests this session (unique "in" events)
  const totalRequests = sessionEvents.filter(e => e.kind === "in").length

  // Average latency from "out" events (elapsed in seconds → ms)
  const outEvents = sessionEvents.filter(e => e.kind === "out" && e.elapsed != null)
  const avgLatency = outEvents.length > 0
    ? outEvents.reduce((sum, e) => sum + (e.elapsed ?? 0), 0) / outEvents.length
    : null

  // Error count
  const errorCount = sessionEvents.filter(e => e.kind === "error" || e.kind === "ban_or_fail").length

  // Last 20 routed events (most recent first)
  const routedEvents = [...events]
    .filter(e => e.kind === "routed")
    .sort((a, b) => b.ts - a.ts)
    .slice(0, MAX_ROUTED)

  // Active "in" events: those without a matching "resp" or "error" yet
  const inMap = new Map<string, Event>()
  const resolvedIds = new Set<string>()

  for (const e of events) {
    if (e.kind === "in") {
      // Use path+method as a loose key since Event has no req_id here
      const key = `${e.method}:${e.path}:${Math.floor(e.ts)}`
      inMap.set(key, e)
    }
    if (e.kind === "resp" || e.kind === "error") {
      // Match by proximity: find unresolved "in" within ~5s
      for (const [k, v] of inMap) {
        if (!resolvedIds.has(k) && Math.abs(v.ts - e.ts) < 5) {
          resolvedIds.add(k)
          break
        }
      }
    }
  }

  const now = Date.now() / 1000
  const activeStreams: Event[] = []
  for (const [k, v] of inMap) {
    // Only unresolved, within the last 30s
    if (!resolvedIds.has(k) && now - v.ts < 30) {
      activeStreams.push(v)
    }
  }
  // Sort by newest first
  activeStreams.sort((a, b) => b.ts - a.ts)

  const isLive = activeStreams.length > 0

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2.5 flex items-center gap-3 bg-muted/10">
        <Radio size={12} className="text-primary/70 shrink-0" />
        <span className="text-[10px] font-mono font-black uppercase tracking-widest text-foreground/80">
          Mollama Pulse
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <motion.span
            animate={isLive
              ? { scale: [1, 1.7, 1], opacity: [0.6, 1, 0.6] }
              : { scale: [1, 1.1, 1], opacity: [0.2, 0.4, 0.2] }
            }
            transition={{ duration: isLive ? 0.7 : 2.5, repeat: Infinity, ease: "easeInOut" }}
            className={["size-1.5 rounded-full shrink-0", isLive ? "bg-emerald-400" : "bg-muted-foreground/30"].join(" ")}
          />
          <span className={[
            "text-[9px] font-mono uppercase tracking-widest transition-colors duration-700",
            isLive ? "text-emerald-400/70" : "text-muted-foreground/25",
          ].join(" ")}>
            {isLive ? "live" : "idle"}
          </span>
        </div>
      </div>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <div className="shrink-0 grid grid-cols-3 gap-2 px-4 py-3 border-b border-border/25 bg-muted/5">
        <StatChip
          icon={Activity}
          label="Requests"
          value={totalRequests.toLocaleString()}
          accent="sky"
        />
        <StatChip
          icon={Clock}
          label="Avg latency"
          value={avgLatency != null ? fmtElapsed(avgLatency) : "—"}
          accent={
            avgLatency == null ? undefined
              : avgLatency < 500 ? "emerald"
                : avgLatency < 2000 ? "amber"
                  : "red"
          }
        />
        <StatChip
          icon={AlertTriangle}
          label="Errors"
          value={errorCount}
          accent={errorCount > 0 ? "red" : undefined}
        />
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className={["flex-1 min-h-0 px-4 py-3 flex flex-col gap-4", SCROLL_CLS].join(" ")}>

        {/* Active streams section */}
        <div>
          <SectionHeader icon={Zap} label="Active streams" count={activeStreams.length} />

          {activeStreams.length === 0 ? (
            <p className="text-[9px] font-mono text-muted-foreground/20 px-2.5 py-2">
              No active requests
            </p>
          ) : (
            <div className="space-y-1">
              <AnimatePresence>
                {activeStreams.map((ev, idx) => (
                  <ActiveRow
                    key={`${ev.method}:${ev.path}:${Math.floor(ev.ts)}:${idx}`}
                    ev={ev}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Routing decisions section */}
        <div>
          <SectionHeader
            icon={Route}
            label="Routing decisions"
            count={routedEvents.length}
          />

          {routedEvents.length === 0 ? (
            <p className="text-[9px] font-mono text-muted-foreground/20 px-2.5 py-2">
              No routing events yet
            </p>
          ) : (
            <div className="space-y-0.5">
              <AnimatePresence initial={false}>
                {routedEvents.map((ev, idx) => (
                  <RoutedRow
                    key={`routed-${ev.ts}-${idx}`}
                    ev={ev}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
