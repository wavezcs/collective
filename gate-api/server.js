#!/usr/bin/env node
/**
 * Gate API — Gateduino MQTT bridge for Mission Control
 *
 * Subscribes to gateduino/# on the MQTT broker (ha.csdyn.com) and exposes
 * the gate system state over HTTP for the 2B site. Runs on port 3004.
 *
 * Endpoints:
 *   GET  /gate/status   — snapshot: per-node lwt/status/config + recent logs
 *   POST /gate/command  — {command: OPEN|CLOSE|PING|RESTART, node?: gate|front|back|all}
 *   GET  /gate/events   — SSE stream of live MQTT updates
 *   GET  /health
 *
 * Gateduino topics (see gate6/esphome/*.yaml):
 *   gateduino/<role>/lwt     — online/offline (retained)
 *   gateduino/<role>/status  — JSON, ~5s (gate) / on RSSI change (front/back)
 *   gateduino/<role>/config  — JSON, 30s (retained)
 *   gateduino/<role>/log     — plain-text log lines
 *   gateduino/<role>/command — OPEN/CLOSE/PING/RESTART (gate node)
 *   gateduino/all/command    — broadcast commands
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const mqtt = require('mqtt');

const CONFIG_PATH = path.join(__dirname, '../config/collective.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const { MQTT_HOST, MQTT_PORT, MQTT_USER, MQTT_PASSWORD } = config.GENERAL;
const PORT = 3004;

const NODES = ['front', 'back', 'gate'];
const COMMANDS = ['OPEN', 'CLOSE', 'PING', 'RESTART'];
const LOG_LIMIT = 200;

// ─── State ───────────────────────────────────────────────────────────────────

const state = {
  broker: 'connecting',
  nodes: Object.fromEntries(NODES.map(n => [n, {
    online: false,
    status: null,   // last status JSON
    config: null,   // last retained config JSON
    statusAt: null,
    configAt: null,
    lwtAt: null
  }])),
  logs: []          // { node, message, at } ring buffer, newest last
};

const sseClients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) res.write(frame);
}

function pushLog(node, message) {
  const entry = { node, message, at: new Date().toISOString() };
  state.logs.push(entry);
  if (state.logs.length > LOG_LIMIT) state.logs.shift();
  broadcast('log', entry);
}

// ─── MQTT ────────────────────────────────────────────────────────────────────

const client = mqtt.connect(`mqtt://${MQTT_HOST}:${MQTT_PORT || 1883}`, {
  username: MQTT_USER,
  password: MQTT_PASSWORD,
  reconnectPeriod: 5000,
  clientId: 'collective-gate-api'
});

client.on('connect', () => {
  state.broker = 'connected';
  client.subscribe('gateduino/#');
  broadcast('broker', { broker: state.broker });
  console.log(`[mqtt] connected to ${MQTT_HOST}`);
});

client.on('close', () => {
  state.broker = 'disconnected';
  broadcast('broker', { broker: state.broker });
});

client.on('error', err => console.error('[mqtt]', err.message));

client.on('message', (topic, payload) => {
  const [, node, kind] = topic.split('/');
  if (!NODES.includes(node)) return;
  const msg = payload.toString();
  const rec = state.nodes[node];
  const now = new Date().toISOString();

  switch (kind) {
    case 'lwt':
      rec.online = msg === 'online';
      rec.lwtAt = now;
      broadcast('node', { node, ...rec });
      break;
    case 'status':
    case 'config': {
      let parsed;
      try { parsed = JSON.parse(msg); } catch { parsed = { raw: msg }; }
      rec[kind] = parsed;
      rec[kind + 'At'] = now;
      // A status message implies the node is alive even if we missed the birth message
      if (kind === 'status') rec.online = true;
      broadcast('node', { node, ...rec });
      break;
    }
    case 'log':
      pushLog(node, msg);
      break;
  }
});

// ─── HTTP ────────────────────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.replace(/\?.*$/, '');

  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (req.method === 'GET' && url === '/health') {
    return json(res, 200, { ok: true, broker: state.broker });
  }

  if (req.method === 'GET' && url === '/gate/status') {
    return json(res, 200, state);
  }

  if (req.method === 'POST' && url === '/gate/command') {
    try {
      const { command, node = 'gate' } = await parseBody(req);
      const cmd = String(command || '').toUpperCase();
      if (!COMMANDS.includes(cmd)) {
        return json(res, 400, { error: `command must be one of ${COMMANDS.join(', ')}` });
      }
      if (![...NODES, 'all'].includes(node)) {
        return json(res, 400, { error: `node must be one of ${NODES.join(', ')}, all` });
      }
      if (state.broker !== 'connected') {
        return json(res, 503, { error: 'MQTT broker not connected' });
      }
      client.publish(`gateduino/${node}/command`, cmd);
      pushLog(node, `Command sent from 2B: ${cmd}`);
      return json(res, 200, { ok: true, node, command: cmd });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  if (req.method === 'GET' && url === '/gate/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    // Initial snapshot so the client doesn't need a separate fetch
    res.write(`event: snapshot\ndata: ${JSON.stringify(state)}\n\n`);
    sseClients.add(res);
    const keepalive = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(keepalive);
      sseClients.delete(res);
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => console.log(`Gate API listening on :${PORT}`));
