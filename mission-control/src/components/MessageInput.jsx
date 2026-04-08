import React, { useRef, useEffect } from 'react'
import { Send } from 'lucide-react'

export default function MessageInput({ onSend, disabled, placeholder = 'Message Locutus...' }) {
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
    <div className="flex items-end gap-2 p-3 border-t border-borg-border bg-borg-surface">
      <textarea
        ref={ref}
        rows={1}
        onKeyDown={handleKey}
        onInput={autoResize}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 resize-none bg-borg-panel border border-borg-border rounded px-3 py-2 text-borg-text
                   placeholder-borg-dim focus:outline-none focus:border-borg-green/50 text-sm leading-relaxed
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors max-h-40"
      />
      <button
        onClick={submit}
        disabled={disabled}
        className="shrink-0 p-2 rounded bg-borg-panel border border-borg-border text-borg-green
                   hover:bg-borg-border disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Send size={14} />
      </button>
    </div>
  )
}
