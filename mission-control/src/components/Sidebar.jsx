import React from 'react'
import { MessageSquare, FolderKanban, Sparkles, ChefHat } from 'lucide-react'

export default function Sidebar({ view, onChat, onProjects, onMeals }) {
  const navItem = (label, Icon, active, onClick) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-2.5 w-full px-3 py-2 rounded-md text-left text-sm transition-colors
        ${active
          ? 'bg-borg-panel text-borg-text font-medium'
          : 'text-borg-muted hover:text-borg-text hover:bg-borg-panel/60'
        }`}
    >
      <Icon size={15} className={active ? 'text-borg-green' : 'text-borg-dim'} />
      {label}
    </button>
  )

  return (
    <aside className="w-52 shrink-0 border-r border-borg-border flex flex-col bg-borg-surface">
      {/* Logo */}
      <div className="px-4 py-5">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-borg-green/15 flex items-center justify-center">
            <Sparkles size={13} className="text-borg-green" />
          </div>
          <span className="text-borg-text font-semibold text-sm tracking-tight">2B</span>
        </div>
        <div className="text-borg-dim text-xs mt-1 ml-8.5">second brain</div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2 flex-1">
        {navItem('Chat', MessageSquare, view === 'chat', onChat)}
        {navItem('Research', FolderKanban, view === 'projects' || view === 'project', onProjects)}
        {navItem('Meals', ChefHat, view === 'meals', onMeals)}
      </nav>

      {/* Status */}
      <div className="px-4 py-4 border-t border-borg-border">
        <div className="flex items-center gap-2 text-xs text-borg-muted">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          Aria online
        </div>
      </div>
    </aside>
  )
}
