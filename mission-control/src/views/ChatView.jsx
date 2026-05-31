import React, { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createSession, getMessages, streamChat } from '../api/hermes'
import { Message, StreamingMessage } from '../components/Message'
import MessageInput from '../components/MessageInput'
import SessionTree from '../components/SessionTree'
import { RotateCcw } from 'lucide-react'

export default function ChatView({ sessionId, onSessionCreated }) {
  const [sid, setSid]           = useState(sessionId)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(null)  // {content, toolCalls}
  const [busy, setBusy]         = useState(false)
  const [showTree, setShowTree] = useState(false)
  const bottomRef               = useRef()
  const cancelRef               = useRef()

  // Load existing messages when session exists
  const { data: history } = useQuery({
    queryKey: ['messages', sid],
    queryFn: () => getMessages(sid),
    enabled: !!sid,
    staleTime: Infinity,
  })

  useEffect(() => {
    if (history) {
      const msgs = (history.items || history.messages || []).filter(m =>
        m.role === 'user' || m.role === 'assistant'
      ).map(m => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : ''
      }))
      setMessages(msgs)
    }
  }, [history])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  async function ensureSession() {
    if (sid) return sid
    const s = await createSession('web')
    setSid(s.id)
    onSessionCreated?.(s.id)
    return s.id
  }

  async function send(text) {
    if (busy) return
    let session
    try {
      session = await ensureSession()
    } catch (err) {
      setMessages(prev => [...prev,
        { role: 'user', content: text },
        { role: 'assistant', content: `_Error connecting to Hermes: ${err.message}_` }
      ])
      return
    }
    setMessages(prev => [...prev, { role: 'user', content: text }])
    setStreaming({ content: '', toolCalls: [] })
    setBusy(true)
    setShowTree(true)

    let finalContent = ''
    cancelRef.current = streamChat(session, text, {
      onDelta: delta => {
        finalContent += delta
        setStreaming(prev => ({ ...prev, content: finalContent }))
      },
      onTool: (name, preview) => {
        setStreaming(prev => ({
          ...prev,
          toolCalls: [...prev.toolCalls, { name, preview }]
        }))
      },
      onDone: () => {
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: finalContent }
        ])
        setStreaming(null)
        setBusy(false)
      },
      onError: err => {
        console.error(err)
        setMessages(prev => [
          ...prev,
          { role: 'assistant', content: `_Error: ${err.message}_` }
        ])
        setStreaming(null)
        setBusy(false)
      }
    })
  }

  async function newChat() {
    cancelRef.current?.()
    setSid(null)
    setMessages([])
    setStreaming(null)
    setBusy(false)
    setShowTree(false)
    onSessionCreated?.(null)
  }

  return (
    <div className="flex h-full">
      {/* Main chat column */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-borg-border bg-borg-surface shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg overflow-hidden">
              <img src="/avatars/aria.svg" alt="Aria" className="w-full h-full object-cover" />
            </div>
            <div>
              <div className="text-borg-text font-semibold text-sm">Aria</div>
              <div className="text-borg-dim text-xs">{sid ? 'Session ' + sid.slice(0, 8) : 'New conversation'}</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {sid && (
              <button
                onClick={() => setShowTree(t => !t)}
                className="text-xs text-borg-muted hover:text-borg-text px-2.5 py-1.5 rounded-md hover:bg-borg-panel transition-colors"
              >
                {showTree ? 'Hide' : 'Activity'}
              </button>
            )}
            <button
              onClick={newChat}
              className="flex items-center gap-1.5 text-xs text-borg-muted hover:text-borg-text px-2.5 py-1.5 rounded-md hover:bg-borg-panel transition-colors"
            >
              <RotateCcw size={11} /> New chat
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-5">
          {messages.length === 0 && !streaming && (
            <div className="flex flex-col items-center justify-center h-full text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden opacity-90">
                <img src="/avatars/aria.svg" alt="Aria" className="w-full h-full object-cover" />
              </div>
              <div>
                <div className="text-borg-text font-medium text-base">Hi, I'm Aria.</div>
                <div className="text-borg-muted text-sm mt-1">Ask me anything, or start a research project.</div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <Message key={i} role={m.role} content={m.content} />
          ))}
          {streaming && (
            <StreamingMessage
              content={streaming.content}
              toolCalls={streaming.toolCalls}
              isStreaming={busy}
            />
          )}
          <div ref={bottomRef} />
        </div>

        <MessageInput onSend={send} disabled={busy} />
      </div>

      {/* Agent activity panel */}
      {showTree && sid && (
        <div className="w-64 shrink-0 border-l border-borg-border bg-borg-surface overflow-y-auto p-4">
          <div className="text-xs font-medium text-borg-muted uppercase tracking-wide mb-3">Agent Activity</div>
          <SessionTree parentSessionId={sid} />
        </div>
      )}
    </div>
  )
}
