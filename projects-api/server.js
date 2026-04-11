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

function serializeVal(v) {
  return neo4j.isInt(v) ? v.toNumber() : v;
}

function serializeProps(props) {
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    out[k] = serializeVal(v);
  }
  return out;
}

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
      ...serializeProps(r.get('p').properties),
      iteration_count: serializeVal(r.get('iteration_count')),
      best_score: serializeVal(r.get('best_score'))
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
      ...serializeProps(projRes.records[0].get('p').properties),
      iterations: iterRes.records.map(r => serializeProps(r.get('i').properties))
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

async function clearIterations(id) {
  const session = driver.session();
  try {
    await session.run(
      'MATCH (:Project {id: $id})-[:HAS_ITERATION]->(i:Iteration) DETACH DELETE i',
      { id }
    );
    return true;
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
    // DELETE /projects/:id/iterations
    if (req.method === 'DELETE' && r.id && r.sub === 'iterations') {
      await clearIterations(r.id);
      json(res, 200, { ok: true });
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

// ─── Session health monitor ───────────────────────────────────────────────────

const HERMES_API       = 'http://127.0.0.1:8642';
const STALL_MS         = 3 * 60 * 1000;   // 3 minutes without token movement = stalled
const HEALTH_INTERVAL  = 30 * 1000;        // check every 30 seconds

async function getActiveProjects() {
  const session = driver.session();
  try {
    const result = await session.run(
      `MATCH (p:Project)
       WHERE p.status IN ['active', 'stalled'] AND p.hermes_session_id IS NOT NULL
       AND p.research_started_at IS NOT NULL
       RETURN p.id AS id,
              p.hermes_session_id AS session_id,
              p.last_token_count  AS last_token_count,
              p.last_token_at     AS last_token_at,
              p.status            AS status`
    );
    return result.records.map(r => ({
      id:               r.get('id'),
      session_id:       r.get('session_id'),
      last_token_count: serializeVal(r.get('last_token_count')) || 0,
      last_token_at:    r.get('last_token_at'),
      status:           r.get('status'),
    }));
  } finally {
    await session.close();
  }
}

async function setProjectHealth(id, status, tokenCount, tokenAt) {
  const session = driver.session();
  try {
    await session.run(
      `MATCH (p:Project {id: $id})
       SET p.status            = $status,
           p.last_token_count  = $tokenCount,
           p.last_token_at     = $tokenAt`,
      { id, status, tokenCount: neo4j.int(tokenCount), tokenAt }
    );
    console.log(`[health] ${id.slice(0,8)} → ${status} (tokens: ${tokenCount})`);
  } finally {
    await session.close();
  }
}

async function runHealthCheck() {
  let projects;
  try {
    projects = await getActiveProjects();
  } catch (err) {
    console.error('[health] failed to fetch projects:', err.message);
    return;
  }

  for (const proj of projects) {
    try {
      const res = await fetch(`${HERMES_API}/api/sessions/${proj.session_id}`, {
        signal: AbortSignal.timeout(10_000)
      });
      if (!res.ok) {
        console.warn(`[health] Hermes returned ${res.status} for session ${proj.session_id}`);
        continue;
      }
      const data = await res.json();
      const s    = data.session || data;
      const outputTokens = s.output_tokens || 0;
      const now          = new Date().toISOString();

      if (s.ended_at) {
        await setProjectHealth(proj.id, 'complete', outputTokens, proj.last_token_at || now);
        continue;
      }

      if (outputTokens > proj.last_token_count) {
        // Tokens moving — alive
        await setProjectHealth(proj.id, 'active', outputTokens, now);
      } else {
        // No token movement — check staleness
        const lastAt = proj.last_token_at ? new Date(proj.last_token_at).getTime() : null;
        const stale  = lastAt && (Date.now() - lastAt) > STALL_MS;
        if (stale) {
          // Hermes never sets ended_at, so use iteration count as completion signal:
          // if the project has recorded at least one iteration it finished its loop.
          const iterSess = driver.session();
          let iterCount = 0;
          try {
            const ir = await iterSess.run(
              'MATCH (:Project {id: $id})-[:HAS_ITERATION]->(i:Iteration) RETURN count(i) AS n',
              { id: proj.id }
            );
            iterCount = ir.records[0]?.get('n')?.toNumber?.() ?? 0;
          } finally {
            await iterSess.close();
          }
          const newStatus = iterCount > 0 ? 'complete' : 'stalled';
          if (proj.status !== newStatus) {
            await setProjectHealth(proj.id, newStatus, outputTokens, proj.last_token_at);
          }
        }
        // If last_token_at not yet set, initialise it so the clock starts
        if (!lastAt) {
          await setProjectHealth(proj.id, proj.status, outputTokens, now);
        }
      }
    } catch (err) {
      console.error(`[health] check failed for project ${proj.id}:`, err.message);
    }
  }
}

// Kick off health monitor
setTimeout(runHealthCheck, 5_000);
setInterval(runHealthCheck, HEALTH_INTERVAL);
