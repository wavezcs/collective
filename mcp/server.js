#!/usr/bin/env node
/**
 * Collective MCP Server — stdio transport
 *
 * Exposes three tools to OpenClaw drones:
 *   - paperclip  : Paperclip Mission Control issue management
 *   - vinculum   : Neo4j knowledge graph (read/write/relate/context)
 *   - one        : Claude Code (claude -p) on claude.csdyn.com via SSH
 *
 * Runs as an MCP stdio server configured in openclaw.json mcp.servers.
 */

const http    = require('http');
const https   = require('https');
const { execSync } = require('child_process');
const neo4j   = require('neo4j-driver');
const path    = require('path');
const fs      = require('fs');

const CONFIG_PATH = path.join(__dirname, '../config/collective.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// ─── Neo4j driver ────────────────────────────────────────────────────────────

let _driver = null;
function getDriver() {
  if (_driver) return _driver;
  const { NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD } = config.GENERAL;
  _driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));
  return _driver;
}

// ─── HTTP helper (for Paperclip) ─────────────────────────────────────────────

function httpRequest(method, urlStr, apiKey, body = null) {
  return new Promise((resolve, reject) => {
    const url   = new URL(urlStr);
    const lib   = url.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const opts  = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      },
      ...(url.protocol === 'https:' ? { rejectUnauthorized: false } : {})
    };
    const req = lib.request(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode}: ${parsed.message || data}`));
          else resolve(parsed);
        } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Tool implementations ─────────────────────────────────────────────────────

async function runPaperclip(args) {
  const apiKey    = process.env.PAPERCLIP_API_KEY;
  const apiUrl    = process.env.PAPERCLIP_API_URL || 'http://localhost:3100';
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  if (!apiKey)    return 'Error: PAPERCLIP_API_KEY not set';
  if (!companyId) return 'Error: PAPERCLIP_COMPANY_ID not set';

  const base = `${apiUrl}/api/v1/companies/${companyId}`;
  const { operation, title, description, priority, status, assignee_id,
          issue_id, filter_status, filter_assignee, limit = 20, comment } = args;

  switch (operation) {
    case 'create_issue': {
      if (!title) return 'Error: title required';
      const b = { title };
      if (description) b.description = description;
      if (priority)    b.priority = priority;
      if (assignee_id) b.assignee_id = assignee_id;
      const issue = await httpRequest('POST', `${base}/issues`, apiKey, b);
      return `Created issue #${issue.number || issue.id} — "${issue.title}" (${issue.id})`;
    }
    case 'list_issues': {
      const p = new URLSearchParams({ limit: String(limit) });
      if (filter_status)   p.set('status', filter_status);
      if (filter_assignee) p.set('assignee_id', filter_assignee);
      const result = await httpRequest('GET', `${base}/issues?${p}`, apiKey);
      const issues = Array.isArray(result) ? result : (result.issues || result.data || []);
      if (!issues.length) return 'No issues found';
      return issues.map(i => `  #${i.number || i.id} [${i.status}] ${i.title}${i.priority ? ` (${i.priority})` : ''}`).join('\n');
    }
    case 'get_issue': {
      if (!issue_id) return 'Error: issue_id required';
      const issue = await httpRequest('GET', `${base}/issues/${issue_id}`, apiKey);
      return JSON.stringify(issue, null, 2);
    }
    case 'update_issue': {
      if (!issue_id) return 'Error: issue_id required';
      const b = {};
      if (title)       b.title = title;
      if (description) b.description = description;
      if (priority)    b.priority = priority;
      if (status)      b.status = status;
      if (assignee_id) b.assignee_id = assignee_id;
      if (!Object.keys(b).length) return 'Error: no fields to update';
      const issue = await httpRequest('PATCH', `${base}/issues/${issue_id}`, apiKey, b);
      return `Updated issue ${issue_id} — status: ${issue.status || status}`;
    }
    case 'add_comment': {
      if (!issue_id) return 'Error: issue_id required';
      if (!comment)  return 'Error: comment required';
      const result = await httpRequest('POST', `${base}/issues/${issue_id}/comments`, apiKey, { body: comment });
      return `Comment added to issue ${issue_id} (id: ${result.id || 'ok'})`;
    }
    default: return `Error: unknown operation "${operation}"`;
  }
}

async function runVinculum(args) {
  const driver  = getDriver();
  const session = driver.session();
  const { operation, cypher, node_type, properties, subject, from_name, relationship, to_name } = args;
  try {
    switch (operation) {
      case 'write': {
        if (!node_type || !properties) return 'Error: node_type and properties required';
        const props = Object.keys(properties).map(k => `${k}: $${k}`).join(', ');
        await session.run(`MERGE (n:${node_type} {name: $name}) SET n += {${props}} RETURN n`, properties);
        return `Wrote ${node_type} node "${properties.name || JSON.stringify(properties)}"`;
      }
      case 'query': {
        if (!cypher) return 'Error: cypher required';
        const result = await session.run(cypher);
        const records = result.records.map(r => r.toObject());
        return records.length ? JSON.stringify(records, null, 2) : 'No records found';
      }
      case 'context': {
        if (!subject) return 'Error: subject required';
        const result = await session.run(
          'MATCH (n) WHERE n.name CONTAINS $subject OPTIONAL MATCH (n)-[r]-(related) RETURN n, type(r) as rel_type, related LIMIT 50',
          { subject }
        );
        const records = result.records.map(r => ({
          node: r.get('n').properties,
          relationship: r.get('rel_type'),
          related: r.get('related') ? r.get('related').properties : null
        }));
        return records.length ? JSON.stringify(records, null, 2) : `No context for "${subject}"`;
      }
      case 'relate': {
        if (!from_name || !relationship || !to_name) return 'Error: from_name, relationship, to_name required';
        await session.run(
          `MATCH (a {name: $from_name}), (b {name: $to_name}) MERGE (a)-[:${relationship}]->(b)`,
          { from_name, to_name }
        );
        return `Created (${from_name})-[:${relationship}]->(${to_name})`;
      }
      default: return `Error: unknown operation "${operation}"`;
    }
  } finally {
    await session.close();
  }
}

async function logOneInvocation(task, outcome) {
  const apiKey    = process.env.PAPERCLIP_API_KEY;
  const apiUrl    = process.env.PAPERCLIP_API_URL || 'http://localhost:3100';
  const companyId = process.env.PAPERCLIP_COMPANY_ID;
  if (!apiKey || !companyId) return;

  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const shortTask = task.length > 120 ? task.slice(0, 120) + '…' : task;
  const shortOutcome = outcome.startsWith('[One — Error]') ? 'error' : 'ok';
  try {
    await httpRequest('POST', `${apiUrl}/api/v1/companies/${companyId}/issues`, apiKey, {
      title: `One: ${shortTask}`,
      description: `**Invoked**: ${ts}\n**Status**: ${shortOutcome}\n\n**Task**:\n${task}\n\n**Response preview**:\n${outcome.slice(0, 500)}`,
      priority: 'low',
    });
  } catch (_) { /* best-effort — don't fail One calls due to logging errors */ }
}

async function runOne(args) {
  const { ONE_HOST, ONE_USER } = config.GENERAL;
  const { task, context = '', working_directory = '/opt/collective' } = args;

  const prompt = [
    'You are One, invoked by the Collective via Locutus.',
    context ? `Context from Collective drones:\n${context}` : '',
    `Task:\n${task}`,
    'Return structured, actionable output. Be concise.'
  ].filter(Boolean).join('\n\n');

  const escaped = prompt.replace(/'/g, "'\\''");
  let result;
  try {
    result = execSync(
      `ssh -o StrictHostKeyChecking=no -o ConnectTimeout=30 ${ONE_USER}@${ONE_HOST} "cd ${working_directory} && claude --dangerously-skip-permissions -p '${escaped}'"`,
      { encoding: 'utf8', timeout: 300000, maxBuffer: 10 * 1024 * 1024 }
    );
    result = `[One]\n${result.trim()}`;
  } catch (err) {
    result = `[One — Error]\n${err.stdout || err.message}\n\nLocutus: One unavailable. Proceeding with collective knowledge only.`;
  }
  logOneInvocation(task, result); // fire-and-forget
  return result;
}

// ─── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'paperclip',
    description: 'Manage Paperclip (Mission Control) issues. Create tasks, list open issues, update status, add comments.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['create_issue','list_issues','get_issue','update_issue','add_comment'] },
        title:          { type: 'string' },
        description:    { type: 'string' },
        priority:       { type: 'string', enum: ['low','medium','high','urgent'] },
        status:         { type: 'string', enum: ['open','in_progress','done','cancelled'] },
        assignee_id:    { type: 'string' },
        issue_id:       { type: 'string' },
        filter_status:  { type: 'string' },
        filter_assignee:{ type: 'string' },
        limit:          { type: 'number' },
        comment:        { type: 'string' }
      },
      required: ['operation']
    }
  },
  {
    name: 'vinculum',
    description: "Read and write to the Collective's Neo4j knowledge graph. Store research findings, retrieve context, manage relationships.",
    inputSchema: {
      type: 'object',
      properties: {
        operation:    { type: 'string', enum: ['write','query','context','relate'] },
        cypher:       { type: 'string' },
        node_type:    { type: 'string' },
        properties:   { type: 'object' },
        subject:      { type: 'string' },
        from_name:    { type: 'string' },
        relationship: { type: 'string' },
        to_name:      { type: 'string' }
      },
      required: ['operation']
    }
  },
  {
    name: 'one',
    description: 'Invoke One (Claude Code on claude.csdyn.com) for tasks exceeding local drone capability.',
    inputSchema: {
      type: 'object',
      properties: {
        task:              { type: 'string' },
        context:           { type: 'string' },
        working_directory: { type: 'string' }
      },
      required: ['task']
    }
  }
];

// ─── MCP stdio protocol ───────────────────────────────────────────────────────

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handleRequest(msg) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    return send({ jsonrpc: '2.0', id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'collective', version: '1.0.0' }
    }});
  }

  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;

  if (method === 'tools/list') {
    return send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
  }

  if (method === 'tools/call') {
    const { name, arguments: args = {} } = params;
    try {
      let text;
      if (name === 'paperclip') text = await runPaperclip(args);
      else if (name === 'vinculum') text = await runVinculum(args);
      else if (name === 'one') text = await runOne(args);
      else text = `Error: unknown tool "${name}"`;
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } });
    } catch (err) {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true } });
    }
  }

  if (method === 'ping') {
    return send({ jsonrpc: '2.0', id, result: {} });
  }

  // Unknown method
  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}

// ─── Main loop ────────────────────────────────────────────────────────────────

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const lines = buf.split('\n');
  buf = lines.pop(); // keep incomplete line
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const msg = JSON.parse(trimmed);
      handleRequest(msg).catch(err => {
        if (msg.id != null) {
          send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
        }
      });
    } catch {
      // Malformed JSON — ignore
    }
  }
});

process.stdin.on('end', () => {
  if (_driver) _driver.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  if (_driver) _driver.close();
  process.exit(0);
});
