# VPS Deployment Guide: Tawf Zakat Protocol

Panduan resmi deployment aplikasi **Tawf Zakat Protocol** ke server Linux VPS (Ubuntu / Debian) dengan dukungan WebSocket real-time dan reverse proxy Nginx.

---

## 🛠️ Opsi 1: Deployment via Docker Compose (Rekomendasi Cepat)

### 1. Prasyarat di VPS:
```bash
sudo apt update && sudo apt install -y docker.io docker-compose git nginx certbot python3-certbot-nginx
```

### 2. Clone Repositori & Siapkan Environment:
```bash
git clone https://github.com/tawf-labs/zkt-hackathon.git /var/www/tawf-zakat
cd /var/www/tawf-zakat
cp backend/.env.example .env
# Edit .env dan masukkan DATABASE_URL, PRIVATE_KEY, PINATA_JWT, MIDTRANS keys
nano .env
```

### 3. Jalankan Container:
```bash
docker-compose up -d --build
```
Cek status service:
```bash
docker-compose ps
docker-compose logs -f backend
```

---

## ⚡ Opsi 2: Deployment Langsung via Bun & Systemd

### 1. Install Bun di VPS:
```bash
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

### 2. Install Dependencies & Build:
```bash
cd /var/www/tawf-zakat
bun install

# Build frontend
cd frontend
bun run build
cd ..
```

### 3. Buat Systemd Service untuk Backend:
`/etc/systemd/system/tawf-backend.service`:
```ini
[Unit]
Description=Tawf Zakat Backend API & WebSocket Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tawf-zakat/backend
ExecStart=/root/.bun/bin/bun run src/index.ts
Restart=always
RestartSec=3
EnvironmentFile=/var/www/tawf-zakat/backend/.env

[Install]
WantedBy=multi-user.target
```

### 4. Buat Systemd Service untuk Frontend:
`/etc/systemd/system/tawf-frontend.service`:
```ini
[Unit]
Description=Tawf Zakat Frontend Application
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/tawf-zakat/frontend
ExecStart=/root/.bun/bin/bun run .output/server/index.mjs
Restart=always
RestartSec=3
Environment=PORT=3000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

### 5. Start & Enable Services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now tawf-backend
sudo systemctl enable --now tawf-frontend
```

---

## 🌐 Konfigurasi Reverse Proxy Nginx & SSL (WSS)

### 1. Salin Konfigurasi Nginx:
```bash
sudo cp /var/www/tawf-zakat/deploy/nginx.conf /etc/nginx/sites-available/tawf-zakat
sudo ln -s /etc/nginx/sites-available/tawf-zakat /etc/nginx/sites-enabled/
```
Edit nama domain di `/etc/nginx/sites-available/tawf-zakat`:
```nginx
server_name zakat.yourdomain.com;
```

### 2. Uji & Restart Nginx:
```bash
sudo nginx -t
sudo systemctl restart nginx
```

### 3. Pasang SSL Gratis (Let's Encrypt / Certbot):
```bash
sudo certbot --nginx -d zakat.yourdomain.com
```
Certbot akan secara otomatis mengonfigurasi sertifikat SSL HTTPS dan enkripsi WSS (`wss://zakat.yourdomain.com/ws`).

---

## 🔍 Verifikasi Kesehatan Layanan
- **REST API Status**: `https://zakat.yourdomain.com/api/indexer/status`
- **Real-Time WebSocket**: Buka website di browser dan pastikan badge `LIVE` berwarna hijau di navbar.
- **On-Chain Log Stream**: `https://zakat.yourdomain.com/api/events`
