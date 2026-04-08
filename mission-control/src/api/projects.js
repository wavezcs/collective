const BASE = '/projects'

export async function listProjects() {
  const r = await fetch(`${BASE}`)
  const d = await r.json()
  return d.projects || []
}

export async function getProject(id) {
  const r = await fetch(`${BASE}/${id}`)
  return r.json()
}

export async function createProject(data) {
  const r = await fetch(`${BASE}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return r.json()
}

export async function updateProject(id, data) {
  await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}

export async function addIteration(projectId, data) {
  const r = await fetch(`${BASE}/${projectId}/iterations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
  return r.json()
}

export async function deleteProject(id) {
  await fetch(`${BASE}/${id}`, { method: 'DELETE' })
}
