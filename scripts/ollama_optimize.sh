#!/usr/bin/env bash
# ollama_optimize.sh — Pull new models and update Ollama service config
#
# Pulls: hermes2pro, qwen2.5-coder:14b, nomic-embed-text
# Updates: MAX_LOADED_MODELS=4, KEEP_ALIVE=2h, SCHED_SPREAD=true
# Updates: ai-trader config to use hermes2pro
#
# Run once during initial collective setup.

set -euo pipefail

OLLAMA_HOST="ollama.csdyn.com"
AI_TRADER_HOST="ai-trader.csdyn.com"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${BLUE}[ollama]${NC} $1"; }
ok()   { echo -e "${GREEN}[ok]${NC} $1"; }
fail() { echo -e "${RED}[fail]${NC} $1"; exit 1; }

# ── 1. Pull models on ollama.csdyn.com ───────────────────────────────────────
log "Pulling hermes2pro..."
ssh root@$OLLAMA_HOST "ollama pull hermes2pro"
ok "hermes2pro ready"

log "Pulling qwen2.5-coder:14b (8.5GB — this will take a while)..."
ssh root@$OLLAMA_HOST "ollama pull qwen2.5-coder:14b"
ok "qwen2.5-coder:14b ready"

log "Pulling nomic-embed-text..."
ssh root@$OLLAMA_HOST "ollama pull nomic-embed-text"
ok "nomic-embed-text ready"

# ── 2. Update Ollama service config ─────────────────────────────────────────
log "Updating Ollama service override.conf..."
ssh root@$OLLAMA_HOST bash <<'ENDSSH'
cat > /etc/systemd/system/ollama.service.d/override.conf <<EOF
[Service]
Environment="OLLAMA_MODELS=/var/lib/models/"
Environment="OLLAMA_MAX_VRAM=64424509440"
Environment="OLLAMA_MAX_LOADED_MODELS=4"
Environment="OLLAMA_NUM_PARALLEL=2"
Environment="OLLAMA_GPU_OVERHEAD=0"
Environment="OLLAMA_FLASH_ATTENTION=1"
Environment="OLLAMA_KEEP_ALIVE=2h"
Environment="OLLAMA_SCHED_SPREAD=true"
EOF
systemctl daemon-reload
systemctl restart ollama
echo "[remote] Ollama service restarted with new config"
ENDSSH
ok "Ollama service config updated"

# Wait for Ollama to come back
log "Waiting for Ollama to come back online..."
for i in $(seq 1 20); do
  if ssh root@$OLLAMA_HOST "curl -sf http://localhost:11434/api/tags > /dev/null" 2>/dev/null; then
    ok "Ollama is up"
    break
  fi
  [[ $i -eq 20 ]] && fail "Ollama did not restart in time"
  sleep 3
done

# ── 3. Verify GPU loading with hermes2pro ────────────────────────────────────
log "Verifying hermes2pro loads on GPU..."
ssh root@$OLLAMA_HOST bash <<'ENDSSH'
# Trigger a load
curl -sf -X POST http://localhost:11434/api/chat \
  -d '{"model":"hermes2pro","messages":[{"role":"user","content":"ping"}],"stream":false,"options":{"num_predict":3}}' \
  > /dev/null
sleep 2
# Check GPU utilization
nvidia-smi --query-gpu=index,memory.used --format=csv,noheader
echo "---"
curl -sf http://localhost:11434/api/ps | python3 -c "
import sys, json
ps = json.load(sys.stdin)
for m in ps.get('models', []):
    print(f\"Loaded: {m['name']} | processor: {m.get('details',{}).get('processor','?')} | size: {m.get('size_vram',0)//1024//1024}MB VRAM\")
"
ENDSSH
ok "GPU verification complete"

# ── 4. Update ai-trader config → hermes2pro ──────────────────────────────────
log "Updating ai-trader model config..."
ssh root@$AI_TRADER_HOST bash <<'ENDSSH'
CONFIG="/opt/trading_desk/config.json"
python3 - <<'PYEOF'
import json

with open('/opt/trading_desk/config.json', 'r') as f:
    config = json.load(f)

old_model = config['GENERAL'].get('OLLAMA_MODEL', 'unknown')

# Update both GENERAL and any nested FEED_CONFIGS
config['GENERAL']['OLLAMA_MODEL'] = 'hermes2pro'

# Update any feed-level model overrides if present
for feed_key, feed_val in config.get('FEED_CONFIGS', {}).items():
    if isinstance(feed_val, dict) and 'OLLAMA_MODEL' in feed_val:
        feed_val['OLLAMA_MODEL'] = 'hermes2pro'

with open('/opt/trading_desk/config.json', 'w') as f:
    json.dump(config, f, indent=2)

print(f"[ai-trader] Model updated: {old_model} → hermes2pro")
PYEOF
ENDSSH
ok "ai-trader config updated to hermes2pro"

# ── 5. Restart ai-trader and run canary ─────────────────────────────────────
log "Restarting ai-trader services..."
ssh root@$AI_TRADER_HOST "systemctl restart ai-trader-api.service ai-trader-scheduler.service"

log "Waiting for ai-trader API..."
for i in $(seq 1 20); do
  if ssh root@$AI_TRADER_HOST "curl -sf http://localhost:8000/api/health > /dev/null" 2>/dev/null; then
    ok "ai-trader API is up"
    break
  fi
  [[ $i -eq 20 ]] && fail "ai-trader did not restart in time"
  sleep 3
done

log "Running ai-trader canary tests..."
ssh root@$AI_TRADER_HOST "cd /opt/trading_desk && source venv/bin/activate && python3 src/tests/test_canary.py --api-base http://localhost:8000"
ok "ai-trader canary passed"

# ── 6. Final GPU utilization summary ─────────────────────────────────────────
echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}  Ollama GPU Cluster — Current Status  ${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
ssh root@$OLLAMA_HOST bash <<'ENDSSH'
echo "GPU VRAM Usage:"
nvidia-smi --query-gpu=index,name,memory.used,memory.free,utilization.gpu --format=csv,noheader
echo ""
echo "Loaded Models:"
curl -sf http://localhost:11434/api/ps | python3 -c "
import sys, json
ps = json.load(sys.stdin)
if not ps.get('models'):
    print('  (none currently loaded — models load on demand)')
else:
    for m in ps['models']:
        vram_mb = m.get('size_vram', 0) // 1024 // 1024
        print(f\"  {m['name']}: {vram_mb}MB VRAM\")
"
echo ""
echo "Available Models:"
curl -sf http://localhost:11434/api/tags | python3 -c "
import sys, json
tags = json.load(sys.stdin)
for m in tags.get('models', []):
    size_gb = m.get('size', 0) / 1024 / 1024 / 1024
    print(f\"  {m['name']}: {size_gb:.1f}GB\")
"
ENDSSH
