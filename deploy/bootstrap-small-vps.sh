#!/usr/bin/env bash
# Run as root on a new, dedicated Ubuntu 24.04 VPS after SSH key provisioning.
# This configures the host only. It does not build or publish the application.
set -euo pipefail
if [[ $EUID -ne 0 ]]; then
  echo "Run as root on the new Sayboard VPS." >&2
  exit 1
fi
# shellcheck source=/dev/null
. /etc/os-release
if [[ $ID != ubuntu || $VERSION_ID != 24.04 ]]; then
  echo "This bootstrap supports Ubuntu 24.04 only." >&2
  exit 1
fi
umask 077
if ! swapon --show=NAME --noheadings | grep -Fxq /swapfile; then
  if [[ ! -e /swapfile ]]; then
    fallocate -l 1G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
fi
if ! grep -Eq '^/swapfile[[:space:]]' /etc/fstab; then
  printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
fi
printf 'vm.swappiness=10\n' > /etc/sysctl.d/60-sayboard-memory.conf
sysctl --system >/dev/null
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends docker.io docker-compose-v2 ufw ca-certificates unattended-upgrades
systemctl enable --now docker
mkdir -p /etc/docker
if [[ ! -e /etc/docker/daemon.json ]]; then
  printf '{"log-driver":"json-file","log-opts":{"max-size":"5m","max-file":"2"}}\n' > /etc/docker/daemon.json
  systemctl restart docker
fi
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
install -d -m 700 /srv/sayboard /srv/sayboard/backups /srv/sayboard/releases
# Ubuntu installs unattended-upgrades; explicitly retain automatic security updates.
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > /etc/ssh/sshd_config.d/00-sayboard-key-only.conf
sshd -t
systemctl reload ssh
echo "Host prepared. Deploy a prebuilt image and verify it before enabling accounts."
