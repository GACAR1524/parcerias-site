#!/usr/bin/env bash
# Atualiza o sistema a partir do repositório: só reconstrói quando houver código novo.
#   parcerias-update            (instalado pelo install.sh; roda também no cron, de madrugada)
#   parcerias-update --force    (reconstrói mesmo sem mudança)
set -euo pipefail
DIR=/opt/parcerias-site
cd "$DIR"
BRANCH=$(git rev-parse --abbrev-ref HEAD)
BEFORE=$(git rev-parse HEAD)
git fetch -q origin "$BRANCH"
AFTER=$(git rev-parse "origin/$BRANCH")
if [ "$BEFORE" = "$AFTER" ] && [ "${1:-}" != "--force" ]; then
  echo "$(date -Is) sem mudanças ($BEFORE)"; exit 0
fi
# backup antes de atualizar
docker compose exec -T app npm run backup >/dev/null 2>&1 || true
git reset -q --hard "origin/$BRANCH"
docker compose up -d --build --remove-orphans
docker image prune -f >/dev/null 2>&1 || true
echo "$(date -Is) atualizado: $BEFORE → $AFTER"
