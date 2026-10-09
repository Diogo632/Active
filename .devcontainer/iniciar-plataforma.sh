#!/usr/bin/env bash
# Inicia a Base de Conhecimento em segundo plano sempre que o Codespace abre (postStartCommand).
# Fica rodando mesmo depois que este script termina; o log vai para servidor.log.
cd "$(dirname "$0")/.." || exit 0
export PORT="${PORT:-3001}"
if pgrep -f "node server/index.js" > /dev/null; then
  echo "A plataforma já está rodando (porta $PORT)."
  exit 0
fi
# Dependências faltando (ex.: Codespace criado antes de uma atualização): instala antes de iniciar.
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Instalando dependências (npm ci)…"
  npm ci --no-audit --no-fund >> servidor.log 2>&1
fi
setsid nohup node server/index.js >> servidor.log 2>&1 < /dev/null &
echo "Plataforma iniciada na porta $PORT (log: servidor.log)."
