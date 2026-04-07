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
git push origin hermes-migration
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

LOCAL_PKG_HASH=$(md5sum /opt/collective/package.json | cut -d' ' -f1)

ssh root@$REMOTE_HOST bash <<ENDSSH
set -euo pipefail

cd $REMOTE_DIR

# Node.js
if ! command -v node &>/dev/null || [[ "\$(node --version | cut -d. -f1 | tr -d 'v')" -lt 22 ]]; then
  echo "[remote] Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# Hermes Agent — install if not present
if ! command -v hermes &>/dev/null && [[ ! -f /root/.local/bin/hermes ]]; then
  echo "[remote] Installing Hermes Agent..."
  curl -fsSL https://raw.githubusercontent.com/NousResearch/hermes-agent/main/scripts/install.sh | bash
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
  COLLECTIVE_PW=\$(python3 -c "import json; print(json.load(open('$REMOTE_DIR/config/collective.json'))['GENERAL']['NEO4J_PASSWORD'])")
  cypher-shell -u neo4j -p neo4j "ALTER USER neo4j SET PASSWORD '\$COLLECTIVE_PW' CHANGE NOT REQUIRED" || true
  cypher-shell -u neo4j -p "\$COLLECTIVE_PW" < $REMOTE_DIR/neo4j/init.cypher || true
  echo "[remote] Neo4j schema initialized"
fi

# hermes-workspace — install if not present
if [[ ! -d /opt/hermes-workspace ]]; then
  echo "[remote] Installing hermes-workspace..."
  cd /opt && git clone https://github.com/outsourc-e/hermes-workspace.git
  cd /opt/hermes-workspace && npm install && npm run build
  cp .env.example .env
  cat > /etc/systemd/system/hermes-workspace.service << 'SVCEOF'
[Unit]
Description=Hermes Workspace UI
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/hermes-workspace
ExecStart=/usr/bin/node server-entry.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
EnvironmentFile=/opt/hermes-workspace/.env

[Install]
WantedBy=multi-user.target
SVCEOF
  systemctl daemon-reload
  systemctl enable hermes-workspace
fi

# Always ensure HERMES_API_URL is set in workspace .env
if [[ -f /opt/hermes-workspace/.env ]]; then
  if grep -q '^HERMES_API_URL=' /opt/hermes-workspace/.env; then
    sed -i 's|^HERMES_API_URL=.*|HERMES_API_URL=http://collective.csdyn.com:8642|' /opt/hermes-workspace/.env
  else
    printf '\nHERMES_API_URL=http://collective.csdyn.com:8642\n' >> /opt/hermes-workspace/.env
  fi
  echo "[remote] hermes-workspace HERMES_API_URL set"
fi

ENDSSH

ok "Remote setup complete"

# ─── 4. Configure Hermes Agent ───────────────────────────────────────────────
log "Configuring Hermes Agent on $REMOTE_HOST..."

ssh root@$REMOTE_HOST python3 - <<PYEOF
import json, os

cfg_path = '$REMOTE_DIR/config/collective.json'
with open(cfg_path) as f:
    cfg = json.load(f)

g = cfg['GENERAL']
ollama_base = 'http://{}:{}/v1'.format(g['OLLAMA_HOST'], g['OLLAMA_PORT'])
telegram_token = g['TELEGRAM_BOT_TOKEN']
allowed_users = ','.join(str(u) for u in g['TELEGRAM_ALLOWED_USERS'])

# Write ~/.hermes/.env
env_path = os.path.expanduser('~/.hermes/.env')
env_lines = [
    '# Hermes Agent — The Collective',
    '# LLM: Ollama (local GPU cluster)',
    f'OPENAI_BASE_URL={ollama_base}',
    'OPENAI_API_KEY=ollama',
    '',
    '# API server for hermes-workspace',
    'API_SERVER_ENABLED=true',
    'API_SERVER_HOST=0.0.0.0',
    '',
    '# Telegram',
    f'TELEGRAM_BOT_TOKEN={telegram_token}',
    f'TELEGRAM_ALLOWED_USERS={allowed_users}',
]
with open(env_path, 'w') as f:
    f.write('\n'.join(env_lines) + '\n')
print('[remote] ~/.hermes/.env written')

# Write ~/.hermes/SOUL.md from repo
unimatrix = open('$REMOTE_DIR/agents/unimatrix.md').read().strip()
locutus   = open('$REMOTE_DIR/agents/locutus/designation.md').read().strip()
soul = locutus + '\n\n---\n\n' + unimatrix + '\n'
with open(os.path.expanduser('~/.hermes/SOUL.md'), 'w') as f:
    f.write(soul)
print('[remote] ~/.hermes/SOUL.md written')

# Write ~/.hermes/config.yaml
config_yaml = open('$REMOTE_DIR/agents/hermes-config.yaml').read()
with open(os.path.expanduser('~/.hermes/config.yaml'), 'w') as f:
    f.write(config_yaml)
print('[remote] ~/.hermes/config.yaml written')
PYEOF

ok "Hermes Agent configured"

# ─── 5. Restart services ────────────────────────────────────────────────────
log "Restarting services..."
ssh root@$REMOTE_HOST bash <<'ENDSSH'
export XDG_RUNTIME_DIR=/run/user/0
export PATH="$PATH:/root/.local/bin"

# Hermes gateway
hermes gateway restart 2>/dev/null || hermes gateway start 2>/dev/null || true

# hermes-workspace
systemctl restart hermes-workspace.service 2>/dev/null || true

# Neo4j (ensure running)
systemctl is-active --quiet neo4j || systemctl start neo4j || true
ENDSSH
ok "Services restarted"

# ─── 6. Health check ────────────────────────────────────────────────────────
log "Waiting for Hermes gateway to come up..."
for i in $(seq 1 15); do
  if ssh root@$REMOTE_HOST "export XDG_RUNTIME_DIR=/run/user/0 PATH=\$PATH:/root/.local/bin; hermes gateway status 2>/dev/null | grep -q 'active (running)'" 2>/dev/null; then
    ok "Hermes gateway is running"
    break
  fi
  if [[ $i -eq 15 ]]; then
    fail "Hermes gateway did not start within 30s"
  fi
  sleep 2
done

# ─── 7. Canary tests ────────────────────────────────────────────────────────
log "Running canary tests..."
ssh root@$REMOTE_HOST "python3 $REMOTE_DIR/tests/test_canary.py \
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
echo "  Hermes Workspace: http://collective.csdyn.com:3001"
echo "  Neo4j Browser:    http://collective.csdyn.com:7474"
echo "  Ollama:           http://ollama.csdyn.com:11434"
echo ""
