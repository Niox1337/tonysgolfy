# tonysgolfy Deployment

This deployment is designed for the case where VPS ports `80` and `443` are already occupied by VPN services.

Use:

- `cloudflared` to publish `tonysgolfy.niox.lol` without exposing local web ports
- `Caddy` only on `127.0.0.1:8080`
- `systemd` for the Rust backend
- frontend built to static files
- backend listening on `127.0.0.1:3000`

## 1. Domain setup

Recommended setup:

- move DNS for `niox.lol` to Cloudflare, or at least manage `tonysgolfy.niox.lol` through Cloudflare
- create a Cloudflare Tunnel and publish `tonysgolfy.niox.lol`

This avoids using local `80/443` at all.

## 2. Install runtime packages

Ubuntu example:

```bash
sudo apt update
sudo apt install -y curl git build-essential pkg-config libssl-dev python3 python3-pip caddy
```

Install Rust:

```bash
curl https://sh.rustup.rs -sSf | sh
source "$HOME/.cargo/env"
```

Install Node.js 22:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

Install Python packages used by semantic search:

```bash
python3 -m pip install --user -U sentence-transformers protobuf
```

Install `cloudflared`:

```bash
curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared
sudo install cloudflared /usr/local/bin/cloudflared
rm cloudflared
```

## 3. Copy project to server

```bash
sudo mkdir -p /srv/tonysgolfy
sudo chown "$USER":"$USER" /srv/tonysgolfy
git clone <your-repo-url> /srv/tonysgolfy
cd /srv/tonysgolfy
```

## 4. Build frontend

```bash
cd /srv/tonysgolfy/frontend
npm install
npm run build
```

## 5. Build backend

```bash
cd /srv/tonysgolfy/backend
cargo build --release
```

## 6. Warm the semantic model once

The first run downloads the multilingual embedding model used by semantic search.

```bash
cd /srv/tonysgolfy/backend
python3 python/semantic_search.py <<'EOF'
{"query":"海景球场","guides":[{"id":"1","courseName":"Cape Kidnappers","region":"Hawke’s Bay, New Zealand","courseCode":"NZ-HKB-CPK","greenFee":4200,"bestSeason":"November to March","notes":"悬崖海景极强，适合做高端目的地专题，建议自驾。","updatedAt":"2026-03-25T00:00:00Z"}]}
EOF
```

After that, the backend uses the cached local model.

## 7. Install backend service

Copy the systemd unit:

```bash
sudo cp /srv/tonysgolfy/deploy/tonysgolfy-backend.service /etc/systemd/system/tonysgolfy-backend.service
```

If your deployment user is not `www-data`, edit the unit before enabling it.

Then start it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tonysgolfy-backend
sudo systemctl status tonysgolfy-backend
```

## 8. Install Caddy config

This Caddy instance is local-only and does not bind public `80/443`.

Then:

```bash
sudo cp /srv/tonysgolfy/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy
```

## 9. Create Cloudflare Tunnel

Log in:

```bash
cloudflared tunnel login
```

Create the tunnel:

```bash
cloudflared tunnel create tonysgolfy
```

This will give you a tunnel ID and create a credentials JSON file.

Copy the config template:

```bash
sudo mkdir -p /etc/cloudflared
sudo cp /srv/tonysgolfy/deploy/cloudflared-config.yml /etc/cloudflared/config.yml
```

Then edit:

- replace `TONYSGOLFY_TUNNEL_ID` with the real tunnel ID
- make sure `credentials-file` points to the downloaded JSON credentials file

Create the hostname route:

```bash
cloudflared tunnel route dns tonysgolfy tonysgolfy.niox.lol
```

Install and start the tunnel service:

```bash
sudo cp /srv/tonysgolfy/deploy/cloudflared.service /etc/systemd/system/cloudflared.service
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflared
sudo systemctl status cloudflared
```

## 10. Verify

Check backend locally:

```bash
curl http://127.0.0.1:3000/api/health
```

Check local Caddy:

```bash
curl -I http://127.0.0.1:8080
curl http://127.0.0.1:8080/api/health
```

Check public site:

```bash
curl -I https://tonysgolfy.niox.lol
curl https://tonysgolfy.niox.lol/api/health
```

## 11. Updating later

```bash
cd /srv/tonysgolfy
git pull

cd /srv/tonysgolfy/frontend
npm install
npm run build

cd /srv/tonysgolfy/backend
cargo build --release

sudo systemctl restart tonysgolfy-backend
sudo systemctl reload caddy
sudo systemctl restart cloudflared
```
