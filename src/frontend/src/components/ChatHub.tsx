import { useState, useRef, useEffect, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Send, MessageSquare, Loader2, ArrowDown, Brain, Zap } from "lucide-react"
import { sendChatMessage, type ChatMessage } from "@/lib/api"

const SCROLL_CLS = [
  "absolute inset-0 overflow-y-auto",
  "[&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent",
  "[&::-webkit-scrollbar-thumb]:bg-border/25 [&::-webkit-scrollbar-thumb]:rounded-full",
  "[&::-webkit-scrollbar-thumb:hover]:bg-border/50",
].join(" ")

interface ChatHubProps {
  model: string
}

// ── Lightweight markdown renderer ─────────────────────────────────────────────
// Handles code blocks, inline code, bold, italic — no external dep.

function renderContent(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  // Split on ```...``` code blocks first
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g
  let last = 0; let match: RegExpExecArray | null

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > last) nodes.push(renderInline(text.slice(last, match.index), nodes.length))
    const lang = match[1]
    nodes.push(
      <div key={`cb-${match.index}`} className="my-2 rounded-lg overflow-hidden border border-border/30 bg-black/30">
        {lang && (
          <div className="px-3 py-1 text-[9px] font-mono text-muted-foreground/40 uppercase tracking-widest border-b border-border/20 bg-black/20">
            {lang}
          </div>
        )}
        <pre className="p-3 text-[11px] font-mono text-foreground/80 overflow-x-auto leading-relaxed whitespace-pre">
          {match[2]}
        </pre>
      </div>
    )
    last = match.index + match[0].length
  }

  if (last < text.length) nodes.push(renderInline(text.slice(last), nodes.length + 1000))
  return nodes
}

function renderInline(text: string, baseKey: number): React.ReactNode {
  // Split paragraphs on double newlines
  const paras = text.split(/\n\n+/)
  return (
    <div key={baseKey} className="space-y-2">
      {paras.map((para, pi) => {
        // Single-line blocks
        const lines = para.split("\n")
        return (
          <p key={pi} className="whitespace-pre-wrap break-words">
            {lines.map((line, li) => (
              <span key={li}>
                {li > 0 && <br />}
                {applyInlineStyles(line)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

function applyInlineStyles(line: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // inline code, bold, italic
  const re = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|__[^_]+__)/g
  let last = 0; let m: RegExpExecArray | null; let k = 0

  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(<span key={k++}>{line.slice(last, m.index)}</span>)
    const tok = m[0]
    if (tok.startsWith("`"))
      parts.push(<code key={k++} className="px-1 py-0.5 rounded bg-black/30 text-primary/80 text-[10px] font-mono">{tok.slice(1, -1)}</code>)
    else if (tok.startsWith("**") || tok.startsWith("__"))
      parts.push(<strong key={k++} className="font-bold">{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith("*"))
      parts.push(<em key={k++} className="italic opacity-80">{tok.slice(1, -1)}</em>)
    last = m.index + m[0].length
  }

  if (last < line.length) parts.push(<span key={k++}>{line.slice(last)}</span>)
  return parts
}

// ── Chat Hub ──────────────────────────────────────────────────────────────────

export function ChatHub({ model }: ChatHubProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [following, setFollowing] = useState(true)
  const [routedModel, setRoutedModel] = useState<string | null>(null) // last mollama-resolved model

  const scrollRef = useRef<HTMLDivElement>(null)
  const isMollama = model === "mollama"

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
  }, [messages, following, scrollToBottom])

  // Reset routed model when model changes
  useEffect(() => { setRoutedModel(null) }, [model])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return

    const userMessage: ChatMessage = { role: "user", content: input }
    const updatedMessages = [...messages, userMessage]
    setMessages(updatedMessages)
    setInput("")
    setIsLoading(true)
    setFollowing(true)
    if (isMollama) setRoutedModel(null) // reset while we wait for routing

    try {
      let assistantContent = ""
      let modelCaptured = false
      setMessages(prev => [...prev, { role: "assistant", content: "" }])

      for await (const chunk of sendChatMessage(updatedMessages, model)) {
        // Extract the actual selected model from the stream if we are routing
        if (chunk.model && !modelCaptured) {
          if (isMollama) setRoutedModel(chunk.model)
          modelCaptured = true
        }
        
        // Append actual text content
        if (chunk.content) {
          assistantContent += chunk.content
          setMessages(prev => {
            const next = [...prev]
            next[next.length - 1] = { role: "assistant", content: assistantContent }
            return next
          })
        }
      }
    } catch (error: any) {
      setMessages(prev => [
        ...prev.slice(0, -1),
        { role: "assistant", content: `Error: ${error.message || "An unexpected error occurred."}` },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Card className="gap-0 h-full flex flex-col border border-border/40 bg-card/20 backdrop-blur-2xl rounded-xl overflow-hidden shadow-2xl">
      {/* Header */}
      <div className="shrink-0 border-b border-border/40 px-4 py-2 flex items-center justify-between bg-muted/10">
        <div className="flex items-center gap-2">
          <MessageSquare size={13} className="text-primary/70" />
          <span className="text-[10px] font-mono font-black uppercase tracking-widest">Neural Link</span>
        </div>

        <div className="flex items-center gap-2">
          {/* Mollama smart routing badge */}
          {isMollama && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-lg border bg-amber-500/10 border-amber-500/20 text-amber-400/80"
            >
              <Brain size={9} />
              <span className="text-[9px] font-mono font-black uppercase tracking-widest">Smart</span>
            </motion.div>
          )}

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-secondary/30 border border-border/20">
            <span className="text-[9px] text-muted-foreground/40 font-mono uppercase">Model</span>
            <span className="text-[10px] text-primary/80 font-mono font-bold tracking-tighter">
              {isMollama && routedModel ? routedModel : (model || "—")}
            </span>
            {isMollama && isLoading && !routedModel && (
              <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}
                className="text-[9px] text-amber-400/60 font-mono">selecting…</motion.span>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} className={SCROLL_CLS}>
          <div className="p-4 space-y-3">
            {messages.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground/20 text-[10px] font-mono uppercase gap-3">
                <MessageSquare size={22} className="opacity-30" />
                <span>Awaiting Input...</span>
                {isMollama && (
                  <div className="flex items-center gap-1.5 text-amber-400/20">
                    <Brain size={10} />
                    <span className="text-[9px]">Smart routing enabled</span>
                  </div>
                )}
              </div>
            )}

            <AnimatePresence initial={false}>
              {messages.map((message, idx) => {
                const isLastAssistant = message.role === "assistant" && isLoading && idx === messages.length - 1
                return (
                  <motion.div key={idx}
                    initial={{ opacity: 0, y: 6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={[
                      "max-w-[85%] rounded-2xl px-4 py-2.5 text-xs leading-relaxed shadow-sm",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-none"
                        : "bg-secondary/40 text-foreground border border-border/10 rounded-tl-none backdrop-blur-md",
                    ].join(" ")}>
                      {isLastAssistant ? (
                        <div className="whitespace-pre-wrap break-words">
                          {message.content || (
                            <motion.span animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1, repeat: Infinity }}
                              className="text-muted-foreground/40 text-[10px]">
                              {isMollama ? "Selecting best model…" : "Thinking…"}
                            </motion.span>
                          )}
                          {message.content && (
                            <motion.span animate={{ opacity: [1, 0] }} transition={{ duration: 0.55, repeat: Infinity, repeatType: "reverse" }}
                              className="inline-block w-[5px] h-[11px] bg-foreground/40 ml-px align-middle" />
                          )}
                        </div>
                      ) : message.role === "assistant" ? (
                        <div className="space-y-1">{renderContent(message.content)}</div>
                      ) : (
                        <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        </div>

        {/* Follow button */}
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

      {/* Input */}
      <div className="shrink-0 border-t border-border/40 p-3 bg-muted/5">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input value={input} onChange={e => setInput(e.target.value)}
            placeholder={isMollama ? "Ask anything — best model auto-selected..." : "Command sequence..."}
            disabled={isLoading}
            className="h-10 text-xs rounded-xl bg-background/50 border-border/40 focus-visible:ring-primary/40 placeholder:text-muted-foreground/25" />
          <Button type="submit" disabled={!input.trim() || isLoading} size="icon"
            className="h-10 w-10 shrink-0 rounded-xl bg-primary hover:bg-primary/80 transition-all duration-200 active:scale-90">
            {isLoading
              ? <Loader2 size={15} className="animate-spin" />
              : isMollama ? <Brain size={15} /> : <Send size={15} />
            }
          </Button>
        </form>
      </div>
    </Card>
  )
}