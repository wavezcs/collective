import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Wrench } from 'lucide-react'

function Avatar({ isUser }) {
  if (isUser) {
    return (
      <div className="shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-xs font-bold mt-0.5 bg-borg-border text-borg-muted">
        you
      </div>
    )
  }
  return (
    <div className="shrink-0 w-10 h-10 rounded-lg overflow-hidden mt-0.5">
      <img src="/avatars/aria.svg" alt="Aria" className="w-full h-full object-cover" />
    </div>
  )
}

export function Message({ role, content, toolCalls = [] }) {
  const isUser = role === 'user'

  return (
    <div className={`fade-in flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      <Avatar isUser={isUser} />

      <div className={`flex-1 min-w-0 space-y-1.5 ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* Tool calls */}
        {toolCalls.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-borg-dim bg-borg-panel border border-borg-border rounded px-2 py-1">
            <Wrench size={10} className="text-borg-dim shrink-0" />
            <span className="text-borg-muted">{t.name}</span>
            {t.preview && <span className="truncate opacity-60">{t.preview}</span>}
          </div>
        ))}

        {/* Content */}
        {content && (
          <div className={`max-w-[85%] rounded px-3 py-2 text-sm leading-relaxed
            ${isUser
              ? 'bg-borg-panel border border-borg-border text-borg-text ml-auto'
              : 'text-borg-text'
            }`}>
            {isUser
              ? <span className="whitespace-pre-wrap">{content}</span>
              : <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
            }
          </div>
        )}
      </div>
    </div>
  )
}

export function StreamingMessage({ content, toolCalls = [], isStreaming }) {
  return (
    <div className="fade-in flex gap-3">
      <Avatar isUser={false} />
      <div className="flex-1 min-w-0 space-y-1.5 flex flex-col items-start">
        {toolCalls.map((t, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-borg-dim bg-borg-panel border border-borg-border rounded px-2 py-1">
            <Wrench size={10} className="text-borg-dim shrink-0 animate-spin" style={{animationDuration:'2s'}} />
            <span className="text-borg-muted">{t.name}</span>
            {t.preview && <span className="truncate opacity-60">{t.preview}</span>}
          </div>
        ))}
        {(content || isStreaming) && (
          <div className="text-borg-text text-sm leading-relaxed">
            <div className="prose"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>
            {isStreaming && <span className="cursor-blink text-borg-green ml-0.5">▋</span>}
          </div>
        )}
      </div>
    </div>
  )
}
