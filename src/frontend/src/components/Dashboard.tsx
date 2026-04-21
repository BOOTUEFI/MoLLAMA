import React, { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Panel, Group, Separator, usePanelRef } from "react-resizable-panels"
import { motion, AnimatePresence } from "framer-motion"
import { Badge } from "@/components/ui/badge"
import {
  Activity, Settings, MessageSquare, Server, Cpu, RefreshCcw,
  Pause, Play, X, ChevronDown, Loader2,
  Shield, Terminal, TrendingUp, AlertCircle, Wrench, Plug,
  PanelLeft, PanelRight, GripVertical,
  Brain, Sparkles, Clock, Bot, Swords, FolderOpen,
  ChevronLeft, ChevronRight,
} from "lucide-react"
import { LiveFeed } from "./LiveFeed"
import { ChatHub } from "./ChatHub"
import { InstanceManager } from "./InstanceManager"
import { ToolFileList, ToolEditorPane, ToolLeftPanel } from "./ToolsEditor"
import { McpManager } from "./McpManager"
import { SettingsPanel } from "./SettingsPanel"
import { ConnectionGuard } from "./ConnectionGuard"
import { MemoryPanel } from "./MemoryPanel"
import { SkillsEditor, SkillsProvider, SkillsList, SkillsMain } from "./SkillsEditor"
import { RoutinesPanel, RoutinesProvider, RoutinesList, RoutinesMain } from "./RoutinesPanel"
import { SubagentEditor, AgentsProvider, AgentsList, AgentsMain } from "./SubagentEditor"
import { WarRoom } from "./WarRoom"
import { ProjectsPanel, ProjectsProvider, ProjectsList, ProjectsMain } from "./ProjectsPanel"
import { useIsMobile } from "@/hooks/use-mobile"
import { useModels } from "@/hooks/use-api"
import { useConnectivity } from "@/hooks/use-connectivity"
import { useSystemStats } from "@/hooks/use-system-stats"
import {
  fetchInstances, fetchStats,
  updateOllama, rebuildOllama, pauseOllamaUpdate, stopOllamaUpdate,
} from "@/lib/api"

// ─── Types ───────────────────────────────────────────────────────────────────

type MaintenanceMode = "update" | "rebuild" | null
type SnapPos = "tl" | "tc" | "tr" | "lc" | "rc" | "bl" | "bc" | "br"

interface LogEntry { id: number; ts: number; message: string; kind: "info"|"error"|"success"|"warn" }
interface MaintenanceState {
  visible: boolean; minimized: boolean; running: boolean; paused: boolean
  mode: MaintenanceMode; progress: number; message: string; error: string | null
  currentVersion: string | null; latestVersion: string | null; isLatest: boolean
  managedCount: number; total: number; completed: number; logs: LogEntry[]
}

const INITIAL: MaintenanceState = {
  visible: true, minimized: true, running: false, paused: false,
  mode: null, progress: 0, message: "Idle", error: null,
  currentVersion: null, latestVersion: null, isLatest: false,
  managedCount: 0, total: 0, completed: 0, logs: [],
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
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })
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

function RingProgress({ value, size = 60, sw = 4, glow = false }: { value: number; size?: number; sw?: number; glow?: boolean }) {
  const r = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const offset = circ - (Math.min(value, 100) / 100) * circ
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={sw} stroke="hsl(var(--border))" opacity={0.25} />
      {glow && <circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={sw+4} stroke="hsl(var(--primary))"
        strokeDasharray={circ} strokeLinecap="round"
        style={{ strokeDashoffset: offset, opacity: 0.12, transition: "stroke-dashoffset 0.5s ease" }} />}
      <motion.circle cx={size/2} cy={size/2} r={r} fill="none" strokeWidth={sw} stroke="hsl(var(--primary))"
        strokeDasharray={circ} strokeLinecap="round"
        initial={{ strokeDashoffset: circ }}
        animate={{ strokeDashoffset: offset }}
        transition={{ duration: 0.5, ease: "easeOut" }} />
    </svg>
  )
}

// ─── useOllamaMaintenance ────────────────────────────────────────────────────

function useOllamaMaintenance() {
  const [state, setState] = useState<MaintenanceState>(INITIAL)
  const prevMsg = useRef("")

  const refresh = useCallback(async () => {
    try {
      const [stats, instances] = await Promise.all([fetchStats(), fetchInstances().catch(() => null)])
      const managedCount = instances ? Object.values(instances).filter(i => i.managed).length : 0
      const m = stats.maintenance
      setState(prev => {
        const newMsg = m?.message ?? (stats.isLatest ? "Ollama is up to date." : prev.message)
        const msgChanged = newMsg && newMsg !== prevMsg.current
        if (msgChanged) prevMsg.current = newMsg
        const newLogs = msgChanged ? [...prev.logs.slice(-79), mkLog(newMsg, m?.error ? "error" : "info")] : prev.logs
        return {
          ...prev, managedCount,
          running: m ? !!m.running : prev.running,
          paused: m ? !!m.paused : prev.paused,
          mode: m ? m.mode : prev.mode,
          progress: typeof m?.progress === "number" ? m.progress : prev.progress,
          message: newMsg, error: m?.error ?? null,
          currentVersion: stats.currentOllamaVersion ?? prev.currentVersion,
          latestVersion: stats.latestOllamaVersion ?? prev.latestVersion,
          isLatest: typeof stats.isLatest === "boolean" ? stats.isLatest : prev.isLatest,
          total: m?.total ?? prev.total, completed: m?.completed ?? prev.completed,
          visible: true, minimized: m?.running ? false : prev.minimized, logs: newLogs,
        }
      })
    } catch { /* swallow */ }
  }, [])

  useEffect(() => { void refresh(); const id = setInterval(() => void refresh(), 500); return () => clearInterval(id) }, [refresh])

  const appendLog = useCallback((msg: string, kind: LogEntry["kind"]) => {
    setState(p => ({ ...p, logs: [...p.logs.slice(-79), mkLog(msg, kind)] }))
  }, [])
  void appendLog // used indirectly

  const startUpdate = useCallback(async () => {
    setState(p => ({ ...p, visible: true, minimized: false, running: true, paused: false, mode: "update", progress: 3, message: "Starting update…", error: null, logs: [...p.logs.slice(-79), mkLog("Update triggered.", "info")] }))
    await updateOllama(); await refresh()
  }, [refresh])

  const startRebuild = useCallback(async () => {
    setState(p => ({ ...p, visible: true, minimized: false, running: true, paused: false, mode: "rebuild", progress: 5, message: "Starting rebuild…", error: null, logs: [...p.logs.slice(-79), mkLog("Rebuild triggered.", "info")] }))
    await rebuildOllama(); await refresh()
  }, [refresh])

  const stop = useCallback(async () => {
    await stopOllamaUpdate(); await refresh()
    setState(p => ({ ...p, running: false, paused: false, mode: null, minimized: true, message: "Stopped.", logs: [...p.logs.slice(-79), mkLog("Operation stopped by user.", "warn")] }))
  }, [refresh])

  const togglePause = useCallback(async () => {
    const next = !state.paused
    await pauseOllamaUpdate(next); await refresh()
    setState(p => ({ ...p, paused: next, message: next ? "Paused." : "Resumed.", logs: [...p.logs.slice(-79), mkLog(next ? "Paused." : "Resumed.", "warn")] }))
  }, [refresh, state.paused])

  return {
    ...state, startUpdate, startRebuild, stop, togglePause,
    minimize: useCallback(() => setState(p => ({ ...p, minimized: true })), []),
    expand: useCallback(() => setState(p => ({ ...p, minimized: false, visible: true })), []),
    refresh,
  }
}

type Maintenance = ReturnType<typeof useOllamaMaintenance>

// ─── OllamaMaintenancePanel (slide-out with snap positions) ──────────────────

const PANEL_W = 368
const PANEL_H = 430
const TAB_W  = 168  // approx width of minimised tab trigger
const TAB_H  = 48   // approx height of minimised tab trigger

/** Panel top-left position for a given snap. */
function getPanelCoords(s: SnapPos): { x: number; y: number } {
  const w = window.innerWidth, h = window.innerHeight, G = 8
  switch (s) {
    case "tl": return { x: G,                    y: G }
    case "tc": return { x: w / 2 - PANEL_W / 2,  y: G }
    case "tr": return { x: w - PANEL_W - G,       y: G }
    case "lc": return { x: G,                    y: h / 2 - PANEL_H / 2 }
    case "rc": return { x: w - PANEL_W - G,       y: h / 2 - PANEL_H / 2 }
    case "bl": return { x: G,                    y: h - PANEL_H - G }
    case "bc": return { x: w / 2 - PANEL_W / 2,  y: h - PANEL_H - G }
    case "br": return { x: w - PANEL_W - G,       y: h - PANEL_H - G }
  }
}

/** Tab top-left position for a given snap — uses TAB dimensions so it anchors to the correct corner. */
function getTabCoords(s: SnapPos): { x: number; y: number } {
  const w = window.innerWidth, h = window.innerHeight, G = 8
  switch (s) {
    case "tl": return { x: G,                   y: G }
    case "tc": return { x: w / 2 - TAB_W / 2,   y: G }
    case "tr": return { x: w - TAB_W - G,        y: G }
    case "lc": return { x: G,                   y: h / 2 - TAB_H / 2 }
    case "rc": return { x: w - TAB_W - G,        y: h / 2 - TAB_H / 2 }
    case "bl": return { x: G,                   y: h - TAB_H - G }
    case "bc": return { x: w / 2 - TAB_W / 2,   y: h - TAB_H - G }
    case "br": return { x: w - TAB_W - G,        y: h - TAB_H - G }
  }
}

/** Find nearest snap using TAB coords as anchor — prevents mismatch when dragging tab. */
function getNearestSnap(x: number, y: number): SnapPos {
  const SNAPS: SnapPos[] = ["tl", "tc", "tr", "lc", "rc", "bl", "bc", "br"]
  let best: SnapPos = "br", bestDist = Infinity
  for (const s of SNAPS) {
    const c = getTabCoords(s)
    const d = Math.hypot(x - c.x, y - c.y)
    if (d < bestDist) { bestDist = d; best = s }
  }
  return best
}

function OllamaMaintenancePanel({ m }: { m: Maintenance }) {
  const [snap, setSnap] = useState<SnapPos>(() => (localStorage.getItem("mollama_console_snap") as SnapPos) || "br")
  const [open, setOpen] = useState(false)
  // Separate positions for tab and panel so they always anchor correctly
  const [tabPos, setTabPos]     = useState<{ x: number; y: number }>(() => getTabCoords((localStorage.getItem("mollama_console_snap") as SnapPos) || "br"))
  const [panelPos, setPanelPos] = useState<{ x: number; y: number }>(() => getPanelCoords((localStorage.getItem("mollama_console_snap") as SnapPos) || "br"))
  const logsEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    localStorage.setItem("mollama_console_snap", snap)
    setTabPos(getTabCoords(snap))
    setPanelPos(getPanelCoords(snap))
  }, [snap])

  useEffect(() => { logsEnd.current?.scrollIntoView({ behavior: "smooth" }) }, [m.logs.length])
  useEffect(() => { if (m.running) setOpen(true) }, [m.running])

  // slide direction: if panel is on the left half, slide from left; right half, slide from right
  const isLeft = panelPos.x < window.innerWidth / 2
  const slideDir = isLeft ? -1 : 1

  const statusText = useMemo(() => {
    if (m.error) return m.error
    if (m.running && m.paused) return "Paused"
    if (m.running && m.mode === "update") return "Updating Ollama"
    if (m.running && m.mode === "rebuild") return "Rebuilding instances"
    if (m.isLatest) return "Healthy"
    if (m.latestVersion && m.currentVersion && m.latestVersion !== m.currentVersion) return "Update available"
    return "Ready"
  }, [m.error, m.running, m.paused, m.mode, m.isLatest, m.latestVersion, m.currentVersion])

  const phase = getPhase(m.progress, m.mode)

  const tabStyle   = { position: "fixed" as const, left: tabPos.x,   top: tabPos.y,   zIndex: 50 }
  const panelStyle = { position: "fixed" as const, left: panelPos.x, top: panelPos.y, zIndex: 50, width: Math.min(PANEL_W, window.innerWidth - 12) }

  return (
    <>
      {/* ── Tab trigger (always visible, draggable) ── */}
      <AnimatePresence mode="wait">
        {!open && (
          <motion.div
            key="tab"
            style={tabStyle}
            drag
            dragMomentum={false}
            dragElastic={0.05}
            onDragEnd={(_, info) => {
              const newX = tabPos.x + info.offset.x
              const newY = tabPos.y + info.offset.y
              const nearest = getNearestSnap(newX, newY)
              setSnap(nearest)
            }}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.85 }}
            className="cursor-grab active:cursor-grabbing"
          >
            <button
              onClick={() => setOpen(true)}
              className="group flex items-center gap-2 rounded-xl border border-border/35 bg-card/90 backdrop-blur-xl px-2.5 py-2 shadow-lg hover:border-primary/40 hover:bg-card/95 transition-all duration-150"
            >
              <div className="relative shrink-0">
                <RingProgress value={m.progress} size={28} sw={2.5} glow={m.running} />
                <div className="absolute inset-0 flex items-center justify-center">
                  {m.running ? <Loader2 size={8} className="animate-spin text-primary" /> : <Terminal size={7} className="text-primary" />}
                </div>
              </div>
              <div className="text-left">
                <div className="text-[7px] font-mono font-black uppercase tracking-[0.28em] text-muted-foreground leading-none">Ollama</div>
                <div className="text-[9px] font-semibold text-foreground/85 mt-0.5 leading-none">{statusText}</div>
              </div>
              {isLeft ? <ChevronRight size={10} className="text-muted-foreground/50" /> : <ChevronLeft size={10} className="text-muted-foreground/50" />}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Full slide-out panel (draggable) ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="console"
            style={panelStyle}
            drag
            dragMomentum={false}
            dragElastic={0.05}
            onDragEnd={(_, info) => {
              const newX = panelPos.x + info.offset.x
              const newY = panelPos.y + info.offset.y
              // Convert panel position back to nearest snap using panel-centre heuristic
              const cx = newX + PANEL_W / 2, cy = newY + PANEL_H / 2
              const nearest = getNearestSnap(cx - TAB_W / 2, cy - TAB_H / 2)
              setSnap(nearest)
            }}
            initial={{ opacity: 0, x: slideDir * (PANEL_W + 24) }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: slideDir * (PANEL_W + 24) }}
            transition={{ type: "spring", damping: 28, stiffness: 340 }}
            className="cursor-grab active:cursor-grabbing"
          >
            <div className="rounded-2xl border border-border/40 bg-card/97 backdrop-blur-2xl shadow-2xl shadow-black/35 overflow-hidden">

              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/25 bg-secondary/8">
                <div className="relative shrink-0">
                  <RingProgress value={m.progress} size={44} sw={3.5} glow={m.running && !m.paused} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-[8px] font-mono font-black text-primary tabular-nums">{m.progress}%</span>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[7.5px] font-mono font-black uppercase tracking-[0.3em] text-primary/70">
                    {m.mode === "update" ? "Ollama Update" : m.mode === "rebuild" ? "Instance Rebuild" : "Maintenance Console"}
                  </div>
                  <div className="text-[12px] font-semibold text-foreground leading-snug truncate mt-0.5">{statusText}</div>
                  {m.running && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <motion.span animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.2, repeat: Infinity }}
                        className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                      <span className="text-[8.5px] font-mono text-muted-foreground">{phase}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7px] font-mono text-muted-foreground/30 cursor-default select-none">drag to move</span>
                  <button onClick={() => setOpen(false)}
                    className="p-1 rounded-lg text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors cursor-pointer">
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>

              <div className="p-3 space-y-2.5">

                {/* Version row */}
                <div className="grid grid-cols-3 divide-x divide-border/30 rounded-xl border border-border/25 bg-secondary/8 overflow-hidden">
                  {[
                    { label: "Current", value: fmtVer(m.currentVersion), accent: false },
                    { label: "Latest", value: fmtVer(m.latestVersion), accent: !m.isLatest },
                    { label: m.total > 0 ? `${m.completed}/${m.total}` : `${m.managedCount} nodes`, value: m.total > 0 ? "done" : "managed", accent: false },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="flex flex-col items-center py-1.5 px-1">
                      <span className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground">{label}</span>
                      <span className={`text-[10px] font-mono font-bold mt-0.5 ${accent ? "text-orange-400" : "text-foreground"}`}>{value}</span>
                    </div>
                  ))}
                </div>

                {/* Progress bar */}
                <div className="h-1 rounded-full bg-secondary/40 overflow-hidden">
                  <motion.div animate={{ width: `${m.progress}%` }} transition={{ duration: 0.45, ease: "easeOut" }}
                    className={`h-full rounded-full ${m.paused ? "bg-orange-400" : m.running ? "bg-primary" : "bg-primary/45"}`} />
                </div>

                {/* Log tail */}
                {m.logs.length > 0 && (
                  <div className="rounded-xl border border-border/20 bg-background/40 overflow-hidden">
                    <div className="flex items-center gap-1.5 px-3 py-1 border-b border-border/15 bg-secondary/8">
                      <Terminal size={8} className="text-muted-foreground" />
                      <span className="text-[7.5px] font-mono font-bold uppercase tracking-[0.2em] text-muted-foreground">Log</span>
                      <span className="ml-auto text-[7px] font-mono text-muted-foreground/40">{m.logs.length}</span>
                    </div>
                    <div className="max-h-20 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border/25 px-3 py-1.5 space-y-[2px]">
                      {m.logs.slice(-10).map(log => (
                        <div key={log.id} className="flex items-start gap-2 font-mono text-[8.5px] leading-relaxed">
                          <span className="shrink-0 text-muted-foreground/35 tabular-nums">{fmtTime(log.ts)}</span>
                          <span className={log.kind === "error" ? "text-red-400" : log.kind === "success" ? "text-primary" : log.kind === "warn" ? "text-orange-400" : "text-muted-foreground"}>
                            {log.message}
                          </span>
                        </div>
                      ))}
                      <div ref={logsEnd} />
                    </div>
                  </div>
                )}

                {/* Error banner */}
                <AnimatePresence>
                  {m.error && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/6 px-3 py-2 text-[10px] font-mono text-red-400">
                      <AlertCircle size={11} className="mt-px shrink-0" />
                      <span>{m.error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Action buttons */}
                <div className="grid grid-cols-2 gap-1.5">
                  {[
                    { label: "Update", icon: <RefreshCcw size={10} />, onClick: m.startUpdate, disabled: m.running || m.isLatest, danger: false, primary: true },
                    { label: "Rebuild", icon: <Server size={10} />, onClick: m.startRebuild, disabled: m.running, danger: false, primary: false },
                    { label: m.paused ? "Resume" : "Pause", icon: m.paused ? <Play size={10} /> : <Pause size={10} />, onClick: m.togglePause, disabled: !m.running, danger: false, primary: false },
                    { label: "Stop", icon: <X size={10} />, onClick: m.stop, disabled: !m.running, danger: true, primary: false },
                  ].map(btn => (
                    <button key={btn.label} onClick={btn.onClick} disabled={btn.disabled}
                      className={`cursor-pointer flex items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-[9px] font-mono font-black uppercase tracking-[0.16em] disabled:opacity-35 disabled:cursor-not-allowed transition-all active:scale-95 ${
                        btn.primary ? "bg-primary text-primary-foreground hover:bg-primary/90" :
                        btn.danger ? "border border-red-500/20 bg-red-500/6 text-red-400 hover:bg-red-500/12" :
                        "border border-border/35 bg-secondary/18 text-foreground/70 hover:bg-secondary/45"
                      }`}>
                      {btn.icon}{btn.label}
                    </button>
                  ))}
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

function StatPill({ icon, label, value, accent = false, pulse = false }: {
  icon: React.ReactNode; label: string; value: number | string; accent?: boolean; pulse?: boolean
}) {
  const num = typeof value === "number" ? value : null
  const displayed = num !== null ? useRollingNumber(num) : value
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-mono transition-colors ${accent ? "border-primary/25 bg-primary/6 text-primary" : "border-border/20 bg-secondary/12 text-muted-foreground"}`}>
      <span className={accent ? "text-primary" : ""}>{icon}</span>
      <span className="text-[8.5px] uppercase tracking-widest">{label}</span>
      <span className={`text-[11px] font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"} ${pulse ? "animate-pulse" : ""}`}>{displayed}</span>
    </div>
  )
}

// ─── TopBar ──────────────────────────────────────────────────────────────────

function TopBar({
  selectedModel, onShowSettings, onUpdateOllama, updateBusy,
  onToggleLeft, onToggleRight, leftCollapsed, rightCollapsed,
}: {
  selectedModel: string; onShowSettings: () => void
  onUpdateOllama: () => void; updateBusy: boolean
  onToggleLeft?: () => void; onToggleRight?: () => void
  leftCollapsed?: boolean; rightCollapsed?: boolean
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

  const isSmart = selectedModel.toLowerCase().includes("smart") || selectedModel.toLowerCase().includes("mollama")

  return (
    <motion.header
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="relative shrink-0 h-11 border-b border-border/30 bg-card/25 backdrop-blur-3xl px-4 flex items-center justify-between gap-4 sticky top-0 z-40"
    >
      <div className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 3px,hsl(var(--border)/0.035) 3px,hsl(var(--border)/0.035) 4px)" }} />

      <div className="flex flex-row items-center gap-4 relative">
        <div className="relative">
          <motion.div
            animate={{ opacity: isDisconnected ? [0.3, 0.7, 0.3] : [0.45, 1, 0.45], scale: [1, 1.35, 1] }}
            transition={{ duration: isDisconnected ? 1.1 : 2.8, repeat: Infinity }}
            className={`absolute inset-0 rounded-full blur-[3px] ${isDisconnected ? "bg-orange-500/60" : "bg-primary/55"}`}
          />
          <div className={`relative w-2 h-2 rounded-full ${isDisconnected ? "bg-orange-500" : "bg-primary"}`} />
        </div>
        <span className="text-[11px] font-mono font-black uppercase h-fit leading-none tracking-[0.3em] text-foreground/95">MoLLAMA</span>
        <Badge variant="outline" className={`text-[7.5px] px-1.5 h-4 font-mono tracking-[0.18em] transition-all ${
          isDisconnected ? "bg-orange-500/9 border-orange-500/30 text-orange-400" : "bg-primary/6 border-primary/20 text-primary"
        }`}>
          {isDisconnected ? "OFFLINE" : "LIVE"}
        </Badge>
      </div>

      <div className="hidden lg:flex items-center gap-1.5 relative">
        <StatPill icon={<TrendingUp size={10} />} label="Req" value={totalReqs} />
        <StatPill icon={<Server size={10} />} label="Nodes" value={managedNodes - bannedCount} accent={managedNodes > 0} pulse />
        {bannedCount > 0 && <StatPill icon={<Shield size={10} />} label="Banned" value={bannedCount} pulse />}
      </div>

      <div className="flex items-center gap-1 relative">
        {selectedModel && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-border/20 bg-secondary/12 max-w-52">
            <Cpu size={10} className="text-muted-foreground shrink-0" />
            <span className="text-[9px] font-mono text-muted-foreground uppercase tracking-wider truncate">
              {isDisconnected ? "LINK LOST" : selectedModel}
            </span>
            {isSmart && (
              <Badge className="text-[7px] px-1 h-3.5 font-mono font-black tracking-[0.2em] bg-primary/15 border-primary/30 text-primary border shrink-0">
                SMART
              </Badge>
            )}
          </div>
        )}

        {!stats?.isLatest && (
          <button onClick={onUpdateOllama} disabled={updateBusy}
            className={`hidden md:inline-flex items-center gap-1.5 rounded-lg border border-border/30 bg-background/30 px-2.5 py-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.22em] text-foreground/65 hover:bg-secondary/50 hover:text-foreground disabled:opacity-45 disabled:cursor-not-allowed transition-colors ${updateBusy ? "cursor-wait" : ""}`}>
            {updateBusy ? <Loader2 size={10} className="animate-spin" /> : <RefreshCcw size={10} />}
            Update Ollama
          </button>
        )}

        {onToggleLeft !== undefined && (
          <button onClick={onToggleLeft} title={leftCollapsed ? "Show left panel" : "Hide left panel"}
            className={`p-1.5 rounded-lg transition-colors ${leftCollapsed ? "text-primary/60 hover:text-primary bg-primary/8" : "text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50"}`}>
            <PanelLeft size={13} />
          </button>
        )}
        {onToggleRight !== undefined && (
          <button onClick={onToggleRight} title={rightCollapsed ? "Show right panel" : "Hide right panel"}
            className={`p-1.5 rounded-lg transition-colors ${rightCollapsed ? "text-primary/60 hover:text-primary bg-primary/8" : "text-muted-foreground/50 hover:text-foreground hover:bg-secondary/50"}`}>
            <PanelRight size={13} />
          </button>
        )}
        <motion.button whileHover={{ scale: 1.1, rotate: 45 }} whileTap={{ scale: 0.9 }} onClick={onShowSettings}
          className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
          <Settings size={14} />
        </motion.button>
      </div>
    </motion.header>
  )
}

// ─── Layouts ─────────────────────────────────────────────────────────────────

function ResizeHandle() {
  return (
    <Separator className="group relative flex items-center justify-center w-[6px] mx-0.5">
      <div className="absolute inset-y-0 left-[2.5px] w-px bg-border/20 group-hover:bg-primary/40 group-data-[resize-handle-active]:bg-primary/70 transition-colors duration-150" />
      <div className="absolute z-10 h-8 w-3.5 rounded-full bg-background/0 group-hover:bg-background flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150 border border-transparent group-hover:border-border/30">
        <GripVertical size={8} className="text-muted-foreground/40" />
      </div>
    </Separator>
  )
}

// ─── Right panel tabs definition ─────────────────────────────────────────────

const RIGHT_TABS = [
  { v: "nodes",    icon: <Server size={12} />,    label: "Nodes"    },
  { v: "tools",    icon: <Wrench size={12} />,    label: "Tools"    },
  { v: "mcp",      icon: <Plug size={12} />,      label: "MCP"      },
  { v: "memory",   icon: <Brain size={12} />,     label: "Memory"   },
  { v: "skills",   icon: <Sparkles size={12} />,  label: "Skills"   },
  { v: "routines", icon: <Clock size={12} />,     label: "Routines" },
  { v: "agents",   icon: <Bot size={12} />,       label: "Agents"   },
  { v: "warroom",  icon: <Swords size={12} />,    label: "War Room" },
  { v: "projects", icon: <FolderOpen size={12} />, label: "Projects" },
]

// ─── VerticalNav ─────────────────────────────────────────────────────────────

function VerticalNav({
  tabs, active, onSelect, hiddenTab,
}: {
  tabs: typeof RIGHT_TABS
  active: string
  onSelect: (v: string) => void
  hiddenTab?: string
}) {
  return (
    <div className="h-full flex flex-col overflow-y-auto py-1.5 gap-0.5 [&::-webkit-scrollbar]:w-0">
      {tabs.filter(t => t.v !== hiddenTab).map(t => {
        const isActive = active === t.v
        return (
          <button
            key={t.v}
            onClick={() => onSelect(t.v)}
            className={[
              "mx-1 flex flex-col items-center justify-center gap-0.5 py-2.5 px-1 rounded-lg",
              "text-[7px] font-mono uppercase tracking-[0.08em] transition-all",
              isActive
                ? "bg-primary/12 text-primary border border-primary/20"
                : "text-muted-foreground/35 hover:text-muted-foreground/70 hover:bg-secondary/25 border border-transparent",
            ].join(" ")}
          >
            <span className={isActive ? "text-primary" : ""}>{t.icon}</span>
            <span className="leading-none text-center whitespace-nowrap">{t.label}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Section layout types ─────────────────────────────────────────────────────

type SectionTab = "skills" | "routines" | "agents" | "projects"
const SECTION_TABS = new Set<string>(["skills", "routines", "agents", "projects"])

const SECTION_PROVIDERS: Record<SectionTab, React.ComponentType<{ children: React.ReactNode }>> = {
  skills: SkillsProvider,
  routines: RoutinesProvider,
  agents: AgentsProvider,
  projects: ProjectsProvider,
}

const SECTION_LISTS: Record<SectionTab, React.ComponentType> = {
  skills: SkillsList,
  routines: RoutinesList,
  agents: AgentsList,
  projects: ProjectsList,
}

const SECTION_MAINS: Record<SectionTab, React.ComponentType> = {
  skills: SkillsMain,
  routines: RoutinesMain,
  agents: AgentsMain,
  projects: ProjectsMain,
}

function PassThrough({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// ─── DesktopLayout ───────────────────────────────────────────────────────────

function DesktopLayout({
  selectedModel, onModelChange, models, onShowSettings, onUpdateOllama, updateBusy, toolPath, setToolPath,
}: {
  selectedModel: string; onModelChange: (m: string) => void; models: string[]
  onShowSettings: () => void; onUpdateOllama: () => void; updateBusy: boolean
  toolPath: string | null; setToolPath: (p: string | null) => void
}) {
  const leftRef = usePanelRef()
  const rightRef = usePanelRef()
  const [leftCollapsed, setLeftCollapsed] = useState(() => localStorage.getItem("mollama_left_collapsed") === "true")
  const [rightCollapsed, setRightCollapsed] = useState(() => localStorage.getItem("mollama_right_collapsed") === "true")
  const [rightTab, setRightTab] = useState(() => localStorage.getItem("mollama_right_tab") || "nodes")

  useEffect(() => { localStorage.setItem("mollama_left_collapsed", String(leftCollapsed)) }, [leftCollapsed])
  useEffect(() => { localStorage.setItem("mollama_right_collapsed", String(rightCollapsed)) }, [rightCollapsed])
  useEffect(() => { localStorage.setItem("mollama_right_tab", rightTab) }, [rightTab])

  useEffect(() => {
    if (leftCollapsed) leftRef.current?.collapse()
    if (rightCollapsed) rightRef.current?.collapse()
  }, [])

  // When tool editor opens, switch away from tools tab in right panel
  useEffect(() => {
    if (toolPath && rightTab === "tools") setRightTab("nodes")
  }, [toolPath, rightTab])

  const toggleLeft = useCallback(() => {
    if (leftCollapsed) leftRef.current?.expand()
    else leftRef.current?.collapse()
  }, [leftCollapsed])

  const toggleRight = useCallback(() => {
    if (rightCollapsed) rightRef.current?.expand()
    else rightRef.current?.collapse()
  }, [rightCollapsed])

  const warRoomActive = rightTab === "warroom"
  const activeSection: SectionTab | null = SECTION_TABS.has(rightTab) ? rightTab as SectionTab : null

  useEffect(() => {
    if ((warRoomActive || activeSection) && rightCollapsed) rightRef.current?.expand()
  }, [warRoomActive, activeSection, rightCollapsed])

  // When a section is active, auto-expand left panel
  useEffect(() => {
    if (activeSection && leftCollapsed) leftRef.current?.expand()
  }, [activeSection, leftCollapsed])

  const SectionProvider = activeSection ? SECTION_PROVIDERS[activeSection] : PassThrough
  const SectionList = activeSection ? SECTION_LISTS[activeSection] : null
  const SectionMain = activeSection ? SECTION_MAINS[activeSection] : null

  // Right panel content for sections — just nav placeholder
  const sectionRightContent = activeSection ? (
    <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center">
      <div className="text-[10px] font-mono font-black uppercase tracking-[0.2em] text-foreground/50">
        {activeSection.charAt(0).toUpperCase() + activeSection.slice(1)}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground/30">
        Editor open in main area
      </div>
    </div>
  ) : null

  return (
    <SectionProvider>
      <div className="flex flex-col h-screen">
        <TopBar
          selectedModel={selectedModel} onShowSettings={onShowSettings}
          onUpdateOllama={onUpdateOllama} updateBusy={updateBusy}
          onToggleLeft={toggleLeft} onToggleRight={toggleRight}
          leftCollapsed={leftCollapsed} rightCollapsed={rightCollapsed}
        />
        <Group orientation="horizontal" className="flex-1 overflow-hidden px-2 pb-2 pt-1.5 gap-0">

          {/* Left panel */}
          <Panel panelRef={leftRef} id="left" defaultSize="22%" minSize="14%" collapsible collapsedSize="0%"
            onResize={(size) => setLeftCollapsed(size.asPercentage === 0)} className="overflow-hidden">
            <div className="h-full overflow-hidden">
              <AnimatePresence mode="wait">
                {toolPath ? (
                  <motion.div key="tool-left" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <ToolLeftPanel selectedPath={toolPath} onSelect={(p) => setToolPath(p)} fileCode="" model={selectedModel} />
                  </motion.div>
                ) : activeSection && SectionList ? (
                  <motion.div key={`section-list-${activeSection}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <SectionList />
                  </motion.div>
                ) : (
                  <motion.div key="feed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <LiveFeed />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Panel>

          <ResizeHandle />

          {/* Center panel */}
          <Panel id="center" minSize="28%" className="overflow-hidden">
            <div className="h-full overflow-hidden">
              <AnimatePresence mode="wait">
                {toolPath ? (
                  <motion.div key={`editor-${toolPath}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <ToolEditorPane selectedPath={toolPath} onClose={() => setToolPath(null)} />
                  </motion.div>
                ) : warRoomActive ? (
                  <motion.div key="warroom-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <WarRoom />
                  </motion.div>
                ) : activeSection && SectionMain ? (
                  <motion.div key={`section-main-${activeSection}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <SectionMain />
                  </motion.div>
                ) : (
                  <motion.div key="chat" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                    <ChatHub model={selectedModel} models={models} onModelChange={onModelChange} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Panel>

          <ResizeHandle />

          {/* Right panel — content + vertical nav on far right */}
          <Panel panelRef={rightRef} id="right" defaultSize="22%" minSize="14%" collapsible collapsedSize="0%"
            onResize={(size) => setRightCollapsed(size.asPercentage === 0)} className="overflow-hidden">
            <div className="h-full flex overflow-hidden gap-1">

              {/* Content area */}
              <div className="flex-1 min-w-0 overflow-hidden rounded-xl border border-border/20 bg-card/20">
                <AnimatePresence mode="wait">
                  <motion.div key={rightTab} initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -6 }} transition={{ duration: 0.12 }} className="h-full">
                    {rightTab === "nodes" && <InstanceManager />}
                    {rightTab === "tools" && !toolPath && <ToolFileList selectedPath={null} onSelect={setToolPath} />}
                    {rightTab === "mcp" && <McpManager />}
                    {rightTab === "memory" && <MemoryPanel />}
                    {activeSection && sectionRightContent}
                    {rightTab === "warroom" && (
                      <div className="h-full flex flex-col items-center justify-center gap-3 p-4 text-center">
                        <Swords size={28} className="text-primary/40" />
                        <div>
                          <div className="text-[11px] font-mono font-black uppercase tracking-[0.2em] text-foreground/70">War Room Active</div>
                          <div className="text-[10px] text-muted-foreground mt-1">Debate is running in the main area</div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </div>

              {/* Vertical nav strip — RIGHT side, fully rounded */}
              <div className="shrink-0 w-[54px] rounded-xl border border-border/20 bg-card/20 overflow-hidden">
                <VerticalNav
                  tabs={RIGHT_TABS}
                  active={rightTab}
                  onSelect={(v) => setRightTab(v)}
                  hiddenTab={toolPath ? "tools" : undefined}
                />
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </SectionProvider>
  )
}

// ─── MobileLayout ────────────────────────────────────────────────────────────

function MobileLayout({ selectedModel, onModelChange, models, onShowSettings, onUpdateOllama, updateBusy, toolPath, setToolPath }: {
  selectedModel: string; onModelChange: (m: string) => void; models: string[]
  onShowSettings: () => void; onUpdateOllama: () => void; updateBusy: boolean
  toolPath: string | null; setToolPath: (p: string | null) => void
}) {
  const [activeTab, setActiveTab] = useState("chat")

  const MOBILE_TABS = [
    { v: "chat",     icon: <MessageSquare size={12} />, label: "Chat"     },
    { v: "feed",     icon: <Activity      size={12} />, label: "Feed"     },
    { v: "nodes",    icon: <Server        size={12} />, label: "Nodes"    },
    { v: "tools",    icon: <Wrench        size={12} />, label: "Tools"    },
    { v: "mcp",      icon: <Plug          size={12} />, label: "MCP"      },
    { v: "memory",   icon: <Brain         size={12} />, label: "Memory"   },
    { v: "skills",   icon: <Sparkles      size={12} />, label: "Skills"   },
    { v: "routines", icon: <Clock         size={12} />, label: "Routines" },
    { v: "agents",   icon: <Bot           size={12} />, label: "Agents"   },
    { v: "warroom",  icon: <Swords        size={12} />, label: "War Room" },
    { v: "projects", icon: <FolderOpen    size={12} />, label: "Projects" },
  ]

  return (
    <div className="flex flex-col h-screen">
      <TopBar selectedModel={selectedModel} onShowSettings={onShowSettings} onUpdateOllama={onUpdateOllama} updateBusy={updateBusy} />
      <div className="shrink-0 mx-2 mt-2 rounded-xl border border-border/25 bg-secondary/12 overflow-x-auto">
        <div className="flex gap-0.5 p-1 min-w-max">
          {MOBILE_TABS.map(t => (
            <button key={t.v} onClick={() => setActiveTab(t.v)}
              className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[8.5px] font-mono uppercase tracking-widest transition-colors ${
                activeTab === t.v ? "bg-background/60 text-foreground shadow-sm" : "text-muted-foreground/40 hover:text-muted-foreground/70"
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-hidden p-2">
        {activeTab === "chat"     && <ChatHub model={selectedModel} models={models} onModelChange={onModelChange} />}
        {activeTab === "feed"     && <LiveFeed />}
        {activeTab === "nodes"    && <InstanceManager />}
        {activeTab === "tools"    && (toolPath ? <ToolEditorPane selectedPath={toolPath} onClose={() => setToolPath(null)} /> : <ToolFileList selectedPath={null} onSelect={setToolPath} />)}
        {activeTab === "mcp"      && <McpManager />}
        {activeTab === "memory"   && <MemoryPanel />}
        {activeTab === "skills"   && <SkillsEditor />}
        {activeTab === "routines" && <RoutinesPanel />}
        {activeTab === "agents"   && <SubagentEditor />}
        {activeTab === "warroom"  && <WarRoom />}
        {activeTab === "projects" && <ProjectsPanel />}
      </div>
    </div>
  )
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

export function Dashboard() {
  const isMobile = useIsMobile()
  const [showSettings, setShowSettings] = useState(false)
  const { data: models } = useModels()
  const [selectedModel, setSelectedModel] = useState(() => localStorage.getItem("mollama_model") || "")
  const [toolPath, setToolPath] = useState<string | null>(null)
  const maintenance = useOllamaMaintenance()

  useEffect(() => { if (models?.length && !selectedModel) setSelectedModel(models[0]) }, [models, selectedModel])
  useEffect(() => { if (selectedModel) localStorage.setItem("mollama_model", selectedModel) }, [selectedModel])

  const props = {
    selectedModel, onModelChange: setSelectedModel, models: models ?? [],
    onShowSettings: () => setShowSettings(true),
    onUpdateOllama: maintenance.startUpdate, updateBusy: maintenance.running,
    toolPath, setToolPath,
  }

  return (
    <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
      <div className="pointer-events-none fixed inset-0 opacity-[0.022]"
        style={{ backgroundImage: "radial-gradient(hsl(var(--foreground)) 1px,transparent 1px)", backgroundSize: "22px 22px" }} />

      <ConnectionGuard />

      <AnimatePresence mode="wait">
        {showSettings && (
          <SettingsPanel selectedModel={selectedModel} onModelChange={setSelectedModel} onClose={() => setShowSettings(false)} />
        )}
      </AnimatePresence>

      <OllamaMaintenancePanel m={maintenance} />

      {isMobile ? <MobileLayout {...props} /> : <DesktopLayout {...props} />}
    </div>
  )
}
