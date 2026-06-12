import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Wrench } from 'lucide-react'

function ToolPill({ name, preview, spinning }) {
  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-borg-muted bg-borg-panel/80 rounded-full px-2.5 py-1 border border-borg-border/60">
      <Wrench size={9} className={`text-borg-dim shrink-0 ${spinning ? 'animate-spin' : ''}`} style={spinning ? {animationDuration:'2s'} : {}} />
      <span className="font-medium">{name}</span>
      {preview && <span className="text-borg-dim truncate max-w-48">{preview}</span>}
    </div>
  )
}

export function Message({ role, content, toolCalls = [] }) {
  const isUser = role === 'user'

  return (
    <div className={`fade-in flex gap-3 ${isUser ? 'justify-end' : ''}`}>
      {!isUser && (
        <div className="shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-0.5">
          <img src="/avatars/aria.svg" alt="Aria" className="w-full h-full object-cover" />
        </div>
      )}

      <div className={`flex flex-col gap-1.5 max-w-[82%] ${isUser ? 'items-end' : 'items-start'}`}>
        {toolCalls.map((t, i) => <ToolPill key={i} name={t.name} preview={t.preview} />)}

        {content && (
          isUser
            ? (
              <div className="bg-borg-panel rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm text-borg-text leading-relaxed">
                <span className="whitespace-pre-wrap">{content}</span>
              </div>
            )
            : (
              <div className="prose text-sm">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            )
        )}
      </div>
    </div>
  )
}

export function StreamingMessage({ content, toolCalls = [], isStreaming }) {
  return (
    <div className="fade-in flex gap-3">
      <div className="shrink-0 w-8 h-8 rounded-lg overflow-hidden mt-0.5">
        <img src="/avatars/aria.svg" alt="Aria" className="w-full h-full object-cover" />
      </div>
      <div className="flex flex-col gap-1.5 items-start max-w-[82%]">
        {toolCalls.map((t, i) => <ToolPill key={i} name={t.name} preview={t.preview} spinning />)}
        {(content || isStreaming) && (
          <div className="prose text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            {isStreaming && <span className="cursor-blink text-borg-accent ml-0.5">▋</span>}
          </div>
        )}
      </div>
    </div>
  )
}
