import React, { useState } from 'react'
import Sidebar from './components/Sidebar'
import ChatView from './views/ChatView'
import ProjectsView from './views/ProjectsView'
import ProjectDetail from './views/ProjectDetail'

export default function App() {
  const [view, setView]             = useState('chat')      // 'chat' | 'projects'
  const [activeProject, setProject] = useState(null)
  const [chatSessionId, setChatSession] = useState(null)

  function openProject(p) { setProject(p); setView('project') }
  function backToProjects() { setProject(null); setView('projects') }

  return (
    <div className="flex h-screen overflow-hidden bg-borg-bg">
      <Sidebar
        view={view}
        onChat={() => { setView('chat'); setProject(null) }}
        onProjects={() => { setView('projects'); setProject(null) }}
      />
      <main className="flex-1 overflow-hidden">
        {view === 'chat' && (
          <ChatView sessionId={chatSessionId} onSessionCreated={setChatSession} />
        )}
        {view === 'projects' && (
          <ProjectsView onOpenProject={openProject} />
        )}
        {view === 'project' && activeProject && (
          <ProjectDetail project={activeProject} onBack={backToProjects} />
        )}
      </main>
    </div>
  )
}
