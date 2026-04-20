import { motion, AnimatePresence } from "framer-motion"
import {
  X, Cpu, Activity, CheckCircle2, AlertCircle, Loader2, Server,
  Database, RefreshCcw, Wrench, Shield, Terminal, Globe,
  Zap, GitBranch, BanIcon, Star,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useModels, useInstances, useSystemPrompt, useSaveSystemPrompt,
} from "@/hooks/use-api"
import { useConnectivity } from "@/hooks/use-connectivity"
import { useSystemStats } from "@/hooks/use-system-stats"
import { useEffect, useRef, useState, useMemo, useCallback } from "react"
import { InferenceSettings } from "./McpManager"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  selectedModel: string
  onModelChange: (model: string) => void
  onClose: () => void
}

// ─── useRollingNumber ─────────────────────────────────────────────────────────

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
      setVal(Math.round(f + (target - f) * (1 - Math.pow(1 - t, 3))))
      if (t < 1) frame.current = requestAnimationFrame(run)
      else setVal(target)
    }
    frame.current = requestAnimationFrame(run)
    return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [target, ms])
  return val
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  label, value, icon, accent = false, warn = false, animate = true,
}: {
  label: string; value: number | string; icon: React.ReactNode
  accent?: boolean; warn?: boolean; animate?: boolean
}) {
  const numVal = typeof value === "number" ? value : null
  const rolled = numVal !== null ? useRollingNumber(numVal) : null
  const display = rolled !== null ? rolled : value

  return (
    <div className={`relative flex flex-col gap-2 rounded-xl border px-3 py-2.5 overflow-hidden transition-colors ${
      warn
        ? "border-orange-500/20 bg-orange-500/5"
        : accent
          ? "border-primary/18 bg-primary/5"
          : "border-border/25 bg-secondary/10"
    }`}>
      <div className="flex items-center justify-between">
        <span className={`text-[8.5px] font-mono font-bold uppercase tracking-[0.22em] ${
          warn ? "text-orange-400/70" : accent ? "text-primary/70" : "text-muted-foreground"
        }`}>{label}</span>
        <span className={warn ? "text-orange-400/60" : accent ? "text-primary/60" : "text-muted-foreground/50"}>
          {icon}
        </span>
      </div>
      <span className={`text-xl font-mono font-black tabular-nums leading-none ${
        warn ? "text-orange-400" : accent ? "text-primary" : "text-foreground"
      }`}>
        {display}
      </span>
    </div>
  )
}

// ─── SectionBox ───────────────────────────────────────────────────────────────

function SectionBox({
  title, icon, children, action,
}: {
  title: string; icon: React.ReactNode; children: React.ReactNode; action?: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-border/25 bg-secondary/8 overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/20 bg-secondary/10">
        <div className="flex items-center gap-1.5">
          <span className="text-muted-foreground/70">{icon}</span>
          <span className="text-[8.5px] font-mono font-black uppercase tracking-[0.24em] text-muted-foreground">{title}</span>
        </div>
        {action}
      </div>
      <div className="px-3 py-3 space-y-2">
        {children}
      </div>
    </div>
  )
}

// ─── DataRow ──────────────────────────────────────────────────────────────────

function DataRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 min-h-5">
      <span className="text-[10px] font-mono text-muted-foreground shrink-0">{label}</span>
      <span className="text-[10px] font-mono text-foreground text-right">{value}</span>
    </div>
  )
}

// ─── SystemPromptEditor ───────────────────────────────────────────────────────

function SystemPromptEditor() {
  const { data: prompt, isLoading } = useSystemPrompt()
  const { mutateAsync: save, isPending } = useSaveSystemPrompt()
  const [draft, setDraft] = useState("")
  const [saved, setSaved] = useState(false)
  const [charCount, setCharCount] = useState(0)

  useEffect(() => {
    if (prompt !== undefined) {
      setDraft(prompt)
      setCharCount(prompt.length)
    }
  }, [prompt])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value)
    setCharCount(e.target.value.length)
  }

  const handleSave = async () => {
    await save(draft)
    setSaved(true)
    setTimeout(() => setSaved(false), 2200)
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <textarea
          value={draft}
          onChange={handleChange}
          placeholder="Enter a master system prompt injected into every request…"
          rows={6}
          className="w-full rounded-xl border border-border/30 bg-background/40 px-3 py-2.5 text-[11px] font-mono text-foreground placeholder:text-muted-foreground/40 resize-none focus:outline-none focus:border-primary/35 transition-colors leading-relaxed"
        />
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-sm">
            <Loader2 size={16} className="animate-spin text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[9px] font-mono text-muted-foreground/50 tabular-nums">{charCount} chars</span>
        <button
          onClick={handleSave}
          disabled={isPending}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[9.5px] font-mono font-bold uppercase tracking-[0.2em] transition-all ${
            saved
              ? "bg-primary/15 text-primary border border-primary/25"
              : "bg-primary text-primary-foreground hover:bg-primary/90"
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {isPending
            ? <Loader2 size={11} className="animate-spin" />
            : saved
              ? <CheckCircle2 size={11} />
              : null
          }
          {isPending ? "Saving…" : saved ? "Saved" : "Save Prompt"}
        </button>
      </div>
    </div>
  )
}

// ─── InstanceRow ──────────────────────────────────────────────────────────────

function InstanceRow({
  name, inst, bannedUntil,
}: {
  name: string
  inst: { base_url: string; active: boolean; managed: boolean; is_local?: boolean; is_main?: boolean }
  bannedUntil: number
}) {
  const now = Date.now()
  const isBanned = bannedUntil * 1000 > now
  const isActive = inst.active !== false && !isBanned
  const timeLeft = isBanned ? Math.ceil((bannedUntil * 1000 - now) / 1000) : 0

  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      className="flex items-center gap-3 rounded-xl border border-border/20 bg-background/30 px-3 py-2.5 hover:border-border/35 transition-colors"
    >
      {/* Status dot */}
      <div className="relative shrink-0">
        <div className={`w-2 h-2 rounded-full ${
          isBanned ? "bg-red-500" : isActive ? "bg-primary" : "bg-muted-foreground/30"
        }`} />
        {isActive && !isBanned && (
          <motion.div
            animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="absolute inset-0 rounded-full bg-primary"
          />
        )}
      </div>

      {/* Name + URL */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-mono font-semibold text-foreground truncate">{name}</span>
          {inst.is_main && (
            <Star size={9} className="text-primary shrink-0 fill-primary" />
          )}
        </div>
        <div className="text-[9px] font-mono text-muted-foreground/60 truncate mt-px">{inst.base_url}</div>
      </div>

      {/* Tags */}
      <div className="flex items-center gap-1 shrink-0">
        {inst.managed && (
          <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/60 bg-secondary/20">MGD</span>
        )}
        {inst.is_local && (
          <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-border/30 text-muted-foreground/60 bg-secondary/20">LOC</span>
        )}
        {isBanned && (
          <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-red-500/25 text-red-400 bg-red-500/7">
            BAN {timeLeft}s
          </span>
        )}
        {!isActive && !isBanned && (
          <span className="text-[7.5px] font-mono px-1.5 py-0.5 rounded border border-border/25 text-muted-foreground/50 bg-secondary/10">OFF</span>
        )}
      </div>
    </motion.div>
  )
}

// ─── ModelSelector ────────────────────────────────────────────────────────────

function ModelSelector({ selectedModel, onModelChange }: {
  selectedModel: string; onModelChange: (m: string) => void
}) {
  const { data: models, isLoading } = useModels()
  return (
    <Select value={selectedModel} onValueChange={onModelChange}>
      <SelectTrigger className="w-full h-10 text-[11px] font-mono bg-background/40 border-border/30 focus:border-primary/40">
        <SelectValue placeholder="Select model…" />
      </SelectTrigger>
      <SelectContent className="bg-card/96 backdrop-blur-2xl border-border/35 rounded-xl shadow-2xl">
        {isLoading ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          </div>
        ) : !models?.length ? (
          <div className="p-4 text-center text-[10px] font-mono text-muted-foreground">No models available</div>
        ) : (
          models.map(model => (
            <SelectItem key={model} value={model} className="text-[11px] font-mono rounded-lg">
              {model}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}

// ─── SettingsPanel ────────────────────────────────────────────────────────────

export function SettingsPanel({ selectedModel, onModelChange, onClose }: Props) {
  const { data: instances, isLoading: instLoading } = useInstances({ refetchInterval: 500 })
  const { isOffline, isApiDown } = useConnectivity()
  const isConnected = !isOffline && !isApiDown
  const { data: stats } = useSystemStats()

  const baseUrl = import.meta.env.VITE_API_URL
    || `${window.location.protocol}//${window.location.hostname}:11111`

  // Derived cluster stats
  const { activeNodes, bannedNodes, managedNodes, totalNodes } = useMemo(() => {
    if (!instances) return { activeNodes: 0, bannedNodes: 0, managedNodes: 0, totalNodes: 0 }
    const now = Date.now()
    const entries = Object.entries(instances)
    return {
      totalNodes: entries.length,
      managedNodes: entries.filter(([, i]) => i.managed).length,
      bannedNodes: Object.entries(stats?.banned_until ?? {}).filter(([, ts]) => ts * 1000 > now).length,
      activeNodes: entries.filter(([name, inst]) => {
        const bu = (stats?.banned_until?.[name] ?? 0) * 1000
        return bu <= now && inst.active !== false
      }).length,
    }
  }, [instances, stats])

  const totalReqs = stats?.total_requests ?? 0

  const triggerUpdate = useCallback(() => fetch(`${baseUrl}/admin/update`, { method: "POST" }), [baseUrl])
  const triggerRebuild = useCallback(() => fetch(`${baseUrl}/admin/rebuild`, { method: "POST" }), [baseUrl])

  const isUpdating = stats?.maintenance?.running
    const isLatest = stats?.isLatest
    const disabledUpdate = isUpdating || isLatest || !isConnected

  return (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.14 }}
        className="fixed inset-0 bg-background/55 backdrop-blur-xl z-50 flex items-end md:items-center justify-center p-4"
        onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose()
        }}
        >
        <motion.div
            initial={{ y: 28, scale: 0.96, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: 28, scale: 0.96, opacity: 0 }}
            transition={{ type: "spring", damping: 27, stiffness: 330 }}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="w-full md:w-[560px] max-h-[88vh] flex flex-col bg-card/82 border border-border/38 rounded-2xl shadow-2xl shadow-black/35 backdrop-blur-2xl overflow-hidden"
        >
        {/* ── Panel header ── */}
        <div className="shrink-0 flex items-center justify-between gap-3 px-5 py-3 border-b border-border/28 bg-secondary/8">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-xl bg-primary/10 border border-primary/15">
              <Cpu size={13} className="text-primary" />
            </div>
            <div>
              <div className="text-[9px] font-mono font-black uppercase tracking-[0.28em] text-foreground/75">
                System Configuration
              </div>
              <div className="text-[8px] font-mono text-muted-foreground/60 mt-px tracking-wide">
                MoLLAMA · Cluster Control Panel
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[8.5px] font-mono font-bold uppercase tracking-[0.15em] ${
              isConnected
                ? "border-primary/18 bg-primary/6 text-primary"
                : "border-orange-500/20 bg-orange-500/6 text-orange-400"
            }`}>
              {isConnected
                ? <CheckCircle2 size={9} />
                : <motion.span animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.1, repeat: Infinity }}>
                    <AlertCircle size={9} />
                  </motion.span>
              }
              {isConnected ? "Online" : "Offline"}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* ── Tabs ── */}
        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="shrink-0 mx-4 mt-3 rounded-xl bg-secondary/12 border border-border/18 p-0.5 gap-0.5">
            {[
              { v: "overview",   icon: <Activity  size={10} />, label: "Overview"  },
              { v: "cluster",    icon: <Server    size={10} />, label: "Cluster"   },
              { v: "ollama",     icon: <Shield    size={10} />, label: "Ollama"    },
              { v: "model",      icon: <Database  size={10} />, label: "Model"     },
              { v: "inference",  icon: <Zap       size={10} />, label: "Inference" },
            ].map(t => (
              <TabsTrigger
                key={t.v} value={t.v}
                className="flex-1 flex items-center justify-center gap-1.5 text-[8.5px] font-mono font-bold uppercase tracking-[0.14em] py-1.5 rounded-lg"
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb:hover]:bg-border/50">

            {/* ─── Overview ─── */}
            <TabsContent value="overview" className="mt-0 space-y-3">
              {/* Metric grid */}
              <div className="grid grid-cols-2 gap-2">
                <MetricCard label="Active Nodes" value={activeNodes}
                  icon={<Server size={13} />} accent />
                <MetricCard label="Total Requests" value={totalReqs}
                  icon={<Activity size={13} />} />
                <MetricCard label="Managed" value={managedNodes}
                  icon={<Zap size={13} />} />
                <MetricCard label="Banned Nodes" value={bannedNodes}
                  icon={<BanIcon size={13} />} warn={bannedNodes > 0} />
              </div>

              {/* Connectivity */}
              <SectionBox title="Connectivity" icon={<Globe size={10} />}>
                <DataRow label="Link Status" value={
                  isConnected
                    ? <span className="flex items-center gap-1 text-primary"><CheckCircle2 size={10} /> Stable</span>
                    : <span className="flex items-center gap-1 text-orange-400 animate-pulse"><AlertCircle size={10} /> Disconnected</span>
                } />
                <DataRow label="Backend Host" value={`${window.location.hostname}:11111`} />
                <DataRow label="Protocol" value={window.location.protocol.replace(":", "").toUpperCase()} />
                <DataRow label="Instances Online" value={`${activeNodes} / ${totalNodes}`} />
              </SectionBox>

              {/* System Prompt */}
              <SectionBox title="Master System Prompt" icon={<Terminal size={10} />}>
                <SystemPromptEditor />
              </SectionBox>
            </TabsContent>

            {/* ─── Cluster ─── */}
            <TabsContent value="cluster" className="mt-0 space-y-3">
              {/* Summary row */}
              <div className="grid grid-cols-4 gap-1.5">
                {[
                  { label: "Total", value: totalNodes },
                  { label: "Active", value: activeNodes, accent: true },
                  { label: "Managed", value: managedNodes },
                  { label: "Banned", value: bannedNodes, warn: bannedNodes > 0 },
                ].map(c => (
                  <div key={c.label} className={`text-center rounded-xl border py-2 ${
                    c.warn ? "border-orange-500/18 bg-orange-500/5" :
                    c.accent ? "border-primary/16 bg-primary/5" :
                    "border-border/20 bg-secondary/8"
                  }`}>
                    <div className="text-[8px] font-mono uppercase tracking-widest text-muted-foreground">{c.label}</div>
                    <div className={`text-sm font-mono font-black mt-0.5 tabular-nums ${
                      c.warn ? "text-orange-400" : c.accent ? "text-primary" : "text-foreground"
                    }`}>{c.value}</div>
                  </div>
                ))}
              </div>

              {/* Instance list */}
              {instLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 size={18} className="animate-spin text-muted-foreground" />
                </div>
              ) : instances && Object.keys(instances).length > 0 ? (
                <div className="space-y-1.5">
                  {Object.entries(instances).map(([name, inst]) => (
                    <InstanceRow
                      key={name}
                      name={name}
                      inst={inst}
                      bannedUntil={stats?.banned_until?.[name] ?? 0}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 gap-2">
                  <Server size={24} className="text-muted-foreground/30" />
                  <span className="text-[10px] font-mono text-muted-foreground/50">No instances registered</span>
                </div>
              )}
            </TabsContent>

            {/* ─── Ollama ─── */}
            <TabsContent value="ollama" className="mt-0 space-y-3">
              {/* Version comparison */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-border/25 bg-secondary/10 px-3 py-3">
                  <div className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground">Installed</div>
                  <div className="text-base font-mono font-bold text-foreground mt-1.5 tabular-nums">
                    {stats?.currentOllamaVersion ?? "—"}
                  </div>
                </div>
                <div className={`rounded-xl border px-3 py-3 ${
                  stats?.isLatest
                    ? "border-primary/18 bg-primary/5"
                    : "border-orange-500/20 bg-orange-500/5"
                }`}>
                  <div className="text-[8.5px] font-mono uppercase tracking-widest text-muted-foreground">Latest</div>
                  <div className={`text-base font-mono font-bold mt-1.5 tabular-nums ${
                    stats?.isLatest ? "text-primary" : "text-orange-400"
                  }`}>
                    {stats?.latestOllamaVersion ?? "—"}
                  </div>
                </div>
              </div>

              {/* Status banner */}
              <div className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 ${
                stats?.isLatest
                  ? "border-primary/18 bg-primary/5"
                  : "border-orange-500/20 bg-orange-500/5"
              }`}>
                {stats?.isLatest
                  ? <CheckCircle2 size={15} className="text-primary mt-px shrink-0" />
                  : <AlertCircle size={15} className="text-orange-400 mt-px shrink-0" />
                }
                <div>
                  <div className={`text-[11px] font-semibold ${stats?.isLatest ? "text-primary" : "text-orange-400"}`}>
                    {stats?.isLatest ? "Ollama is up to date" : "Update available"}
                  </div>
                  <div className="text-[9.5px] font-mono text-muted-foreground mt-0.5">
                    {stats?.isLatest
                      ? "No action required."
                      : `${stats?.currentOllamaVersion ?? "?"} → ${stats?.latestOllamaVersion ?? "?"}`
                    }
                  </div>
                </div>
              </div>

              {/* Active maintenance */}
              {stats?.maintenance?.running && (
                <SectionBox title="Maintenance Active" icon={<Zap size={10} />}>
                  <DataRow label="Phase" value={stats.maintenance.state} />
                  <DataRow label="Progress" value={`${stats.maintenance.progress}%`} />
                  <div className="h-1.5 rounded-full bg-secondary/50 overflow-hidden mt-1">
                    <motion.div
                      animate={{ width: `${stats.maintenance.progress}%` }}
                      transition={{ duration: 0.4 }}
                      className="h-full bg-primary rounded-full"
                    />
                  </div>
                </SectionBox>
              )}

              {/* Action buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                    onClick={triggerUpdate}
                    disabled={disabledUpdate}
                    className={`flex items-center justify-center gap-1.5 rounded-xl bg-primary px-3 py-2.5 text-[9.5px] font-mono font-black uppercase tracking-[0.2em] text-primary-foreground transition-all active:scale-95
                    ${disabledUpdate
                        ? "opacity-40 cursor-not-allowed"
                        : "hover:bg-primary/90"
                    }`}
                    >
                    {isUpdating ? (
                        <Loader2 size={11} className="animate-spin" />
                    ) : (
                        <RefreshCcw size={11} />
                    )}
                    {isUpdating ? "Updating…" : isLatest ? "Up to date" : "Update Ollama"}
                </button>
                <button
                  onClick={triggerRebuild}
                  disabled={stats?.maintenance?.running}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-border/35 bg-secondary/18 px-3 py-2.5 text-[9.5px] font-mono font-black uppercase tracking-[0.2em] text-foreground/75 hover:bg-secondary/40 transition-all active:scale-95"
                >
                  <Wrench size={11} />
                  Rebuild Nodes
                </button>
              </div>

              <SectionBox title="Runtime Info" icon={<GitBranch size={10} />}>
                <DataRow label="Managed Instances" value={managedNodes} />
                <DataRow label="Total Cluster Nodes" value={totalNodes} />
                <DataRow label="Update Check" value="Every 500ms" />
              </SectionBox>
            </TabsContent>

            {/* ─── Inference ─── */}
            <TabsContent value="inference" className="mt-0 space-y-3">
              <SectionBox title="Context Management" icon={<Zap size={10} />}>
                <p className="text-[9px] font-mono text-muted-foreground/50 leading-relaxed mb-2">
                  Controls how chat history is handled between messages to keep the context window efficient.
                </p>
                <InferenceSettings />
              </SectionBox>

              <SectionBox title="Routing Info" icon={<GitBranch size={10} />}>
                <DataRow label="Compact trigger" value="Every 3 messages" />
                <DataRow label="History kept" value="Last 3 messages" />
                <DataRow label="Compression" value="LLM summarisation" />
              </SectionBox>
            </TabsContent>

            {/* ─── Model ─── */}
            <TabsContent value="model" className="mt-0 space-y-3">
              <SectionBox title="Active Model Engine" icon={<Database size={10} />}>
                <ModelSelector selectedModel={selectedModel} onModelChange={onModelChange} />
              </SectionBox>

              {selectedModel && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl border border-primary/15 bg-primary/5 px-3.5 py-3"
                >
                  <div className="text-[8.5px] font-mono uppercase tracking-widest text-primary/70 mb-1.5">Currently Active</div>
                  <div className="text-[13px] font-mono font-semibold text-foreground">{selectedModel}</div>
                </motion.div>
              )}

              <SectionBox title="Routing Info" icon={<Zap size={10} />}>
                <DataRow label="Strategy" value="Round-robin + health" />
                <DataRow label="Failover" value="Auto (ban + retry)" />
                <DataRow label="Virtual model" value={
                  <span className="text-primary font-mono">mollama</span>
                } />
              </SectionBox>
            </TabsContent>
          </div>
        </Tabs>

        {/* ── Footer ── */}
        <div className="shrink-0 flex gap-2 px-4 py-3 border-t border-border/25 bg-secondary/5">
          <Button
            variant="secondary"
            onClick={onClose}
            className="flex-1 h-9 text-[9.5px] font-mono uppercase tracking-[0.22em]"
          >
            Close
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}