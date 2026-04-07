#!/usr/bin/env node
/**
 * Collective MCP Server — stdio transport
 *
 * Exposes two tools to Hermes drones:
 *   - vinculum   : Neo4j knowledge graph (read/write/relate/context)
 *   - one        : Claude Code via one-api HTTP on claude.csdyn.com
 *
 * Runs as an MCP stdio server configured in hermes-config.yaml mcp_servers.
 */

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


// ─── Tool implementations ─────────────────────────────────────────────────────

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

async function runOne(args) {
  const { ONE_API_URL, ONE_API_KEY } = config.GENERAL;
  const { task, context = '', working_directory = '/opt/collective' } = args;

  try {
    const res = await fetch(`${ONE_API_URL}/invoke`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': ONE_API_KEY },
      body:    JSON.stringify({ task, context, working_directory }),
      signal:  AbortSignal.timeout(300_000)
    });
    const data = await res.json();
    if (data.error) return `[One — Error]\n${data.error}\n\nLocutus: One unavailable. Proceeding with collective knowledge only.`;
    return data.result;
  } catch (err) {
    return `[One — Error]\n${err.message}\n\nLocutus: One unavailable. Proceeding with collective knowledge only.`;
  }
}

// ─── Tool registry ─────────────────────────────────────────────────────────────

const TOOLS = [
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
      if (name === 'vinculum') text = await runVinculum(args);
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
