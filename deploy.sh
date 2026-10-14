#!/usr/bin/env bash
#
# Script de deploy do Contribua.
# Roda no servidor e é chamado pelo GitHub Actions (ou manualmente).
#
# Uso:
#   ./deploy.sh
#
# Variáveis opcionais:
#   APP_DIR   diretório da aplicação (padrão: diretório deste script)
#   BRANCH    branch a ser publicado (padrão: main)
#
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")" && pwd)}"
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"
echo "==> Deploy Contribua em $APP_DIR (branch $BRANCH)"

# 1. Atualiza o código
if [ -d .git ]; then
  echo "==> Baixando a versão mais recente"
  git fetch --all --prune
  git checkout "$BRANCH"
  git reset --hard "origin/$BRANCH"
else
  echo "==> (aviso) não é um repositório git; pulando o git pull"
fi

# 2. Dependências de produção
echo "==> Instalando dependências"
npm ci --omit=dev

# 3. Migrações do banco (o Postgres é externo ao docker-compose)
echo "==> Aplicando migrações"
npm run migrate

# 4. (Re)sobe a aplicação com PM2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 não encontrado. Instale com: npm install -g pm2" >&2
  exit 1
fi

echo "==> Reiniciando com PM2"
pm2 startOrReload ecosystem.config.cjs --env production
pm2 save

echo "==> Deploy concluído com sucesso"
