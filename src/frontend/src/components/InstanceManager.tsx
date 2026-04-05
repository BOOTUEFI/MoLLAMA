import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  useInstances, useProcessing, useDeployInstance, useBanInstance, useUnbanInstance,
  useStartInstance, useStopInstance, useRemoveInstance, useUpdateInstance,
  useSetMainNode, useUnsetMainNode, useDeleteModel, useInstanceModels,
} from "@/hooks/use-api"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Server, Plus, ChevronDown, Play, Square, ShieldBan, ShieldCheck,
  Trash2, Loader2, Key, Download, X, Cloud, Monitor, Package,
  Check, AlertTriangle, RefreshCw, Star, StarOff, Brain,
  Copy, ExternalLink, Zap, AlertCircle, Minus
} from "lucide-react"
import { API_BASE_URL, pullModelToAll, pullModelToInstance } from "@/lib/api"
import { useQueryClient } from "@tanstack/react-query"

// ── Tiny label for dropdown sections ─────────────────────────────────────────

function MenuLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 pt-2 pb-1 text-[9px] font-black uppercase tracking-[0.18em] text-muted-foreground/30 select-none">
      {children}
    </div>
  )
}

// ── Status Badge ──────────────────────────────────────────────────────────────

function StatusBadge({ state }: { state: "idle" | "processing" | "banned" | "off" }) {
  const cfg = {
    idle:       { label: "READY",   cls: "bg-purple-500/10 border-purple-500/20 text-purple-400" },
    processing: { label: "ACTIVE",  cls: "bg-blue-500/10 border-blue-500/20 text-blue-400" },
    banned:     { label: "BANNED",  cls: "bg-orange-500/10 border-orange-500/20 text-orange-400" },
    off:        { label: "OFFLINE", cls: "bg-zinc-500/10 border-zinc-500/20 text-zinc-500" },
  }[state]
  return (
    <div className={`px-2 py-0.5 rounded-lg border text-[8px] font-black tracking-tighter uppercase ${cfg.cls}`}>
      {cfg.label}
    </div>
  )
}

// ── Nuclear Core ──────────────────────────────────────────────────────────────

function NuclearCore({ state, isProcessing, pulseKey }: {
  state: "idle" | "processing" | "banned" | "off"
  isProcessing: boolean
  pulseKey: number
}) {
  const [pulseSeq, setPulseSeq] = useState(0)
  const lastKey = useRef(pulseKey)
  const queueRef = useRef(0)
  const drainRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const diff = pulseKey - lastKey.current
    lastKey.current = pulseKey
    if (!isProcessing || diff <= 0) return
    queueRef.current += diff
    if (!drainRef.current) {
      drainRef.current = setInterval(() => {
        if (queueRef.current <= 0) { clearInterval(drainRef.current!); drainRef.current = null; return }
        queueRef.current -= 1
        setPulseSeq(v => v + 1)
      }, 22)
    }
  }, [pulseKey, isProcessing])

  useEffect(() => () => { if (drainRef.current) clearInterval(drainRef.current) }, [])

  const colors = {
    idle: "rgba(168,85,247,0.12)", processing: "rgba(59,130,246,0.18)",
    banned: "rgba(249,115,22,0.18)", off: "rgba(0,0,0,0)",
  }

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-xl z-0">
      {(state === "idle" || state === "processing") && (
        <motion.div
          animate={{ scale: isProcessing ? [1,1.06,1] : [1,1.03,1], opacity: isProcessing ? [0.06,0.12,0.06] : [0.04,0.08,0.04] }}
          transition={{ duration: isProcessing ? 1.35 : 4.5, repeat: Infinity, ease: "easeInOut" }}
          className="absolute inset-0"
          style={{ background: `radial-gradient(circle at 50% 50%, ${colors[state]} 0%, transparent 85%)` }}
        />
      )}
      {state === "banned" && (
        <div className="absolute inset-0 opacity-15" style={{ background: `radial-gradient(circle at 50% 50%, ${colors.banned} 0%, transparent 85%)` }} />
      )}
      <AnimatePresence mode="popLayout">
        {isProcessing && (
          <motion.div key={pulseSeq} initial={{ scale: 0.42, opacity: 0.95 }} animate={{ scale: 2.35, opacity: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
            className="absolute inset-0 border border-blue-300/80 rounded-full"
            style={{ boxShadow: "0 0 18px rgba(59,130,246,0.28), inset 0 0 18px rgba(59,130,246,0.12)" }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Manage Models Dialog ──────────────────────────────────────────────────────

function ManageModelsDialog({ instanceName, onClose }: { instanceName: string | null; onClose: () => void }) {
  const qc = useQueryClient()
  const { data: models = [], isLoading, refetch } = useInstanceModels(instanceName)
  const deleteMutation = useDeleteModel()

  const [pullInput, setPullInput] = useState("")
  const [isPulling, setIsPulling] = useState(false)
  const [pullStatus, setPullStatus] = useState("")
  const [pullDone, setPullDone] = useState(false)
  const [deletingModel, setDeletingModel] = useState<string | null>(null)

  const handleDelete = async (model: string) => {
    if (!instanceName) return
    setDeletingModel(model)
    try { await deleteMutation.mutateAsync({ instance: instanceName, model }); refetch() } catch {}
    setDeletingModel(null)
  }

  const handlePull = async () => {
    if (!pullInput.trim() || !instanceName || isPulling) return
    setIsPulling(true); setPullStatus("Connecting..."); setPullDone(false)
    try {
      for await (const chunk of pullModelToInstance(instanceName, pullInput.trim())) {
        if (chunk.error) { setPullStatus(`Error: ${chunk.error}`); break }
        if (chunk.total && chunk.completed)
          setPullStatus(`${chunk.status ?? "Pulling"} ${Math.round((chunk.completed / chunk.total) * 100)}%`)
        else if (chunk.status) setPullStatus(chunk.status)
      }
      setPullStatus("Done!"); setPullDone(true); setPullInput(""); refetch()
      qc.invalidateQueries({ queryKey: ["models"] })
    } catch (e: any) { setPullStatus(`Error: ${e.message}`) }
    finally {
      setIsPulling(false)
      setTimeout(() => { setPullStatus(""); setPullDone(false) }, 3000)
    }
  }

  return (
    <Dialog open={!!instanceName} onOpenChange={() => !isPulling && onClose()}>
      <DialogContent className="rounded-2xl border-border/40 bg-card/95 backdrop-blur-3xl shadow-2xl max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xs font-mono font-black uppercase tracking-[0.2em] flex items-center gap-2">
            <Package size={13} className="text-primary/70" />
            Models — <span className="text-primary">{instanceName?.replace("mollama_", "")}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="rounded-xl border border-border/30 bg-black/20 min-h-[80px] max-h-[240px] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full">
            {isLoading ? (
              <div className="flex items-center justify-center py-8"><Loader2 size={16} className="animate-spin text-primary/40" /></div>
            ) : models.length === 0 ? (
              <div className="text-[10px] font-mono text-muted-foreground/30 text-center py-8 uppercase tracking-widest">No models found</div>
            ) : (
              <div className="divide-y divide-border/20">
                {models.map((model) => (
                  <div key={model} className="flex items-center justify-between px-3 py-2.5 group hover:bg-white/5 transition-colors">
                    <span className="text-[11px] font-mono text-foreground/80 truncate flex-1 pr-2">{model}</span>
                    <button onClick={() => handleDelete(model)} disabled={deletingModel === model}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-500/20 text-red-400/70 hover:text-red-400 transition-all disabled:opacity-50">
                      {deletingModel === model ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <button onClick={() => refetch()} className="flex items-center gap-1.5 text-[10px] font-mono text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
            <RefreshCw size={10} /> Refresh list
          </button>

          <div className="flex items-center gap-2 pt-1">
            <div className="h-px flex-1 bg-border/30" />
            <span className="text-[9px] font-mono text-muted-foreground/30 uppercase tracking-widest">Pull Model</span>
            <div className="h-px flex-1 bg-border/30" />
          </div>

          <div className="flex gap-2">
            <Input value={pullInput} onChange={(e) => setPullInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePull()} placeholder="llama3.2:3b"
              disabled={isPulling} className="h-9 text-xs rounded-xl bg-secondary/30 border-border/40 font-mono" />
            <Button onClick={handlePull} disabled={!pullInput.trim() || isPulling} size="sm"
              className="h-9 px-3 text-[10px] font-black uppercase tracking-widest rounded-xl shrink-0">
              {isPulling ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
            </Button>
          </div>

          <AnimatePresence>
            {pullStatus && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                className={["flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-mono",
                  pullDone ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                  : pullStatus.startsWith("Error") ? "bg-red-500/10 border-red-500/20 text-red-400"
                  : "bg-blue-500/10 border-blue-500/20 text-blue-400"].join(" ")}>
                {pullDone ? <Check size={10} /> : pullStatus.startsWith("Error") ? <AlertTriangle size={10} /> : <Loader2 size={10} className="animate-spin shrink-0" />}
                <span className="truncate">{pullStatus}</span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPulling} size="sm"
            className="text-[10px] font-bold uppercase tracking-widest">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Instance Dropdown ─────────────────────────────────────────────────────────

function InstanceDropdown({
  fullName, instance, isLocal, isMain, isBanned, isActive,
  onManageModels, onShowKey,
}: {
  fullName: string
  instance: { base_url: string }
  isLocal: boolean
  isMain: boolean
  isBanned: boolean
  isActive: boolean
  onManageModels: () => void
  onShowKey: () => void
}) {
  const banMutation    = useBanInstance()
  const unbanMutation  = useUnbanInstance()
  const removeMutation = useRemoveInstance()
  const updateMutation = useUpdateInstance()
  const setMainMutation = useSetMainNode()
  const unsetMainMutation = useUnsetMainNode()

  const [confirmRemove, setConfirmRemove] = useState(false)
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleRemoveClick = () => {
    if (!confirmRemove) {
      setConfirmRemove(true)
      confirmTimerRef.current = setTimeout(() => setConfirmRemove(false), 3000)
    } else {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
      removeMutation.mutate(fullName)
      setConfirmRemove(false)
    }
  }

  useEffect(() => () => {
    if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current)
  }, [])

  const triggerCls = isMain && isActive && !isBanned
    ? "hover:!bg-amber-500/20 hover:!text-amber-200"
    : !isActive ? "hover:!bg-purple-900/30 hover:!text-purple-300"
    : isBanned   ? "hover:!bg-orange-500/20 hover:!text-orange-200"
    : "hover:!bg-purple-500/20 hover:!text-purple-200"

  return (
    <DropdownMenu onOpenChange={(open) => { if (!open) setConfirmRemove(false) }}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm"
          className={`h-6 w-6 p-0 group/trigger transition-all duration-300 ${triggerCls}`}>
          <ChevronDown size={14}
            className="transition-transform duration-500 group-hover/trigger:rotate-180 group-data-[state=open]:rotate-180 opacity-40 group-hover/trigger:opacity-100" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" sideOffset={6}
        className="w-52 text-[11px] font-mono backdrop-blur-2xl bg-card/97 border-border/40 shadow-2xl rounded-xl p-1">
        
        <MenuLabel>Info</MenuLabel>
        <DropdownMenuItem onClick={onShowKey} className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 hover:focus:text-white hover:bg-white/5 focus:bg-white/5">
          <Key size={12} className="text-muted-foreground/60" />
          <span>Show Key</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(instance.base_url)} className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 hover:focus:text-white hover:bg-white/5 focus:bg-white/5">
          <Copy size={12} className="text-muted-foreground/60" />
          <span>Copy URL</span>
        </DropdownMenuItem>

        <DropdownMenuItem onClick={onManageModels} className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 hover:focus:text-white hover:bg-white/5 focus:bg-white/5">
          <Package size={12} className="text-muted-foreground/60" />
          <span>Manage Models</span>
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border/20 my-1" />
        <MenuLabel>Configuration</MenuLabel>

        {isMain ? (
          <DropdownMenuItem onClick={() => unsetMainMutation.mutate(fullName)}
            className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-amber-400/80 hover:bg-amber-500/10 focus:bg-amber-500/10 hover:text-amber-300 focus:text-amber-300">
            <StarOff size={12} />
            <span>Unset Main Node</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => setMainMutation.mutate(fullName)}
            className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-amber-400/80 hover:bg-amber-500/10 focus:bg-amber-500/10 hover:text-amber-300 focus:text-amber-300">
            <Star size={12} />
            <span>Set as Main Node</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={() => updateMutation.mutate({ fullName, is_local: !isLocal })}
          className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 hover:focus:text-white hover:bg-white/5 focus:bg-white/5">
          {isLocal ? <><Cloud size={12} className="text-sky-400/60" /><span>Switch to Cloud</span></> : <><Monitor size={12} className="text-emerald-400/60" /><span>Switch to Local GPU</span></>}
        </DropdownMenuItem>

        <DropdownMenuSeparator className="bg-border/20 my-1" />
        <MenuLabel>State</MenuLabel>

        {isBanned ? (
          <DropdownMenuItem onClick={() => unbanMutation.mutate(fullName)}
            className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-emerald-400/80 hover:focus:text-emerald-400/80 hover:bg-emerald-500/10 focus:bg-emerald-500/10">
            <ShieldCheck size={12} />
            <span>Unban</span>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => banMutation.mutate({ fullName, seconds: 1800 })}
            className="gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 text-orange-400/80 hover:focus:text-orange-400/80 hover:bg-orange-500/10 focus:bg-orange-500/10">
            <ShieldBan size={12} />
            <span>Ban</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator className="bg-border/20 my-1" />

        {/* ── Fixed Decommission Logic ── */}
        <DropdownMenuItem 
          onSelect={(e) => {
            e.preventDefault() // Prevents the menu from closing on first click
            handleRemoveClick()
          }}
          className={["gap-2.5 cursor-pointer rounded-lg px-2.5 py-2 transition-colors",
            confirmRemove
              ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 focus:bg-red-500/25 focus:text-red-400 animate-pulse"
              : "text-red-500/70 hover:bg-red-500/10 focus:bg-red-500/10 hover:text-red-400 focus:text-red-400"
          ].join(" ")}>
          {confirmRemove
            ? <><AlertCircle size={12} /><span>Confirm Decommission</span></>
            : <><Trash2 size={12} /><span>Decommission</span></>
          }
          {removeMutation.isPending && <Loader2 size={10} className="ml-auto animate-spin opacity-50" />}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ── Pull All progress row ─────────────────────────────────────────────────────

interface InstanceProgress {
  instance: string; status: string; pct?: number; done: boolean; error: boolean
}

// ── Main Component ────────────────────────────────────────────────────────────

export function InstanceManager() {
  const { data: instances } = useInstances()
  const { data: processingData } = useProcessing()

  const [deployDialogOpen, setDeployDialogOpen] = useState(false)
  const [deployCount, setDeployCount] = useState(1)
  const [isDeployingMulti, setIsDeployingMulti] = useState(false)

  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState("")

  const [newKeysDialogOpen, setNewKeysDialogOpen] = useState(false)
  const [newKeysList, setNewKeysList] = useState<{name: string, key: string}[]>([])

  const [newInstanceName, setNewInstanceName] = useState("")
  const [manageModelsInstance, setManageModelsInstance] = useState<string | null>(null)

  const [showPullInput, setShowPullInput] = useState(false)
  const [pullAllModel, setPullAllModel] = useState("")
  const [isPullingAll, setIsPullingAll] = useState(false)
  const [pullAllProgress, setPullAllProgress] = useState<InstanceProgress[]>([])
  const [pullAllDone, setPullAllDone] = useState(false)

  const [stats, setStats] = useState<{ banned_until?: Record<string, number> }>({})

  const deployMutation = useDeployInstance()
  const instanceEntries = Object.entries(instances || {})

  // ── Dynamic Naming Logic ────────────────────────────────────────────────────
  const basePrefix = newInstanceName.trim() || "instance"

  // Scan existing instances to find the highest trailing number
  let maxExisting = 0
  instanceEntries.forEach(([fullName]) => {
    const rawName = fullName.replace(/^mollama_/, "")
    if (rawName.startsWith(basePrefix)) {
      const suffix = rawName.slice(basePrefix.length)
      if (/^\d+$/.test(suffix)) {
        maxExisting = Math.max(maxExisting, parseInt(suffix, 10))
      }
    }
  })

  const startNum = maxExisting + 1
  const endNum = startNum + deployCount - 1
  // ────────────────────────────────────────────────────────────────────────────

  const fetchKey = async (fullName: string) => {
    try {
      const res = await fetch(`${API_BASE_URL}/admin/key/${fullName}`)
      if (res.ok) { setSelectedKey((await res.json()).key); setKeyDialogOpen(true) }
    } catch {}
  }

  const handlePullAll = async () => {
    if (!pullAllModel.trim() || isPullingAll) return
    setIsPullingAll(true); setPullAllProgress([]); setPullAllDone(false)
    try {
      for await (const chunk of pullModelToAll(pullAllModel.trim())) {
        if (chunk.done) { setPullAllDone(true); break }
        if (!chunk.instance) continue
        setPullAllProgress((prev) => {
          const idx = prev.findIndex(p => p.instance === chunk.instance)
          let status = chunk.status ?? "pulling..."
          let pct: number | undefined
          let done = false; let error = false

          if (chunk.error) { status = `Error: ${chunk.error}`; error = true; done = true }
          else if (chunk.status === "success") { status = "done"; done = true }
          else if (chunk.total && chunk.completed) { pct = Math.round((chunk.completed / chunk.total) * 100); status = `${chunk.status ?? "pulling"} ${pct}%` }

          const row: InstanceProgress = { instance: chunk.instance!, status, pct, done, error }
          if (idx >= 0) { const next = [...prev]; next[idx] = row; return next }
          return [...prev, row]
        })
      }
    } catch (e: any) {
      setPullAllProgress(prev => [...prev, { instance: "error", status: e.message, done: true, error: true }])
    } finally {
      setIsPullingAll(false); setPullAllDone(true)
      setTimeout(() => { setShowPullInput(false); setPullAllProgress([]); setPullAllModel(""); setPullAllDone(false) }, 4000)
    }
  }

  useEffect(() => {
    const poll = async () => {
      try { const r = await fetch(`${API_BASE_URL}/admin/stats`); if (r.ok) setStats(await r.json()) } catch {}
    }
    poll(); const id = setInterval(poll, 2000); return () => clearInterval(id)
  }, [])

  const handleDeploy = async () => {
    setIsDeployingMulti(true)
    const deploymentNames: string[] = []

    // 1. Generate all target names first
    for (let i = 0; i < deployCount; i++) {
      const currentNum = startNum + i
      const targetName = (basePrefix !== "instance" && deployCount === 1 && maxExisting === 0) 
          ? basePrefix 
          : `${basePrefix}${currentNum}`
      deploymentNames.push(targetName)
    }

    try {
      // 2. Deploy all instances concurrently
      await Promise.all(
        deploymentNames.map(name => deployMutation.mutateAsync(name))
      )

      // 3. Wait 2 seconds for the backend to finalize the instances and generate keys
      await new Promise(resolve => setTimeout(resolve, 2000))

      // 4. Fetch all keys concurrently
      const deployedKeys = await Promise.all(
        deploymentNames.map(async (name) => {
          const fullName = `mollama_${name}`
          let fetchedKey = "Failed to fetch key"
          
          try {
            const res = await fetch(`${API_BASE_URL}/admin/key/${fullName}`)
            if (res.ok) {
              const data = await res.json()
              fetchedKey = data.key
            }
          } catch (e) {
            console.error(`Error fetching key for ${fullName}:`, e)
          }

          return { name: fullName, key: fetchedKey }
        })
      )

      // 5. Update UI and Clipboard
      setNewKeysList(deployedKeys)
      
      const keysText = deployedKeys.map(k => `${k.name}: ${k.key}`).join('\n')
      try {
        await navigator.clipboard.writeText(keysText)
      } catch (err) {
        console.warn("Auto-clipboard write failed.")
      }

      setDeployDialogOpen(false)
      setNewInstanceName("")
      setDeployCount(1)
      setNewKeysDialogOpen(true)

    } catch (error) {
      console.error("Deployment batch failed:", error)
    } finally {
      setIsDeployingMulti(false)
    }
  }

  // Dynamically calculate the preview text
  const targetPreview = deployCount > 1 
    ? `mollama_${basePrefix}${startNum} to mollama_${basePrefix}${endNum}`
    : `mollama_${(basePrefix !== "instance" && maxExisting === 0) ? basePrefix : `${basePrefix}${startNum}`}`

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="border-b border-border/40 px-3 py-2 flex flex-col gap-2 bg-muted/10">
        <div className="flex items-center justify-between min-h-[28px]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <AnimatePresence mode="wait">
              {!showPullInput ? (
                <motion.div key="title" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center gap-2">
                  <Server size={14} className="text-primary" />
                  <span className="text-[10px] font-mono font-black uppercase tracking-widest">Nodes ({instanceEntries.length})</span>
                </motion.div>
              ) : (
                <motion.div key="pull-input" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center gap-2 flex-1 pr-2">
                  <Download size={12} className="text-blue-400 shrink-0" />
                  <Input autoFocus placeholder="model:tag — pull to all nodes" value={pullAllModel}
                    onChange={e => setPullAllModel(e.target.value)} onKeyDown={e => e.key === "Enter" && handlePullAll()}
                    disabled={isPullingAll} className="h-6 text-[10px] font-mono bg-black/20 border-white/10 rounded-md py-0 placeholder:text-muted-foreground/30" />
                  {isPullingAll
                    ? <Loader2 size={13} className="animate-spin text-blue-400 shrink-0" />
                    : <button onClick={handlePullAll} disabled={!pullAllModel.trim()}
                        className="shrink-0 p-1 rounded hover:bg-blue-500/20 text-blue-400 disabled:opacity-30 transition-colors">
                        <Check size={13} />
                      </button>
                  }
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <motion.button whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}
              onClick={() => { if (showPullInput && !isPullingAll) { setShowPullInput(false); setPullAllProgress([]); setPullAllModel(""); setPullAllDone(false) } else if (!showPullInput) setShowPullInput(true) }}
              className={`p-1 rounded-lg transition-colors ${showPullInput ? "bg-red-500/20 text-red-400 hover:bg-red-500/30" : "hover:bg-blue-500/10 text-blue-400"}`}>
              {showPullInput ? <X size={14} /> : <Download size={14} />}
            </motion.button>
            <motion.button whileHover={{ scale: 1.1, rotate: 90 }} whileTap={{ scale: 0.9 }}
              onClick={() => setDeployDialogOpen(true)} className="p-1 hover:bg-primary/10 rounded-lg transition-colors text-primary">
              <Plus size={16} />
            </motion.button>
          </div>
        </div>

        {/* Pull All Progress */}
        <AnimatePresence>
          {showPullInput && pullAllProgress.length > 0 && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="space-y-1 pb-1">
                {pullAllProgress.map(p => (
                  <div key={p.instance} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-muted-foreground/50 truncate max-w-[90px]">{p.instance.replace("mollama_", "")}</span>
                    <div className="flex-1 h-px bg-border/20 relative overflow-hidden rounded-full">
                      {p.pct != null && !p.done && <div className="absolute inset-y-0 left-0 bg-blue-500/50 transition-all duration-300" style={{ width: `${p.pct}%` }} />}
                    </div>
                    <span className={`shrink-0 ${p.error ? "text-red-400" : p.done ? "text-emerald-400" : "text-blue-400/70"}`}>
                      {p.error ? "✗" : p.done ? "✓" : p.pct != null ? `${p.pct}%` : "…"}
                    </span>
                  </div>
                ))}
                {pullAllDone && <div className="text-[9px] font-mono text-emerald-400/60 uppercase tracking-widest">All instances done</div>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Instance List */}
      <ScrollArea className="flex-1 min-h-0 w-full">
        <div className="flex flex-col gap-2 p-2">
          <AnimatePresence mode="popLayout">
            {instanceEntries.length === 0 && (
              <div className="text-[10px] font-mono uppercase text-muted-foreground/30 text-center py-10 tracking-tighter">
                No active nodes found
              </div>
            )}

            {instanceEntries.map(([fullName, instance]) => {
              const procInfo = processingData?.processing[fullName]
              const isProcessing = !!procInfo
              const streamProgress = typeof procInfo === "object" ? (procInfo as any).processed || 0 : 0

              const isActive    = instance.active
              const bannedUntil = stats.banned_until?.[fullName] || 0
              const isBanned    = bannedUntil * 1000 > Date.now()
              const isLocal     = instance.is_local ?? false
              const isMain      = (instance as any).is_main ?? false

              let currentState: "idle" | "processing" | "banned" | "off" = "idle"
              if (!isActive) currentState = "off"
              else if (isBanned) currentState = "banned"
              else if (isProcessing) currentState = "processing"

              // Card styles — main node gets amber treatment
              let stateStyles = ""
              let dotStyles = ""

              if (isMain && isActive && !isBanned) {
                stateStyles = "border-amber-500/35 bg-amber-950/15 text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.07)]"
                dotStyles = "bg-amber-400 animate-pulse"
              } else if (!isActive) {
                stateStyles = "border-purple-900/20 bg-purple-950/5 text-purple-300/50 opacity-70"
                dotStyles = "bg-purple-900"
              } else if (isBanned) {
                stateStyles = "border-orange-500/30 bg-orange-950/10 text-orange-200"
                dotStyles = "bg-orange-500"
              } else if (isProcessing) {
                stateStyles = "border-blue-500/20 bg-blue-950/10 text-blue-100/75 shadow-[0_0_16px_rgba(59,130,246,0.05)]"
                dotStyles = "bg-blue-400/70"
              } else {
                stateStyles = "border-purple-500/30 bg-purple-950/20 text-purple-200"
                dotStyles = "bg-purple-500 animate-pulse"
              }

              return (
                <motion.div key={fullName} layout
                  initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                  className={`group relative rounded-xl p-3 border backdrop-blur-md transition-all duration-500 ease-out overflow-hidden hover:scale-[1.01] ${stateStyles}`}>

                  <NuclearCore state={currentState} isProcessing={isProcessing && !isBanned} pulseKey={streamProgress} />

                  {/* Main node top-edge glow */}
                  {isMain && isActive && !isBanned && (
                    <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
                  )}

                  <div className="relative z-10 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1 px-1">
                        {/* Name row */}
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <div className="flex items-center gap-1.5 min-w-0">
                            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotStyles}`} />
                            <span className="truncate font-bold tracking-tight uppercase text-[11px]">
                              {fullName.replace("mollama_", "")}
                            </span>
                          </div>
                          {/* Badges */}
                          <div className="flex items-center gap-1 shrink-0">
                            <StatusBadge state={currentState} />
                            {isMain && (
                              <div className="px-1.5 py-0.5 rounded-lg border text-[8px] font-black tracking-tighter uppercase flex items-center gap-0.5 bg-amber-500/15 border-amber-500/30 text-amber-400">
                                <Brain size={8} /> MAIN
                              </div>
                            )}
                            <div className={`px-1.5 py-0.5 rounded-lg border text-[8px] font-black tracking-tighter uppercase flex items-center gap-0.5 ${
                              isLocal ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400" : "bg-sky-500/10 border-sky-500/20 text-sky-400"}`}>
                              {isLocal ? <Monitor size={8} /> : <Cloud size={8} />}
                              {isLocal ? "LOCAL" : "CLOUD"}
                            </div>
                          </div>
                        </div>
                        {/* URL */}
                        <div className="text-[9px] font-mono opacity-40 truncate mx-0.5 px-2 border-l border-white/20">
                          {instance.base_url.replace(/^https?:\/\//, "")}
                        </div>
                      </div>

                      <InstanceDropdown
                        fullName={fullName}
                        instance={instance}
                        isLocal={isLocal}
                        isMain={isMain}
                        isBanned={isBanned}
                        isActive={isActive}
                        onManageModels={() => setManageModelsInstance(fullName)}
                        onShowKey={() => fetchKey(fullName)}
                      />
                    </div>

                    {/* Action button */}
                    <div className="flex gap-2">
                      {!isActive ? (
                        <StartStopButton variant="boot" fullName={fullName} />
                      ) : isProcessing && !isBanned ? (
                        <Button disabled size="sm"
                          className="flex-1 h-7 text-[9px] font-black bg-blue-950/15 border border-blue-900/20 text-blue-200/50 tracking-widest cursor-not-allowed">
                          <Loader2 size={10} className="mr-1 animate-spin opacity-40" /> WORKING
                        </Button>
                      ) : (
                        <StartStopButton variant="kill" fullName={fullName} />
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      </ScrollArea>

      {/* Dialogs */}
      <ManageModelsDialog instanceName={manageModelsInstance} onClose={() => setManageModelsInstance(null)} />

      {/* Deploy Dialog */}
      <Dialog open={deployDialogOpen} onOpenChange={setDeployDialogOpen}>
        <DialogContent className="rounded-2xl border-border/40 bg-card/95 backdrop-blur-3xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xs font-mono font-black uppercase tracking-[0.2em]">Deploy Node(s)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Input 
                value={newInstanceName} 
                onChange={e => setNewInstanceName(e.target.value)}
                placeholder={`instance${startNum}`} // <-- Changed this line
                onKeyDown={e => e.key === "Enter" && handleDeploy()}
                disabled={isDeployingMulti}
                className="h-10 text-xs rounded-xl bg-secondary/30 border-border/40 font-mono" 
            />

            <div className="flex items-center gap-3 bg-black/20 p-2 rounded-xl border border-white/5">
              <span className="text-[10px] text-muted-foreground/50 font-mono flex-1 pl-2">QUANTITY</span>
              <div className="flex items-center gap-2">
                <button 
                  disabled={isDeployingMulti || deployCount <= 1}
                  onClick={() => setDeployCount(Math.max(1, deployCount - 1))} 
                  className="p-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg transition-colors"
                >
                  <Minus size={12} />
                </button>
                <span className="text-xs font-mono w-6 text-center">{deployCount}</span>
                <button 
                  disabled={isDeployingMulti}
                  onClick={() => setDeployCount(deployCount + 1)} 
                  className="p-1.5 bg-white/5 hover:bg-white/10 disabled:opacity-30 rounded-lg transition-colors"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>

            <div className="text-[10px] text-muted-foreground/50 font-mono p-2 bg-black/20 rounded-lg border border-white/5 truncate">
              TARGET: <span className="text-primary">{targetPreview}</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setDeployDialogOpen(false)} disabled={isDeployingMulti} size="sm"
              className="text-[10px] font-bold uppercase tracking-widest">Abort</Button>
            <Button onClick={handleDeploy} disabled={isDeployingMulti} size="sm"
              className="text-[10px] font-bold uppercase tracking-widest px-6 rounded-lg relative overflow-hidden group">
              {isDeployingMulti ? (
                <><Loader2 size={12} className="mr-2 animate-spin" /> Deploying...</>
              ) : (
                "Execute"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Generated Keys Dialog */}
      <Dialog open={newKeysDialogOpen} onOpenChange={setNewKeysDialogOpen}>
        <DialogContent className="rounded-2xl border-border/40 bg-card/95 backdrop-blur-3xl shadow-2xl max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-xs font-mono font-black uppercase tracking-[0.2em] text-emerald-400 flex items-center gap-2">
              <Check size={14} /> Deployment Successful
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-2 max-h-[60vh] overflow-y-auto [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full pr-1">
            <p className="text-[10px] font-mono text-muted-foreground/60 mb-4 px-1">
              {newKeysList.length} instance(s) created. Keys have been copied to your clipboard.
            </p>
            <div className="space-y-2">
              <AnimatePresence>
                {newKeysList.map((item, i) => (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ delay: i * 0.08, ease: "easeOut" }}
                    key={item.name}
                    className="flex flex-col gap-1.5 p-3 bg-black/20 border border-white/5 rounded-xl hover:border-emerald-500/20 transition-colors group"
                  >
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[10px] font-mono text-emerald-400 font-bold uppercase tracking-widest">{item.name.replace("mollama_", "")}</span>
                      <button 
                        onClick={() => navigator.clipboard.writeText(item.key)} 
                        className="text-muted-foreground/40 hover:text-emerald-400 transition-colors p-1"
                        title="Copy Key"
                      >
                        <Copy size={12} />
                      </button>
                    </div>
                    <div className="text-xs font-mono bg-black/40 p-2.5 rounded-lg border border-white/5 text-muted-foreground/80 break-all select-all">
                      {item.key}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
          <DialogFooter className="gap-2 mt-2">
            <Button onClick={() => {
                const text = newKeysList.map(k => `${k.name}: ${k.key}`).join('\n')
                navigator.clipboard.writeText(text)
              }} 
              variant="outline" 
              size="sm" 
              className="text-[10px] font-bold uppercase tracking-widest border-white/10 hover:bg-white/5"
            >
              <Copy size={12} className="mr-2" /> Copy All
            </Button>
            <Button onClick={() => setNewKeysDialogOpen(false)} size="sm" 
              className="text-[10px] font-bold uppercase tracking-widest px-6 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30">
              Acknowledge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Individual Show Key Dialog */}
      <Dialog open={keyDialogOpen} onOpenChange={() => setKeyDialogOpen(false)}>
        <DialogContent className="rounded-2xl border-border/40 bg-card/95 backdrop-blur-3xl shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-xs font-mono font-black uppercase tracking-[0.2em]">Instance Key</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input value={selectedKey} readOnly className="h-10 text-xs rounded-xl bg-secondary/30 border-border/40 font-mono" />
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setKeyDialogOpen(false)} size="sm"
              className="text-[10px] font-bold uppercase tracking-widest">Close</Button>
            <Button onClick={() => navigator.clipboard.writeText(selectedKey)} disabled={!selectedKey} size="sm"
              className="text-[10px] font-bold uppercase tracking-widest px-6 rounded-lg">Copy</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ── Start/Stop button extracted to avoid hook-in-loop ────────────────────────

function StartStopButton({ variant, fullName }: { variant: "boot" | "kill"; fullName: string }) {
  const startMutation = useStartInstance()
  const stopMutation  = useStopInstance()

  if (variant === "boot") return (
    <Button size="sm" onClick={() => startMutation.mutate(fullName)}
      disabled={startMutation.isPending}
      className="flex-1 h-7 text-[9px] font-black bg-purple-600/10 hover:bg-purple-600/30 border border-purple-500/20 text-purple-400 tracking-widest transition-all">
      {startMutation.isPending ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Play size={10} className="mr-1 fill-current" />}
      BOOT
    </Button>
  )

  return (
    <Button size="sm" onClick={() => stopMutation.mutate(fullName)}
      disabled={stopMutation.isPending}
      className="flex-1 h-7 text-[9px] font-black bg-red-900/10 hover:bg-red-900/30 border border-red-800/20 text-red-400 tracking-widest transition-all">
      {stopMutation.isPending ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Square size={10} className="mr-1 fill-current" />}
      KILL
    </Button>
  )
}