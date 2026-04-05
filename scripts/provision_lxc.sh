#!/usr/bin/env bash
# provision_lxc.sh — Create collective.csdyn.com LXC on Proxmox
#
# Run from claude.csdyn.com after adding pve.csdyn.com to known_hosts.
# Requires SSH access to root@pve.csdyn.com.

set -euo pipefail

PVE_HOST="pve.csdyn.com"
CT_HOSTNAME="collective"
CT_FQDN="collective.csdyn.com"
CT_IP="192.168.0.x"        # SET THIS: next available IP on your LAN
CT_GW="192.168.0.1"        # SET THIS: your gateway
CT_ID=""                   # SET THIS: next available CT ID (check: pvesh get /nodes/pve/lxc)
CT_TEMPLATE=""             # SET THIS: template to use (check: pvesh get /nodes/pve/storage/local/content)
CT_STORAGE="local-lvm"     # SET THIS: storage pool name
CT_RAM=4096                # 4GB RAM
CT_CORES=4
CT_DISK=40                 # 40GB disk
CT_PASSWORD=""             # SET THIS: root password for new LXC

BLUE='\033[0;34m'; GREEN='\033[0;32m'; NC='\033[0m'
log() { echo -e "${BLUE}[provision]${NC} $1"; }
ok()  { echo -e "${GREEN}[ok]${NC} $1"; }

# Validate required vars
for var in CT_IP CT_GW CT_ID CT_TEMPLATE CT_PASSWORD; do
  val="${!var}"
  if [[ -z "$val" || "$val" == *"SET THIS"* || "$val" == "192.168.0.x" ]]; then
    echo "ERROR: $var is not set. Edit this script before running."
    exit 1
  fi
done

log "Creating LXC $CT_ID ($CT_FQDN) on $PVE_HOST..."

ssh root@$PVE_HOST bash <<ENDSSH
set -euo pipefail

# Create the LXC
pct create $CT_ID $CT_TEMPLATE \\
  --hostname $CT_HOSTNAME \\
  --cores $CT_CORES \\
  --memory $CT_RAM \\
  --swap 1024 \\
  --rootfs $CT_STORAGE:$CT_DISK \\
  --net0 name=eth0,bridge=vmbr0,ip=$CT_IP/24,gw=$CT_GW \\
  --nameserver 1.1.1.1 \\
  --searchdomain csdyn.com \\
  --password "$CT_PASSWORD" \\
  --unprivileged 1 \\
  --features nesting=1 \\
  --start 0

echo "[pve] LXC $CT_ID created"

# Start it
pct start $CT_ID
sleep 5
echo "[pve] LXC $CT_ID started"

# Bootstrap: update, install SSH, set hostname
pct exec $CT_ID -- bash -c "
  apt-get update -q &&
  apt-get install -y openssh-server curl wget gnupg python3 python3-pip git &&
  systemctl enable ssh &&
  systemctl start ssh &&
  echo '$CT_FQDN' > /etc/hostname &&
  hostname $CT_HOSTNAME
"
echo "[pve] LXC $CT_ID bootstrapped"
ENDSSH

ok "LXC $CT_ID ($CT_FQDN) created and running"

# Install our SSH key
log "Installing SSH key on $CT_FQDN..."
PUBKEY=$(cat ~/.ssh/id_ed25519.pub)
ssh root@$PVE_HOST "pct exec $CT_ID -- bash -c \"
  mkdir -p /root/.ssh && chmod 700 /root/.ssh &&
  echo '$PUBKEY' > /root/.ssh/authorized_keys &&
  chmod 600 /root/.ssh/authorized_keys
\""
ok "SSH key installed"

# Add to known_hosts from claude.csdyn.com
ssh-keyscan -H $CT_IP >> ~/.ssh/known_hosts 2>/dev/null
ssh-keyscan -H $CT_FQDN >> ~/.ssh/known_hosts 2>/dev/null
ok "Host keys added"

# Test connectivity
ssh root@$CT_FQDN "hostname && echo 'SSH working'"
ok "$CT_FQDN is reachable"

log "LXC provisioned. Next step: ./deploy.sh 'feat: initial collective deployment'"
