#!/usr/bin/env bash
# =============================================================================
# Setup otomatis Tetra WA Bot di server Ubuntu (Oracle Cloud).
# Idempotent: aman dijalankan berulang kali.
# Dijalankan oleh Claude via SSH dari Mac — user non-technical tidak perlu paham isinya.
# =============================================================================
set -euo pipefail

# Pindah ke folder project (PARENT dari folder deploy/ tempat script ini berada).
cd "$(cd "$(dirname "$0")/.." && pwd)"
PROJECT_DIR="$(pwd)"
echo "==> Project dir: $PROJECT_DIR"

# 1) Pastikan Node.js 20 terpasang (NodeSource → node sistem di /usr/bin, rapi untuk pm2).
if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 18 ]; then
  echo "==> Memasang Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "==> Node.js sudah ada: $(node -v)"
fi

# 2) Install dependency project.
echo "==> npm install..."
npm install --omit=dev --no-audit --no-fund

# 3) Pastikan pm2 (process manager, bikin bot nyala 24/7 & auto-restart).
if ! command -v pm2 >/dev/null 2>&1; then
  echo "==> Memasang pm2..."
  sudo npm install -g pm2
else
  echo "==> pm2 sudah ada: $(pm2 -v)"
fi

# 4) (Re)start bot lewat pm2.
echo "==> Menjalankan bot via pm2..."
pm2 delete tetra-bot >/dev/null 2>&1 || true
pm2 start index.js --name tetra-bot --time
pm2 save

# 5) Daftarkan pm2 ke systemd → bot otomatis nyala lagi kalau server reboot.
echo "==> Mendaftarkan auto-start saat reboot..."
NODE_BIN_DIR="$(dirname "$(command -v node)")"
sudo env PATH="$PATH:$NODE_BIN_DIR" "$(command -v pm2)" startup systemd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true
pm2 save

echo ""
echo "============================================================"
echo "✅ SELESAI. Status bot:"
pm2 status tetra-bot || true
echo "============================================================"
echo "Lihat log realtime: pm2 logs tetra-bot"
