import React from 'react'
import { MessageSquare, FolderKanban, Cpu } from 'lucide-react'

export default function Sidebar({ view, onChat, onProjects }) {
  const btn = (label, icon, active, onClick) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded text-left transition-colors
        ${active
          ? 'bg-borg-panel text-borg-green border border-borg-border'
          : 'text-borg-muted hover:text-borg-text hover:bg-borg-panel/50 border border-transparent'
        }`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )

  return (
    <aside className="w-48 shrink-0 border-r border-borg-border flex flex-col bg-borg-surface">
      {/* Logo */}
      <div className="px-4 py-4 border-b border-borg-border">
        <div className="flex items-center gap-2">
          <Cpu size={16} className="text-borg-green" />
          <span className="text-borg-green font-semibold tracking-wider text-xs uppercase">
            Mission Control
          </span>
        </div>
        <div className="text-borg-dim text-xs mt-0.5">The Collective</div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1 p-2 flex-1">
        {btn('Chat', <MessageSquare size={14} />, view === 'chat', onChat)}
        {btn('Projects', <FolderKanban size={14} />, view === 'projects' || view === 'project', onProjects)}
      </nav>

      {/* Status */}
      <div className="p-3 border-t border-borg-border text-xs text-borg-dim space-y-1">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-borg-green animate-pulse" />
          Locutus online
        </div>
        <div className="text-borg-dim/60">collective.csdyn.com</div>
      </div>
    </aside>
  )
}
