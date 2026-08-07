# Deploy: AI Software Factory control panel

Target: satu server di Tailscale mesh yang bisa jangkau PostgreSQL yang mau kamu
reuse, dan sudah punya Docker + Apache + Certbot (pola sama seperti setup
n8n.nanjarbudiman.com kamu). Ganti hostname/domain sesuai kebutuhan.

Blast radius: dua container baru (`asf-backend`, `asf-frontend`) di server
target, dua site config Apache baru, dan satu database baru
(`ai_software_factory`) di instance PostgreSQL yang sudah ada. Tidak
menyentuh service lain.

## 1. Siapkan database

Di server PostgreSQL yang mau di-reuse:

```bash
sudo -u postgres psql -c "CREATE DATABASE ai_software_factory;"
sudo -u postgres psql -c "CREATE USER aisf_app WITH ENCRYPTED PASSWORD '!Budi123!!';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ai_software_factory TO aisf_app;"
```

Catat Tailscale hostname server DB itu (mis. `kuring`) — dipakai di
`DATABASE_URL` backend.

## 2. Upload & konfigurasi

```bash
# di server target (via Tailscale SSH)
mkdir -p ~/apps/ai-software-factory
cd ~/apps/ai-software-factory
# upload/scp isi project ini ke sini

cp backend/.env.example backend/.env
cp .env.example .env
```

Edit `backend/.env`:
- `DATABASE_URL` → `postgresql://asf_app:GANTI_PASSWORD_INI@kuring:5432/ai_software_factory?schema=public`
- `JWT_SECRET` → generate baru: `openssl rand -hex 32`
- `ADMIN_EMAIL` / `ADMIN_PASSWORD` → login pertama kamu
- `N8N_START_WEBHOOK_URL` → `https://theworkflow.nanjarbudiman.com/webhook/ai-software-factory/start`
- `N8N_WEBHOOK_SECRET` → generate baru: `openssl rand -hex 24` — **pakai nilai
  yang sama** di 8 node "Notify: ..." pada workflow n8n (header `X-Webhook-Secret`)
- `FRONTEND_ORIGIN` → `https://asf.nanjarbudiman.com`

Edit root `.env`:
- `NEXT_PUBLIC_API_URL` → `https://asf-api.nanjarbudiman.com`

Balik ke n8n: buka 8 node "Notify: ..." di workflow, isi `url`-nya ke
`https://asf-api.nanjarbudiman.com/webhooks/n8n/stage-ready` (atau
`/workflow-completed` untuk node terakhir), dan `X-Webhook-Secret` ke nilai
yang sama dengan `N8N_WEBHOOK_SECRET` di atas.

## 3. Migrasi schema database

```bash
cd backend
npm install
npx prisma migrate deploy
cd ..
```

(`npm install` lokal cuma buat generate migration files kalau belum ada —
kalau sudah ada folder `prisma/migrations` dari development, langsung
`prisma migrate deploy` saja tanpa perlu `migrate dev`.)

Kalau ini migrasi pertama kali dan belum ada folder `prisma/migrations`,
generate dulu di lokal/dev sebelum deploy ke production:

```bash
npx prisma migrate dev --name init
```

## 4. Build & jalankan

```bash
docker compose up -d --build
docker compose ps        # pastikan asf-backend & asf-frontend "Up"
docker compose logs -f backend   # cek log kalau ada error koneksi DB/n8n
```

## 5. Reverse proxy + SSL

```bash
sudo cp deploy/apache-vhosts.conf /etc/apache2/sites-available/asf-temp.conf
# lalu split jadi dua file sesuai komentar di dalamnya, atau langsung:
sudo a2ensite asf-api.nanjarbudiman.com asf.nanjarbudiman.com
sudo systemctl reload apache2
sudo certbot --apache -d asf-api.nanjarbudiman.com -d asf.nanjarbudiman.com
```

Pastikan DNS `asf.nanjarbudiman.com` dan `asf-api.nanjarbudiman.com` sudah
diarahkan ke IP publik server ini sebelum menjalankan certbot.

## 6. Verifikasi end-to-end

1. Buka `https://asf.nanjarbudiman.com/login`, masuk pakai `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
2. Buat project baru → cek di n8n Executions, harusnya muncul eksekusi baru
   berstatus Waiting setelah PRD selesai digenerate.
3. Cek project detail di app — kartu PRD harus muncul isi + tombol Setujui/Tolak.
4. Klik Setujui sekali → cek n8n lanjut ke Software Architect Agent.

## Update selanjutnya

```bash
cd ~/apps/ai-software-factory
git pull   # atau upload ulang file yang berubah
docker compose up -d --build
```
