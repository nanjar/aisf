FROM node:20-slim AS builder
WORKDIR /app
RUN apt-get update -y && apt-get install -y openssl python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
# V1.3 Fase 3: docker.sock sudah di-mount di docker-compose.yml sejak V1.2
# (§11.3), tapi CLI-nya sendiri tidak pernah diinstall di image ini — root
# cause insiden production (docker-exec.util.ts spawn('docker',...) gagal
# ENOENT, unhandled 'error' event crash seluruh proses backend, lihat fix
# di docker-exec.util.ts). docker.io dari repo Debian default, cukup CLI-nya
# saja yang dipakai (dockerd tidak pernah dijalankan, kita cuma bicara ke
# daemon host lewat socket yang di-mount).
RUN apt-get update -y && apt-get install -y openssl python3 make g++ docker.io && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev
RUN npx prisma generate
COPY --from=builder /app/dist ./dist
EXPOSE 6001
CMD ["node", "dist/main.js"]
