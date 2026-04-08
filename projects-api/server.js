#!/usr/bin/env node
/**
 * Projects API — Mission Control project management
 *
 * Stores research projects as Neo4j nodes in Vinculum.
 * Runs on collective.csdyn.com alongside Hermes.
 *
 * Endpoints:
 *   GET    /projects              — list all projects
 *   POST   /projects              — create project
 *   GET    /projects/:id          — get project + iterations
 *   PATCH  /projects/:id          — update project (status, best_score, etc.)
 *   POST   /projects/:id/iterations — add an iteration record
 *   DELETE /projects/:id          — delete project
 *   GET    /health                — health check
 */

const http    = require('http');
const neo4j   = require('neo4j-driver');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const CONFIG_PATH = path.join(__dirname, '../config/collective.json');
const config  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = config.GENERAL;
const PORT = 3002;

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(body);
}

function route(req) {
  const url  = req.url.replace(/\?.*$/, '');
  const parts = url.split('/').filter(Boolean);
  // ['projects'] or ['projects', id] or ['projects', id, 'iterations']
  if (parts[0] !== 'projects') return null;
  return { id: parts[1] || null, sub: parts[2] || null };
}

// ─── DB operations ───────────────────────────────────────────────────────────

async function listProjects() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (p:Project)
       OPTIONAL MATCH (p)-[:HAS_ITERATION]->(i:Iteration)
       WITH p, count(i) AS iteration_count, max(i.score) AS best_score
       RETURN p, iteration_count, best_score
       ORDER BY p.created_at DESC`
    );
    return result.records.map(r => ({
      ...r.get('p').properties,
      iteration_count: r.get('iteration_count').toNumber?.() ?? r.get('iteration_count'),
      best_score: r.get('best_score')
    }));
  } finally {
    await session.close();
  }
}

async function getProject(id) {
  const s1 = driver.session();
  const s2 = driver.session();
  try {
    const [projRes, iterRes] = await Promise.all([
      s1.run('MATCH (p:Project {id: $id}) RETURN p', { id }),
      s2.run(
        `MATCH (p:Project {id: $id})-[:HAS_ITERATION]->(i:Iteration)
         RETURN i ORDER BY i.number ASC`,
        { id }
      )
    ]);
    if (!projRes.records.length) return null;
    return {
      ...projRes.records[0].get('p').properties,
      iterations: iterRes.records.map(r => r.get('i').properties)
    };
  } finally {
    await s1.close();
    await s2.close();
  }
}

async function createProject(data) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const session = driver.session();
  try {
    await session.run(
      `CREATE (p:Project {
        id: $id,
        name: $name,
        objective: $objective,
        status: 'active',
        max_iterations: $max_iterations,
        created_at: $created_at,
        hermes_session_id: null,
        best_score: null,
        artifact: null
      })`,
      {
        id,
        name: data.name || 'Untitled Project',
        objective: data.objective || '',
        max_iterations: neo4j.int(data.max_iterations || 10),
        created_at: now
      }
    );
    return { id, name: data.name, objective: data.objective, status: 'active', created_at: now };
  } finally {
    await session.close();
  }
}

async function updateProject(id, data) {
  const session = driver.session();
  try {
    const sets = Object.entries(data)
      .map(([k]) => `p.${k} = $${k}`)
      .join(', ');
    await session.run(`MATCH (p:Project {id: $id}) SET ${sets}`, { id, ...data });
    return true;
  } finally {
    await session.close();
  }
}

async function addIteration(projectId, data) {
  const session = driver.session();
  try {
    // Get next iteration number
    const countRes = await session.run(
      'MATCH (:Project {id: $id})-[:HAS_ITERATION]->(i:Iteration) RETURN count(i) AS n',
      { id: projectId }
    );
    const n = (countRes.records[0]?.get('n').toNumber?.() ?? 0) + 1;
    const iterationId = `${projectId}_iter_${n}`;
    await session.run(
      `MATCH (p:Project {id: $projectId})
       CREATE (i:Iteration {
         id: $iterationId,
         number: $n,
         session_id: $session_id,
         score: $score,
         decision: $decision,
         judge_reasoning: $judge_reasoning,
         summary: $summary,
         created_at: $created_at
       })
       CREATE (p)-[:HAS_ITERATION]->(i)`,
      {
        projectId,
        iterationId,
        n: neo4j.int(n),
        session_id: data.session_id || null,
        score: data.score || null,
        decision: data.decision || 'pending',
        judge_reasoning: data.judge_reasoning || null,
        summary: data.summary || null,
        created_at: new Date().toISOString()
      }
    );
    return { id: iterationId, number: n };
  } finally {
    await session.close();
  }
}

async function deleteProject(id) {
  const session = driver.session();
  try {
    await session.run(
      'MATCH (p:Project {id: $id}) OPTIONAL MATCH (p)-[:HAS_ITERATION]->(i) DETACH DELETE p, i',
      { id }
    );
    return true;
  } finally {
    await session.close();
  }
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { json(res, 200, {}); return; }
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/projects/health')) {
    json(res, 200, { ok: true }); return;
  }

  const r = route(req);
  if (!r) { json(res, 404, { error: 'Not found' }); return; }

  try {
    // GET /projects
    if (req.method === 'GET' && !r.id) {
      json(res, 200, { projects: await listProjects() });
      return;
    }
    // POST /projects
    if (req.method === 'POST' && !r.id) {
      const body = await parseBody(req);
      json(res, 201, await createProject(body));
      return;
    }
    // GET /projects/:id
    if (req.method === 'GET' && r.id && !r.sub) {
      const p = await getProject(r.id);
      if (!p) { json(res, 404, { error: 'Not found' }); return; }
      json(res, 200, p);
      return;
    }
    // PATCH /projects/:id
    if (req.method === 'PATCH' && r.id && !r.sub) {
      const body = await parseBody(req);
      await updateProject(r.id, body);
      json(res, 200, { ok: true });
      return;
    }
    // POST /projects/:id/iterations
    if (req.method === 'POST' && r.id && r.sub === 'iterations') {
      const body = await parseBody(req);
      json(res, 201, await addIteration(r.id, body));
      return;
    }
    // DELETE /projects/:id
    if (req.method === 'DELETE' && r.id && !r.sub) {
      await deleteProject(r.id);
      json(res, 200, { ok: true });
      return;
    }
    json(res, 405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[projects-api] error:', err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => console.log(`[projects-api] listening on :${PORT}`));
process.on('SIGTERM', async () => { await driver.close(); process.exit(0); });
