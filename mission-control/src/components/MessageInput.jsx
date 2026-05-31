import React, { useRef, useEffect } from 'react'
import { Send } from 'lucide-react'

export default function MessageInput({ onSend, disabled, placeholder = 'Message Aria...' }) {
  const ref = useRef()

  useEffect(() => { ref.current?.focus() }, [disabled])

  function handleKey(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const val = ref.current?.value.trim()
    if (!val || disabled) return
    ref.current.value = ''
    ref.current.style.height = 'auto'
    onSend(val)
  }

  function autoResize(e) {
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }

  return (
    <div className="px-4 py-3 border-t border-borg-border bg-borg-surface">
      <div className="flex items-end gap-2 bg-borg-panel rounded-xl border border-borg-border px-3 py-2
                      focus-within:border-borg-green/40 transition-colors">
        <textarea
          ref={ref}
          rows={1}
          onKeyDown={handleKey}
          onInput={autoResize}
          disabled={disabled}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent text-borg-text placeholder-borg-dim
                     focus:outline-none text-sm leading-relaxed disabled:opacity-40
                     disabled:cursor-not-allowed max-h-40 py-0.5"
        />
        <button
          onClick={submit}
          disabled={disabled}
          className="shrink-0 p-1.5 rounded-lg bg-borg-green/10 text-borg-green
                     hover:bg-borg-green/20 disabled:opacity-30 disabled:cursor-not-allowed
                     transition-colors"
        >
          <Send size={13} />
        </button>
      </div>
      <div className="text-borg-dim text-xs mt-1.5 text-right">Enter to send · Shift+Enter for newline</div>
    </div>
  )
}
