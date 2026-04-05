#!/usr/bin/env bash
# deploy.sh — The Collective deployment pipeline
# Usage: ./deploy.sh "commit message"
#
# Deploys to collective.csdyn.com and runs canary tests.
# Also handles ai-trader model migration if --migrate-models flag is set.

set -euo pipefail

COMMIT_MSG="${1:-deploy: update collective}"
REMOTE_HOST="collective.csdyn.com"
REMOTE_DIR="/opt/collective"
OLLAMA_HOST="ollama.csdyn.com"
AI_TRADER_HOST="ai-trader.csdyn.com"
AI_TRADER_DIR="/opt/trading_desk"

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${BLUE}[deploy]${NC} $1"; }
ok()   { echo -e "${GREEN}[ok]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

# ─── 1. Git commit + push ────────────────────────────────────────────────────
log "Committing and pushing to GitHub..."
git add -A
if git diff --cached --quiet; then
  warn "No staged changes — skipping commit"
else
  git commit -m "$COMMIT_MSG"
fi
git push origin main
ok "GitHub updated"

# ─── 2. Sync to collective.csdyn.com ────────────────────────────────────────
log "Syncing to $REMOTE_HOST..."
rsync -az --delete \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='*.pyc' \
  --exclude='__pycache__' \
  --exclude='.env' \
  /opt/collective/ root@$REMOTE_HOST:$REMOTE_DIR/
ok "Sync complete"

# ─── 3. Remote setup ────────────────────────────────────────────────────────
log "Running remote setup on $REMOTE_HOST..."

# Compute hashes for dependency change detection
LOCAL_PKG_HASH=$(md5sum /opt/collective/package.json | cut -d' ' -f1)

ssh root@$REMOTE_HOST bash <<ENDSSH
set -euo pipefail

cd $REMOTE_DIR

# Node.js / OpenClaw
if ! command -v node &>/dev/null || [[ "\$(node --version | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "[remote] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v openclaw &>/dev/null; then
  echo "[remote] Installing OpenClaw..."
  npm install -g openclaw@latest
  openclaw onboard --install-daemon --non-interactive || true
fi

# Paperclip — install if not present
if ! command -v paperclipai &>/dev/null; then
  echo "[remote] Installing Paperclip..."
  npm install -g paperclipai
fi

# Install npm dependencies if package.json changed
REMOTE_PKG_HASH=\$(md5sum $REMOTE_DIR/package.json 2>/dev/null | cut -d' ' -f1 || echo "none")
if [[ "\$REMOTE_PKG_HASH" != "$LOCAL_PKG_HASH" ]]; then
  echo "[remote] Installing npm dependencies..."
  npm install --prefix $REMOTE_DIR
fi

# Neo4j — install if not present
if ! systemctl is-active --quiet neo4j 2>/dev/null; then
  if ! command -v neo4j &>/dev/null; then
    echo "[remote] Installing Neo4j..."
    wget -O- https://debian.neo4j.com/neotechnology.gpg.key | gpg --dearmor -o /etc/apt/keyrings/neo4j.gpg
    echo 'deb [signed-by=/etc/apt/keyrings/neo4j.gpg] https://debian.neo4j.com stable latest' > /etc/apt/sources.list.d/neo4j.list
    apt-get update -q
    apt-get install -y neo4j
    systemctl enable neo4j
  fi
  systemctl start neo4j
  echo "[remote] Waiting for Neo4j to start..."
  for i in \$(seq 1 15); do
    if cypher-shell -u neo4j -p neo4j "RETURN 1" &>/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  # Initialize schema
  COLLECTIVE_PW=\$(python3 -c "import json; print(json.load(open('$REMOTE_DIR/config/collective.json'))['GENERAL']['NEO4J_PASSWORD'])")
  cypher-shell -u neo4j -p neo4j "ALTER USER neo4j SET PASSWORD '\$COLLECTIVE_PW' CHANGE NOT REQUIRED" || true
  cypher-shell -u neo4j -p "\$COLLECTIVE_PW" < $REMOTE_DIR/neo4j/init.cypher || true
  echo "[remote] Neo4j schema initialized"
fi

# Configure OpenClaw agents — write SOUL.md to each agent's workspace root
# OpenClaw injects SOUL.md (and AGENTS.md, IDENTITY.md, USER.md) from workspace root
# into every session's system prompt. BOOTSTRAP.md triggers first-boot behavior — delete it.
python3 - <<PYEOF
import json, subprocess, os

def get_workspace(agent_id):
    r = subprocess.run(['openclaw', 'agents', 'list', '--json'],
                       capture_output=True, text=True)
    agents = json.loads(r.stdout)
    for a in agents:
        if a['id'] == agent_id:
            return a.get('workspace')
    return None

unimatrix = open('$REMOTE_DIR/agents/unimatrix.md').read().strip()

for agent in ['locutus', 'seven', 'data', 'hugh', 'vinculum']:
    ws = get_workspace(agent)
    if not ws:
        print(f'[remote] WARNING: no workspace found for {agent}')
        continue
    os.makedirs(ws, exist_ok=True)
    # SOUL.md = agent designation + full collective context (unimatrix)
    designation_path = f'$REMOTE_DIR/agents/{agent}/designation.md'
    designation = open(designation_path).read().strip()
    soul = designation + '\n\n---\n\n' + unimatrix + '\n'
    with open(os.path.join(ws, 'SOUL.md'), 'w') as f:
        f.write(soul)
    # Delete BOOTSTRAP.md if present — agent is already configured
    bootstrap = os.path.join(ws, 'BOOTSTRAP.md')
    if os.path.exists(bootstrap):
        os.remove(bootstrap)
        print(f'[remote] {agent}: deleted BOOTSTRAP.md')
    # Write custom AGENTS.md if present in agent dir (overrides OpenClaw default)
    custom_agents = f'$REMOTE_DIR/agents/{agent}/AGENTS.md'
    if os.path.exists(custom_agents):
        import shutil
        shutil.copy(custom_agents, os.path.join(ws, 'AGENTS.md'))
        print(f'[remote] {agent}: custom AGENTS.md written to {ws}')
    print(f'[remote] {agent}: SOUL.md written to {ws}')

PYEOF
echo "[remote] Agent designations updated"

ENDSSH

ok "Remote setup complete"

# ─── 4. Configure OpenClaw ───────────────────────────────────────────────────
log "Configuring OpenClaw on $REMOTE_HOST..."

ssh root@$REMOTE_HOST bash <<ENDSSH
set -e
CONFIG_FILE=$REMOTE_DIR/config/collective.json
OPENCLAW_JSON=~/.openclaw/openclaw.json

# Merge settings into openclaw.json (preserves gateway auth token / pairing)
python3 - <<PYEOF
import json, os

cfg_path = '$REMOTE_DIR/config/collective.json'
oc_path  = os.path.expanduser('~/.openclaw/openclaw.json')

with open(cfg_path) as f:
    cfg = json.load(f)

oc = {}
if os.path.exists(oc_path):
    with open(oc_path) as f:
        oc = json.load(f)

ollama_base = 'http://{}:{}'.format(cfg['GENERAL']['OLLAMA_HOST'], cfg['GENERAL']['OLLAMA_PORT'])
telegram_token = cfg['GENERAL']['TELEGRAM_BOT_TOKEN']
allowed_users = cfg['GENERAL']['TELEGRAM_ALLOWED_USERS']

# Models
oc.setdefault('models', {}).setdefault('providers', {})['ollama'] = {
    'baseUrl': ollama_base,
    'apiKey': 'ollama-local',
    'api': 'ollama',
    'models': [
        {'id': 'hermes3:latest',          'name': 'hermes3:latest',          'contextWindow': 32000},
        {'id': 'llama3-10k:latest',       'name': 'llama3-10k:latest',       'contextWindow': 32000},
        {'id': 'llama3-16k:latest',       'name': 'llama3-16k:latest',       'contextWindow': 32000},
        {'id': 'qwen2.5-coder:14b',       'name': 'qwen2.5-coder:14b',       'contextWindow': 32000},
        {'id': 'nomic-embed-text:latest', 'name': 'nomic-embed-text:latest', 'contextWindow': 8192},
    ]
}

# Agents (v2026.4+: named agents via agents.list, not top-level keys)
oc['agents'] = {
    'list': [
        {'id': 'locutus',  'name': 'Locutus',   'model': {'primary': 'ollama/hermes3:latest'}},
        {'id': 'seven',    'name': 'Seven',      'model': {'primary': 'ollama/llama3-10k:latest'}},
        {'id': 'data',     'name': 'Data',       'model': {'primary': 'ollama/qwen2.5-coder:14b', 'fallbacks': ['ollama/llama3-10k:latest']}},
        {'id': 'hugh',     'name': 'Hugh',       'model': {'primary': 'ollama/hermes3:latest'}},
        {'id': 'vinculum', 'name': 'Vinculum',   'model': {'primary': 'ollama/nomic-embed-text:latest'}},
    ],
    'defaults': {
        'model': {'primary': 'ollama/hermes3:latest'},
        'maxConcurrent': 4,
        'timeoutSeconds': 300,
        'contextTokens': 32000
    }
}

# Channels (v2026.4+: allowFrom replaces allowedUsers)
oc.setdefault('channels', {})['telegram'] = {
    'enabled': True,
    'botToken': telegram_token,
    'allowFrom': allowed_users
}

# Skills (v2026.4+: object with load.extraDirs pointing to parent dir)
oc['skills'] = {
    'load': {
        'extraDirs': ['$REMOTE_DIR/skills'],
        'watch': True
    }
}
# Memory: remove legacy enabled/path keys (v2026.4+ uses backend/builtin, no custom path)
oc.pop('memory', None)

# MCP server — Collective tools (paperclip, vinculum, one)
oc.setdefault('mcp', {}).setdefault('servers', {})['collective'] = {
    'command': 'node',
    'args': ['$REMOTE_DIR/mcp/server.js'],
    'env': {
        'PAPERCLIP_API_KEY':    'pcp_f4c9176394a490a3e6960fdbbb914b48a07b1e8b95020b81',
        'PAPERCLIP_API_URL':    'http://localhost:3100',
        'PAPERCLIP_COMPANY_ID': 'f7790917-7be3-4cf0-a55a-bda98adf0c3f',
    }
}

os.makedirs(os.path.dirname(oc_path), exist_ok=True)
with open(oc_path, 'w') as f:
    json.dump(oc, f, indent=2)
print('[remote] openclaw.json updated')
PYEOF

# Ensure gateway mode is local
openclaw config set gateway.mode local 2>/dev/null || true
ENDSSH

ok "OpenClaw configured"

# ─── 5. Restart services ────────────────────────────────────────────────────
log "Restarting services..."
ssh root@$REMOTE_HOST bash <<'ENDSSH'
export XDG_RUNTIME_DIR=/run/user/0
# OpenClaw — prefer user systemd unit, fall back to openclaw gateway restart
if systemctl --user is-enabled --quiet openclaw-gateway.service 2>/dev/null; then
  systemctl --user restart openclaw-gateway.service
elif systemctl --user is-enabled --quiet collective-openclaw.service 2>/dev/null; then
  systemctl --user restart collective-openclaw.service
else
  openclaw gateway stop 2>/dev/null || true
  openclaw gateway start --detach 2>/dev/null || true
fi

# Paperclip
systemctl restart paperclip.service 2>/dev/null || true
ENDSSH
ok "Services restarted"

# ─── 6. Health check ────────────────────────────────────────────────────────
log "Waiting for OpenClaw to come up..."
for i in $(seq 1 15); do
  if ssh root@$REMOTE_HOST "export XDG_RUNTIME_DIR=/run/user/0; openclaw status 2>/dev/null | grep -q running" 2>/dev/null; then
    ok "OpenClaw is running"
    break
  fi
  if [[ $i -eq 15 ]]; then
    fail "OpenClaw did not start within 30s"
  fi
  sleep 2
done

# ─── 7. Canary tests ────────────────────────────────────────────────────────
log "Running canary tests..."
ssh root@$REMOTE_HOST "python3 $REMOTE_DIR/tests/test_canary.py \
  --collective-host http://localhost:18789 \
  --ollama-host http://ollama.csdyn.com:11434 \
  --neo4j-bolt bolt://localhost:7687 \
  --skip-one \
  --skip-inference"

ok "Canary tests passed"

# ─── 8. ai-trader model validation (if models were updated) ─────────────────
if [[ "${MIGRATE_MODELS:-false}" == "true" ]]; then
  log "Validating ai-trader model connectivity..."
  ssh root@$AI_TRADER_HOST "cd /opt/trading_desk && source venv/bin/activate && python3 src/tests/test_canary.py --api-base http://localhost:8000"
  ok "ai-trader canary passed after model migration"
fi

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   The Collective is online. Resistance   ║${NC}"
echo -e "${GREEN}║             is futile.                   ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Mission Control: http://collective.csdyn.com:3100"
echo "  Neo4j Browser:   http://collective.csdyn.com:7474"
echo "  OpenClaw WS:     ws://collective.csdyn.com:18789"
echo ""
