#!/bin/bash
# Installs the Omega group-chat watcher on this Mac (run it from this folder):
#   bash install.sh
# It copies the folder to ~/omega-imessage-watch, creates config.json if
# missing, and schedules an hourly run with launchd.
set -e

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/omega-imessage-watch"
PLIST="$HOME/Library/LaunchAgents/com.omega.imessagewatch.plist"

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Instalando as Ferramentas de Linha de Comando da Apple (necessárias para o Python)."
  echo "Uma janela vai abrir: clique em Instalar. Quando terminar, rode 'bash install.sh' de novo."
  xcode-select --install
  exit 0
fi

PY="$(python3 -c 'import os, sys; print(os.path.realpath(sys.executable))')"

mkdir -p "$DEST"
if [ "$SRC" != "$DEST" ]; then
  cp "$SRC/omega_imessage_watch.py" "$SRC/config.example.json" "$SRC/README.md" "$DEST/"
fi
if [ ! -f "$DEST/config.json" ]; then
  cp "$DEST/config.example.json" "$DEST/config.json"
  echo ">> Criei $DEST/config.json — abra e cole a senha (secret) antes de continuar."
fi

mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.omega.imessagewatch</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PY</string>
    <string>$DEST/omega_imessage_watch.py</string>
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DEST/watch.log</string>
  <key>StandardErrorPath</key><string>$DEST/watch.log</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo
echo "Instalado. Roda a cada hora; o registro fica em $DEST/watch.log"
echo
echo "FALTA dar 'Acesso Total ao Disco' para ESTE programa ler as mensagens:"
echo "  Preferências do Sistema > Segurança e Privacidade > Privacidade > Acesso Total ao Disco"
echo "  clique no cadeado, depois em '+', aperte Cmd+Shift+G e cole:"
echo "    $PY"
echo "  (para testar pelo Terminal, adicione também o app Terminal)"
