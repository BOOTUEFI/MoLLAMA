import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"
import {
  Activity, Settings, MessageSquare, Server, Cpu, RefreshCcw,
  Pause, Play, X, ChevronDown, ChevronUp, Loader2,
  Shield, Terminal, TrendingUp, AlertCircle, ArrowRight, Wrench, Plug,
} from "lucide-react"
import { LiveFeed } from "./LiveFeed"
import { ChatHub } from "./ChatHub"
import { InstanceManager } from "./InstanceManager"
import { ToolFileList, ToolEditorPane } from "./ToolsEditor"
import { McpManager } from "./McpManager"
import { SettingsPanel } from "./SettingsPanel"
import { ConnectionGuard } from "./ConnectionGuard"
import { useIsMobile } from "@/hooks/use-mobile"
import { useModels } from "@/hooks/use-api"
import { useConnectivity } from "@/hooks/use-connectivity"
import { useSystemStats } from "@/hooks/use-system-stats"
import {
  fetchInstances, fetchStats,
  updateOllama, rebuildOllama, pauseOllamaUpdate, stopOllamaUpdate,
} from "@/lib/api"

// ─── Types ──────────────────────────────────────────────────────────────────

type MaintenanceMode = "update" | "rebuild" | null

interface LogEntry {
  id: number
  ts: number
  message: string
  kind: "info" | "error" | "success" | "warn"
}

interface MaintenanceState {
  visible: boolean
  minimized: boolean
  running: boolean
  paused: boolean
  mode: MaintenanceMode
  progress: number
  message: string
  error: string | null
  currentVersion: string | null
  latestVersion: string | null
  isLatest: boolean
  managedCount: number
  total: number
  completed: number
  logs: LogEntry[]
}

const INITIAL: MaintenanceState = {
  visible: true,
  minimized: true,
  running: false,
  paused: false,
  mode: null,
  progress: 0,
  message: "Idle",
  error: null,
  currentVersion: null,
  latestVersion: null,
  isLatest: false,
  managedCount: 0,
  total: 0,
  completed: 0,
  logs: [],
}

// ─── Utilities ───────────────────────────────────────────────────────────────

let logSeq = 0
function mkLog(message: string, kind: LogEntry["kind"] = "info"): LogEntry {
  return { id: logSeq++, ts: Date.now(), message, kind }
}

function fmtVer(v: string | null | undefined) { return v ?? "—" }

function getPhase(progress: number, mode: MaintenanceMode): string {
  if (!mode) return "Idle"
  if (mode === "update") {
    if (progress < 15) return "Fetching release info"
    if (progress < 42) return "Downloading binary"
    if (progress < 62) return "Stopping instances"
    if (progress < 88) return "Installing & restarting"
    return "Finalizing"
  }
  if (progress < 30) return "Stopping containers"
  if (progress < 70) return "Rebuilding images"
  return "Restarting services"
}

function fmtTime(ts: number) {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
}

// ─── useRollingNumber ────────────────────────────────────────────────────────

function useRollingNumber(target: number, ms = 500) {
  const [val, setVal] = useState(target)
  const frame = useRef<number>()
  const from = useRef(target)
  const start = useRef<number>()

  useEffect(() => {
    if (from.current === target) return
    const f = from.current
    from.current = target
    start.current = performance.now()
    const run = (now: number) => {
      const t = Math.min((now - (start.current ?? now)) / ms, 1)
      const ease = 1 - Math.pow(1 - t, 3)
      setVal(Math.round(f + (target - f) * ease))
      if (t < 1) frame.current = requestAnimationFrame(run)
      else setVal(target)
    }
    frame.current = requestAnimationFrame(run)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [target, ms])

  return val
}

// ─── RingProgress ────────────────────────────────────────────────────────────

function RingProgress({
  value, size = 60, sw = 4, glow = false,
}: {
  value: number; size?: number; sw?: number; glow?: boolean
}) {
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(value, 100) / 100) * circ

  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none"
        strokeWidth={sw} stroke="hsl(var(--border))" opacity={0.25} />
      {glow && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none"
          strokeWidth={sw + 4} stroke="hsl(var(--primary))"
          strokeDasharray={circ} strokeLinecap="round"
          style={{ strokeDashoffset: offset, opacity: 0.12, transition: "stroke-dashoffset 0.5s ease" }}
        />
      )}
      <motion.circle
        cx={size / 2} cy={size / 2} r={r} fill="none"
        strokeWidth={sw} stroke="hsl(var(--primary))"
        strokeDasharray={circ} strokeLinecap="round"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </svg>
  )
}

// ─── useOllamaMaintenance ────────────────────────────────────────────────────

function useOllamaMaintenance() {
  const [state, setState] = useState<MaintenanceState>(INITIAL)
  const prevMsg = useRef("")

  const refresh = useCallback(async () => {
    try {
      const [stats, instances] = await Promise.all([
        fetchStats(),
        fetchInstances().catch(() => null),
      ])
      const managedCount = instances
        ? Object.values(instances).filter(i => i.managed).length : 0
      const m = stats.maintenance

      setState(prev => {
        const newMsg = m?.message ?? (stats.isLatest ? "Ollama is up to date." : prev.message)
        const msgChanged = newMsg && newMsg !== prevMsg.current
        if (msgChanged) prevMsg.current = newMsg
        const newLogs = msgChanged
          ? [...prev.logs.slice(-79), mkLog(newMsg, m?.error ? "error" : "info")]
          : prev.logs
        return {
          ...prev, managedCount,
          running: m ? !!m.running : prev.running,
          paused: m ? !!m.paused : prev.paused,
          mode: m ? m.mode : prev.mode,
          progress: typeof m?.progress === "number" ? m.progress : prev.progress,
          message: newMsg,
          error: m?.error ?? null,
          currentVersion: stats.currentOllamaVersion ?? prev.currentVersion,
          latestVersion: stats.latestOllamaVersion ?? prev.latestVersion,
          isLatest: typeof stats.isLatest === "boolean" ? stats.isLatest : prev.isLatest,
          total: m?.total ?? prev.total,
          completed: m?.completed ?? prev.completed,
          visible: true,
          minimized: m?.running ? false : prev.minimized,
          logs: newLogs,
        }
      })
    } catch { /* swallow */ }
  }, [])

  useEffect(() => {
    void refresh()
    const id = setInterval(() => void refresh(), 500)
    return () => clearInterval(id)
  }, [refresh])

  const appendLog = useCallback((msg: string, kind: LogEntry["kind"]) => {
    setState(p => ({ ...p, logs: [...p.logs.slice(-79), mkLog(msg, kind)] }))
  }, [])

  const startUpdate = useCallback(async () => {
    setState(p => ({
      ...p, visible: true, minimized: false, running: true, paused: false,
      mode: "update", progress: 3, message: "Starting update…", error: null,
      logs: [...p.logs.slice(-79), mkLog("Update triggered.", "info")],
    }))
    await updateOllama()
    await refresh()
  }, [refresh])

  const startRebuild = useCallback(async () => {
    setState(p => ({
      ...p, visible: true, minimized: false, running: true, paused: false,
      mode: "rebuild", progress: 5, message: "Starting rebuild…", error: null,
      logs: [...p.logs.slice(-79), mkLog("Rebuild triggered.", "info")],
    }))
    await rebuildOllama()
    await refresh()
  }, [refresh])

  const stop = useCallback(async () => {
    await stopOllamaUpdate()
    await refresh()
    setState(p => ({
      ...p, running: false, paused: false, mode: null, minimized: true,
      message: "Stopped.",
      logs: [...p.logs.slice(-79), mkLog("Operation stopped by user.", "warn")],
    }))
  }, [refresh])

  const togglePause = useCallback(async () => {
    const next = !state.paused
    await pauseOllamaUpdate(next)
    await refresh()
    setState(p => ({
      ...p, paused: next,
      message: next ? "Paused." : "Resumed.",
      logs: [...p.logs.slice(-79), mkLog(next ? "Paused." : "Resumed.", "warn")],
    }))
  }, [refresh, state.paused])

  return {
    ...state,
    startUpdate, startRebuild, stop, togglePause,
    minimize: useCallback(() => setState(p => ({ ...p, minimized: true })), []),
    expand: useCallback(() => setState(p => ({ ...p, minimized: false, visible: true })), []),
    refresh,
  }
}

type Maintenance = ReturnType<typeof useOllamaMaintenance>

// ─── OllamaMaintenancePanel ──────────────────────────────────────────────────

function OllamaMaintenancePanel({ m }: { m: Maintenance }) {
  const logsEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logsEnd.current?.scrollIntoView({ behavior: "smooth" })
  }, [m.logs.length])

  const statusText = useMemo(() => {
    if (m.error) return m.error
    if (m.running && m.paused) return "Paused"
    if (m.running && m.mode === "update") return "Updating Ollama"
    if (m.running && m.mode === "rebuild") return "Rebuilding instances"
    if (m.isLatest) return "Ollama is healthy"
    if (m.latestVersion && m.currentVersion && m.latestVersion !== m.currentVersion) return "Update available"
    return "Ready"
  }, [m.error, m.running, m.paused, m.mode, m.isLatest, m.latestVersion, m.currentVersion])

  const phase = getPhase(m.progress, m.mode)

  if (!m.visible) return null

  return (
    <>
      {/* ── Minimized chip ── */}
      <AnimatePresence>
        {m.minimized && (
          <motion.div
            key="chip"
            initial={{ opacity: 0, scale: 0.88, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.88, y: 10 }}
            transition={{ type: "spring", damping: 22, stiffness: 320 }}
            className="fixed bottom-5 right-5 z-50"
          >
            <button
              onClick={m.expand}
              className="group flex items-center gap-3 rounded-2xl border border-border/40 bg-card/85 backdrop-blur-2xl px-3 py-2 shadow-2xl shadow-black/25 hover:border-primary/40 transition-all duration-200"
            >
              <div className="relative">
                <RingProgress value={m.progress} size={38} sw={3} glow={m.running} />
                <div className="absolute inset-0 flex items-center justify-center">
                  {m.running
                    ? <Loader2 size={11} className="animate-spin text-primary" />
                    : <RefreshCcw size={11} className="text-primary" />
                  }
                </div>
              </div>
              <div className="text-left">
                <div className="text-[8.5px] font-mono font-black uppercase tracking-[0.3em] text-muted-foreground">
                  Ollama Maintenance
                </div>
                <div className="text-[11px] font-semibold text-foreground/90 mt-0.5">{statusText}</div>
              </div>
              <ChevronUp size={12} className="text-muted-foreground/60 group-hover:text-foreground transition-colors ml-0.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full panel ── */}
      <AnimatePresence>
        {!m.minimized && (
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.96, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 20 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className="fixed bottom-5 right-5 z-50 w-[min(25rem,calc(100vw-2.5rem))]"
          >
            <div className="rounded-2xl border border-border/40 bg-card/96 backdrop-blur-2xl shadow-2xl shadow-black/35 overflow-hidden">

              {/* Header strip */}
              <div className="relative flex items-center gap-3.5 px-4 py-3 border-b border-border/30 bg-secondary/8">
                {/* Ring + center label */}
                <div className="relative shrink-0">
                  <RingProgress value={m.progress} size={56} sw={4.5} glow={m.running && !m.paused} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-[9px] font-mono font-black text-primary tabular-nums leading-none">
                      {m.progress}%
                    </span>
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-[8.5px] font-mono font-black uppercase tracking-[0.32em] text-primary/75 mb-0.5">
                    {m.mode === "update" ? "Ollama Update" : m.mode === "rebuild" ? "Instance Rebuild" : "Maintenance Console"}
                  </div>
                  <div className="text-[13px] font-semibold text-foreground leading-snug truncate">{statusText}</div>
                  {m.running && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <motion.span
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        className="inline-block w-1.5 h-1.5 rounded-full bg-primary"
                      />
                      <span className="text-[9.5px] font-mono text-muted-foreground">{phase}</span>
                    </div>
                  )}
                </div>

                <button
                  onClick={m.minimize}
                  className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
                >
                  <ChevronDown size={15} />
                </button>
              </div>

              <div className="p-4 space-y-3">

                {/* Version + meta row */}
                <div className="grid grid-cols-3 divide-x divide-border/30 rounded-xl border border-border/30 bg-secondary/10 overflow-hidden">
                  {[
                    { label: "Current", value: fmtVer(m.currentVersion), accent: false },
                    { label: "Latest", value: fmtVer(m.latestVersion), accent: !m.isLatest },
                    { label: m.total > 0 ? `${m.completed}/${m.total}` : `${m.managedCount} nodes`, value: m.total > 0 ? "done" : "managed", accent: false },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="flex flex-col items-center py-2 px-1">
                      <span className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
                      <span className={`text-[11px] font-mono font-bold mt-0.5 ${accent ? "text-orange-400" : "text-foreground"}`}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="space-y-1">
                  <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden">
                    <motion.div
                      animate={{ width: `${m.progress}%` }}
                      transition={{ duration: 0.45, ease: "easeOut" }}
                      className={`h-full rounded-full ${
                        m.paused ? "bg-orange-400" : m.running ? "bg-primary" : "bg-primary/50"
                      }`}
                    />
                  </div>
                </div>

                {/* Log tail */}
                {m.logs.length > 0 && (
                  <div className="rounded-xl border border-border/25 bg-background/50 overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/20 bg-secondary/10">
                      <Terminal size={9} className="text-muted-foreground" />
                      <span className="text-[8.5px] font-mono font-bold uppercase tracking-[0.22em] text-muted-foreground">
                        Operation Log
                      </span>
                      <span className="ml-auto text-[8px] font-mono text-muted-foreground/50">{m.logs.length} entries</span>
                    </div>
                    <div className="max-h-[5.5rem] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full px-3 py-2 space-y-[3px]">
                      {m.logs.slice(-12).map(log => (
                        <div key={log.id} className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed">
                          <span className="shrink-0 text-muted-foreground/40 tabular-nums">{fmtTime(log.ts)}</span>
                          <span className={
                            log.kind === "error" ? "text-red-400" :
                            log.kind === "success" ? "text-primary" :
                            log.kind === "warn" ? "text-orange-400" :
                            "text-muted-foreground"
                          }>{log.message}</span>
                        </div>
                      ))}
                      <div ref={logsEnd} />
                    </div>
                  </div>
                )}

                {/* Error banner */}
                <AnimatePresence>
                  {m.error && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2 rounded-xl border border-red-500/25 bg-red-500/7 px-3 py-2 text-[11px] font-mono text-red-400"
                    >
                      <AlertCircle size={12} className="mt-px shrink-0" />
                      <span>{m.error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={m.startUpdate} disabled={m.running || m.isLatest}
                    className="col-span-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-[10px] font-mono font-black uppercase tracking-[0.18em] text-primary-foreground hover:bg-primary/90 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95">
                    <RefreshCcw size={11} />
                    Update
                  </button>
                  <button onClick={m.startRebuild} disabled={m.running}
                    className="col-span-1 flex items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-secondary/20 px-3 py-2 text-[10px] font-mono font-black uppercase tracking-[0.18em] text-foreground/75 hover:bg-secondary/50 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95">
                    <Server size={11} />
                    Rebuild
                  </button>
                  <button onClick={m.togglePause} disabled={!m.running}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-border/40 bg-secondary/20 px-3 py-2 text-[10px] font-mono font-black uppercase tracking-[0.18em] text-foreground/75 hover:bg-secondary/50 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95">
                    {m.paused ? <Play size={11} /> : <Pause size={11} />}
                    {m.paused ? "Resume" : "Pause"}
                  </button>
                  <button onClick={m.stop} disabled={!m.running}
                    className="flex items-center justify-center gap-1.5 rounded-xl border border-red-500/20 bg-red-500/7 px-3 py-2 text-[10px] font-mono font-black uppercase tracking-[0.18em] text-red-400 hover:bg-red-500/14 disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95">
                    <X size={11} />
                    Stop
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

// ─── StatPill ────────────────────────────────────────────────────────────────

function StatPill({
  icon, label, value, accent = false, pulse = false,
}: {
  icon: React.ReactNode; label: string; value: number | string
  accent?: boolean; pulse?: boolean
}) {
  const num = typeof value === "number" ? value : null
  const displayed = num !== null ? useRollingNumber(num) : value

  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono transition-colors ${
      accent
        ? "border-primary/25 bg-primary/6 text-primary"
        : "border-border/20 bg-secondary/12 text-muted-foreground"
    }`}>
      <span className={accent ? "text-primary" : ""}>{icon}</span>
      <span className="text-[8.5px] uppercase tracking-widest">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"} ${pulse ? "animate-pulse" : ""}`}>
        {displayed}
      </span>
    </div>
  )
}

// ─── TopBar ──────────────────────────────────────────────────────────────────

function TopBar({
  selectedModel, onShowSettings, onUpdateOllama, updateBusy,
}: {
  selectedModel: string; onShowSettings: () => void
  onUpdateOllama: () => void; updateBusy: boolean
}) {
  const { isOffline, isApiDown } = useConnectivity()
  const isDisconnected = isOffline || isApiDown
  const { data: stats } = useSystemStats()

  const totalReqs = stats?.total_requests ?? 0
  const managedNodes = stats?.managed_count ?? 0
  const bannedCount = useMemo(() => {
    if (!stats?.banned_until) return 0
    const now = Date.now()
    return Object.values(stats.banned_until).filter(ts => ts * 1000 > now).length
  }, [stats?.banned_until])

  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative shrink-0 h-11 border-b border-border/30 bg-card/25 backdrop-blur-3xl px-4 flex items-center justify-between gap-4 sticky top-0 z-40"
    >
      {/* Scanline texture */}
      <div className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,hsl(var(--border)/0.035) 3px,hsl(var(--border)/0.035) 4px)" }}
      />

      {/* Left — brand */}
      <div className="flex flex-row items-center gap-4 relative">
        <div className="relative">
          <motion.div
            animate={{ opacity: isDisconnected ? [0.3, 0.7, 0.3] : [0.45, 1, 0.45], scale: [1, 1.35, 1] }}
            transition={{ duration: isDisconnected ? 1.1 : 2.8, repeat: Infinity }}
            className={`absolute inset-0 rounded-full blur-[3px] ${isDisconnected ? "bg-orange-500/60" : "bg-primary/55"}`}
          />
          <div className={`relative w-2 h-2 rounded-full ${isDisconnected ? "bg-orange-500" : "bg-primary"}`} />
        </div>
        <span className="text-[11px] font-mono font-black uppercase h-fit leading-none tracking-[0.3em] text-foreground/95">
          MoLLAMA
        </span>
        <Badge
          variant="outline"
          className={`text-[7.5px] px-1.5 h-4 font-mono tracking-[0.18em] transition-all ${
            isDisconnected
              ? "bg-orange-500/9 border-orange-500/30 text-orange-400"
              : "bg-primary/6 border-primary/20 text-primary"
          }`}
        >
          {isDisconnected ? "OFFLINE" : "LIVE"}
        </Badge>
      </div>

      {/* Center — live stats */}
      <div className="hidden lg:flex items-center gap-1.5 relative">
        <StatPill icon={<TrendingUp size={10} />} label="Req" value={totalReqs} />
        <StatPill icon={<Server size={10} />} label="Nodes" value={managedNodes - bannedCount} accent={managedNodes > 0} pulse/>
        {bannedCount > 0 && (
          <StatPill icon={<Shield size={10} />} label="Banned" value={bannedCount} pulse />
        )}
      </div>

      {/* Right — controls */}
      <div className="flex items-center gap-1.5 relative">
        {selectedModel && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/20 bg-secondary/12 max-w-44">
            <Cpu size={10} className="text-muted-foreground shrink-0" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider truncate">
              {isDisconnected ? "LINK LOST" : selectedModel}
            </span>
          </div>
        )}

        {!stats?.isLatest && (
            <button
                onClick={onUpdateOllama}
                disabled={updateBusy}
                className={`hidden md:inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-background/30 px-2.5 py-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.22em] text-foreground/65 hover:bg-secondary/50 hover:text-foreground disabled:opacity-45 disabled:cursor-not-allowed transition-colors ${updateBusy ? "cursor-wait" : ""}`}
            >
                {updateBusy ? (
                <Loader2 size={10} className="animate-spin" />
                ) : (
                <RefreshCcw size={10} />
                )}
                Update Ollama
            </button>
        )}

        <motion.button
          whileHover={{ scale: 1.1, rotate: 45 }}
          whileTap={{ scale: 0.9 }}
          onClick={onShowSettings}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
        >
          <Settings size={14} />
        </motion.button>
      </div>
    </motion.header>
  )
}

// ─── Layouts ─────────────────────────────────────────────────────────────────

function SectionLabel({ icon, label, right }: { icon: React.ReactNode; label: string; right?: boolean }) {
  return (
    <div className={`flex flex-1 justify-end items-center gap-1.5 px-1 pb-0.5 opacity-35 ${right ? "flex-row-reverse" : ""}`}>
      <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.25em]">{label}</span>
      {icon}
    </div>
  )
}

const slideIn = (x: number) => ({
  hidden: { opacity: 0, x },
  visible: { opacity: 1, x: 0, transition: { duration: 0.32, ease: "easeOut" } },
})

function DesktopLayout({ selectedModel, onShowSettings, onUpdateOllama, updateBusy, toolPath, setToolPath }: {
  selectedModel: string; onShowSettings: () => void
  onUpdateOllama: () => void; updateBusy: boolean
  toolPath: string | null; setToolPath: (p: string | null) => void
}) {
  return (
    <div className="flex flex-col h-screen">
      <TopBar selectedModel={selectedModel} onShowSettings={onShowSettings}
        onUpdateOllama={onUpdateOllama} updateBusy={updateBusy} />
      <div className="flex flex-1 gap-2 p-3 overflow-hidden">

        <motion.div
          variants={slideIn(-20)} initial="hidden" animate="visible"
          className="min-w-80 flex flex-col gap-1.5"
        >
          <SectionLabel icon={<Activity size={10} />} label="System Feed" />
          <LiveFeed />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.07 }}
          className="flex-1 min-w-0"
        >
          <AnimatePresence mode="wait">
            {toolPath ? (
              <ToolEditorPane key={toolPath} selectedPath={toolPath} onClose={() => setToolPath(null)} />
            ) : (
              <motion.div
                key="chat"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                className="h-full"
              >
                <ChatHub model={selectedModel} />
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        <motion.div
          variants={slideIn(20)} initial="hidden" animate="visible"
          className="min-w-80 flex flex-col gap-1.5 overflow-hidden"
        >
          <Tabs defaultValue="nodes" className="flex flex-col flex-1 overflow-hidden gap-1.5">
            <TabsList className="shrink-0 rounded-xl p-1 bg-secondary/12 border border-border/25">
              {[
                { v: "nodes", icon: <Server size={11} />, label: "Nodes" },
                { v: "tools", icon: <Wrench size={11} />, label: "Tools" },
                { v: "mcp",   icon: <Plug   size={11} />, label: "MCP"   },
              ].map(t => (
                <TabsTrigger key={t.v} value={t.v}
                  className="flex-1 text-[9px] font-mono uppercase tracking-widest gap-1.5 py-1.5">
                  {t.icon}{t.label}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex-1 overflow-hidden">
              <TabsContent value="nodes" className="h-full m-0"><InstanceManager /></TabsContent>
              <TabsContent value="tools" className="h-full m-0">
                <ToolFileList selectedPath={toolPath} onSelect={setToolPath} />
              </TabsContent>
              <TabsContent value="mcp"   className="h-full m-0"><McpManager /></TabsContent>
            </div>
          </Tabs>
        </motion.div>
      </div>
    </div>
  )
}

function MobileLayout({ selectedModel, onShowSettings, onUpdateOllama, updateBusy, toolPath, setToolPath }: {
  selectedModel: string; onShowSettings: () => void
  onUpdateOllama: () => void; updateBusy: boolean
  toolPath: string | null; setToolPath: (p: string | null) => void
}) {
  return (
    <div className="flex flex-col h-screen">
      <TopBar selectedModel={selectedModel} onShowSettings={onShowSettings}
        onUpdateOllama={onUpdateOllama} updateBusy={updateBusy} />
      <Tabs defaultValue="chat" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 mx-3 mt-2 rounded-xl p-1 bg-secondary/12 border border-border/25">
          {[
            { v: "chat",  icon: <MessageSquare size={12} />, label: "Chat"  },
            { v: "feed",  icon: <Activity      size={12} />, label: "Feed"  },
            { v: "nodes", icon: <Server        size={12} />, label: "Nodes" },
            { v: "tools", icon: <Wrench        size={12} />, label: "Tools" },
            { v: "mcp",   icon: <Plug          size={12} />, label: "MCP"   },
          ].map(t => (
            <TabsTrigger key={t.v} value={t.v}
              className="flex-1 text-[9px] font-mono uppercase tracking-widest gap-1.5 py-1.5">
              {t.icon}{t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="flex-1 overflow-hidden p-2">
          <TabsContent value="chat"  className="h-full m-0"><ChatHub model={selectedModel} /></TabsContent>
          <TabsContent value="feed"  className="h-full m-0"><LiveFeed /></TabsContent>
          <TabsContent value="nodes" className="h-full m-0"><InstanceManager /></TabsContent>
          <TabsContent value="tools" className="h-full m-0">
            {toolPath ? (
              <ToolEditorPane selectedPath={toolPath} onClose={() => setToolPath(null)} />
            ) : (
              <ToolFileList selectedPath={null} onSelect={setToolPath} />
            )}
          </TabsContent>
          <TabsContent value="mcp"   className="h-full m-0"><McpManager /></TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function Dashboard() {
  const isMobile = useIsMobile()
  const [showSettings, setShowSettings] = useState(false)
  const { data: models } = useModels()
  const [selectedModel, setSelectedModel] = useState("")
  const [toolPath, setToolPath] = useState<string | null>(null)
  const maintenance = useOllamaMaintenance()

  useEffect(() => {
    if (models?.length && !selectedModel) setSelectedModel(models[0])
  }, [models, selectedModel])

  const props = {
    selectedModel,
    onShowSettings: () => setShowSettings(true),
    onUpdateOllama: maintenance.startUpdate,
    updateBusy: maintenance.running,
    toolPath,
    setToolPath,
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      {/* Dot-grid atmosphere */}
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.022]"
        style={{ backgroundImage: "radial-gradient(hsl(var(--foreground)) 1px,transparent 1px)", backgroundSize: "22px 22px" }}
      />

      <ConnectionGuard />

      <AnimatePresence mode="wait">
        {showSettings && (
          <SettingsPanel
            selectedModel={selectedModel}
            onModelChange={setSelectedModel}
            onClose={() => setShowSettings(false)}
          />
        )}
      </AnimatePresence>

      <OllamaMaintenancePanel m={maintenance} />

      {isMobile
        ? <MobileLayout {...props} />
        : <DesktopLayout {...props} />
      }
    </div>
  )
}