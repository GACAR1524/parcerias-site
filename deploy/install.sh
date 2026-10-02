#!/usr/bin/env bash
# Instalação em um servidor Ubuntu/Debian recém-criado (VPS). Roda como root.
#
#   curl -fsSL https://raw.githubusercontent.com/<usuario>/<repo>/main/deploy/install.sh | bash -s -- <dominio> <url-do-repositorio>
#
# Exemplo:
#   bash install.sh sistema.costadearaujo.com.br https://github.com/usuario/parcerias-site.git
#
# O que faz: instala Docker (se faltar), clona/atualiza o código em /opt/parcerias-site, gera o .env
# (segredo da sessão + domínio), sobe app + Caddy (HTTPS automático), agenda backup diário e
# atualização automática noturna (git pull → rebuild quando houver mudança), ativa firewall e
# atualizações de segurança do sistema.
set -euo pipefail

DOMAIN="${1:-}"; REPO="${2:-}"; BRANCH="${3:-main}"
DIR=/opt/parcerias-site
if [ -z "$DOMAIN" ] || [ -z "$REPO" ]; then echo "uso: install.sh <dominio> <url-do-repositorio> [branch]"; exit 1; fi
if [ "$(id -u)" -ne 0 ]; then echo "execute como root (sudo)"; exit 1; fi
export DEBIAN_FRONTEND=noninteractive

echo "==> Pacotes básicos"
apt-get update -qq
apt-get install -y -qq ca-certificates curl git ufw unattended-upgrades cron >/dev/null

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Instalando Docker"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || { echo "Docker Compose (plugin) não encontrado"; exit 1; }

echo "==> Código em $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" remote set-url origin "$REPO"
  git -C "$DIR" fetch -q origin "$BRANCH" && git -C "$DIR" reset -q --hard "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"

if [ ! -f .env ]; then
  echo "==> Gerando .env"
  SECRET=$(openssl rand -hex 48 2>/dev/null || head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')
  cat > .env <<EOF
PORT=3000
JWT_SECRET=$SECRET
SESSION_DAYS=30
COOKIE_SECURE=true
TRUST_PROXY=1
DOMAIN=$DOMAIN
EOF
  chmod 600 .env
else
  sed -i "s/^DOMAIN=.*/DOMAIN=$DOMAIN/" .env
fi
# a URL do repositório (pode conter token de acesso) fica só no git do servidor, legível apenas por root
chmod 700 "$DIR/.git"

echo "==> Firewall (22, 80, 443)"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "==> Subindo o sistema (primeira vez demora alguns minutos)"
docker compose up -d --build --remove-orphans

echo "==> Rotinas automáticas"
install -m 755 "$DIR/deploy/update.sh" /usr/local/bin/parcerias-update
cat > /etc/cron.d/parcerias <<EOF
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# backup diário do banco (fica no volume, em /data/backups; últimos 30 arquivos)
0 3 * * * root cd $DIR && docker compose exec -T app npm run backup >> /var/log/parcerias-backup.log 2>&1
# atualização automática: busca o código novo e reconstrói só quando houver mudança
30 4 * * * root /usr/local/bin/parcerias-update >> /var/log/parcerias-update.log 2>&1
EOF
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

IP=$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo
echo "================================================================"
echo " Instalado. Verifique o DNS: $DOMAIN  →  A  $IP"
echo " Assim que o DNS apontar, o Caddy emite o certificado e o sistema abre em https://$DOMAIN"
echo " Primeiro acesso: a tela de configuração inicial cria o login de controle geral."
echo " Comandos úteis: cd $DIR && docker compose ps | logs -f | parcerias-update"
echo "================================================================"
