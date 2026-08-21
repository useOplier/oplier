#!/usr/bin/env bash
# Oplier per-push deploy on the EC2 box. Invoked by .github/workflows/deploy-ec2.yml (or by hand).
#   bash /opt/oplier/deploy/ec2-deploy.sh
set -euo pipefail

APP_DIR="/opt/oplier"
cd "$APP_DIR"

echo "==> pull"
sudo -u oplier git fetch origin main
sudo -u oplier git reset --hard origin/main

echo "==> install deps (if lockfile changed)"
sudo -u oplier pnpm install --frozen-lockfile

echo "==> migrate"
sudo -u oplier pnpm --filter @oplier/db run migrate

echo "==> restart services"
systemctl restart oplier-api oplier-worker

sleep 3
systemctl is-active oplier-api oplier-worker
curl -fsS http://127.0.0.1:3001/health >/dev/null && echo "API healthy" || echo "WARN: API health check failed — check journalctl -u oplier-api"
echo "deploy done: $(git -C $APP_DIR log --oneline -1)"