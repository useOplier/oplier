#!/usr/bin/env bash
# Oplier EC2 one-time bootstrap. Run AS the sudo-capable user on a fresh Ubuntu 22.04/24.04 box.
#   bash deploy/ec2-setup.sh
# Idempotent: safe to re-run.
set -euo pipefail

REPO_URL="https://github.com/useOplier/oplier.git"
APP_DIR="/opt/oplier"

echo "==> 1/7 Base packages (node 22, pnpm, postgres, nginx, git)"
apt-get update -y
apt-get install -y curl ca-certificates git nginx postgresql postgresql-contrib
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pnpm@9

echo "==> 2/7 Service user + repo clone"
id -u oplier >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash oplier
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u oplier git clone "$REPO_URL" "$APP_DIR"
fi
sudo -u oplier git -C "$APP_DIR" pull --ff-only || true

echo "==> 3/7 Postgres: db + role (password printed once — put it in the .env files)"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='oplier'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE oplier LOGIN PASSWORD '$(openssl rand -hex 24)';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='oplier'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE oplier OWNER oplier;"
sudo -u postgres psql -c "SELECT rolname, rolpassword IS NOT NULL AS has_pw FROM pg_authid WHERE rolname='oplier';" >/dev/null

echo "==> 4/7 Install dependencies + run migrations"
cd "$APP_DIR"
sudo -u oplier pnpm install --frozen-lockfile
# Migrations read DATABASE_URL from packages/db/.env — create it from the API env if absent.
if [ ! -f packages/db/.env ]; then
  echo "DATABASE_URL=postgresql://oplier:CHANGE_ME@localhost:5432/oplier" > packages/db/.env
fi

echo "==> 5/7 Env files (EDIT SECRETS BEFORE STARTING SERVICES)"
for f in apps/api/.env apps/worker/.env; do
  if [ ! -f "$f" ]; then cp "${f}.example" "$f"; fi
done
chown oplier:oplier apps/api/.env apps/worker/.env packages/db/.env
chmod 600 apps/api/.env apps/worker/.env packages/db/.env

echo "==> 6/7 systemd units"
cp apps/worker/deploy/oplier-api.service /etc/systemd/system/
cp apps/worker/deploy/oplier-worker.service /etc/systemd/system/
systemctl daemon-reload

echo "==> 7/7 nginx reverse proxy for the API (:80 -> :3001)"
cat >/etc/nginx/sites-available/oplier <<'NGINX'
server {
    listen 80 default_server;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/oplier /etc/nginx/sites-enabled/oplier
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

cat <<'DONE'

Bootstrap complete. REMAINING MANUAL STEPS:
  1. Set the real DB password in ALL THREE files:
       sudo nano /opt/oplier/packages/db/.env      (DATABASE_URL)
       sudo nano /opt/oplier/apps/api/.env         (DATABASE_URL + all keys — see .env.example comments)
       sudo nano /opt/oplier/apps/worker/.env      (DATABASE_URL + ALCHEMY_API_KEY etc.)
     Get the generated role password:  sudo -u postgres psql -c "SELECT rolpassword FROM pg_authid WHERE rolname='oplier';"
     (or just reset it: sudo -u postgres psql -c "ALTER ROLE oplier PASSWORD 'yourpass';")
  2. Run migrations + seed:
       cd /opt/oplier && sudo -u oplier pnpm --filter @oplier/db run migrate && sudo -u oplier pnpm --filter @oplier/db run seed
  3. Start services:
       sudo systemctl enable --now oplier-api oplier-worker
  4. Verify:  curl http://localhost/health   and   journalctl -u oplier-api -f
DONE