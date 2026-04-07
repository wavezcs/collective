#!/usr/bin/env node
/**
 * One API — HTTP gateway for Claude Code on claude.csdyn.com
 *
 * Replaces the SSH-based invocation in mcp/server.js with a persistent
 * HTTP server. No handshake overhead, supports streaming SSE.
 *
 * Endpoints:
 *   POST /invoke        — blocking, returns {result} or {error}
 *   POST /invoke/stream — SSE, streams claude output line-by-line
 *   GET  /health        — health check
 */

const http   = require('http');
const { spawn } = require('child_process');
const fs     = require('fs');
const path   = require('path');

const CONFIG_PATH = path.join(__dirname, '../config/collective.json');
const config  = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const API_KEY = config.GENERAL.ONE_API_KEY;
const PORT    = config.GENERAL.ONE_API_PORT || 8643;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildPrompt(task, context) {
  return [
    'You are One, invoked by the Collective via Locutus.',
    context ? `Context from Collective drones:\n${context}` : '',
    `Task:\n${task}`,
    'Return structured, actionable output. Be concise.'
  ].filter(Boolean).join('\n\n');
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(body)); }
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req, res) {
  if (req.headers['x-api-key'] !== API_KEY) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return false;
  }
  return true;
}

function runClaude(prompt, cwd) {
  return spawn('claude', ['--dangerously-skip-permissions', '-p', prompt], {
    cwd: cwd || '/opt/collective',
    env: process.env
  });
}

// ─── Server ──────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {

  // Health check — no auth required
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  if (!checkAuth(req, res)) return;

  // ── POST /invoke — blocking ────────────────────────────────────────────────
  if (req.method === 'POST' && req.url === '/invoke') {
    let body;
    try { body = await parseBody(req); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const { task, context = '', working_directory } = body;
    if (!task) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'task is required' }));
      return;
    }

    const prompt = buildPrompt(task, context);
    const proc   = runClaude(prompt, working_directory);

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d);
    proc.stderr.on('data', d => stderr += d);

    proc.on('close', code => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (code === 0) {
        res.end(JSON.stringify({ result: `[One]\n${stdout.trim()}` }));
      } else {
        res.end(JSON.stringify({ error: stderr.trim() || `claude exited ${code}`, stdout: stdout.trim() }));
      }
    });

    proc.on('error', err => {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    });

    return;
  }

  // ── POST /invoke/stream — SSE streaming ───────────────────────────────────
  if (req.method === 'POST' && req.url === '/invoke/stream') {
    let body;
    try { body = await parseBody(req); }
    catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
      return;
    }

    const { task, context = '', working_directory } = body;
    if (!task) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'task is required' }));
      return;
    }

    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const prompt = buildPrompt(task, context);
    const proc   = runClaude(prompt, working_directory);

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    proc.stdout.on('data', chunk => send('delta', { text: chunk.toString() }));
    proc.stderr.on('data', chunk => send('log',   { text: chunk.toString() }));

    proc.on('close', code => {
      send('done', { exit_code: code });
      res.end();
    });

    proc.on('error', err => {
      send('error', { message: err.message });
      res.end();
    });

    // Clean up if client disconnects
    req.on('close', () => {
      if (proc.exitCode === null) proc.kill();
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[one-api] listening on :${PORT}`);
});

server.on('error', err => {
  console.error('[one-api] server error:', err);
  process.exit(1);
});
