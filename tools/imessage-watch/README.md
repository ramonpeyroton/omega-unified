# Vigia dos grupos de clientes (MacBook do Inácio)

Roda de hora em hora no MacBook do escritório, logado no iCloud do Inácio. Lê as
mensagens do próprio Mac, olha **só os grupos que têm um cliente cadastrado no
app** e avisa no WhatsApp quando um cliente escreveu e ninguém da equipe
respondeu:

- **De hora em hora**, quem foi perguntado recebe um lembrete, dentro do horário
  de trabalho. Quem foi perguntado: o nome citado na mensagem; se não houver,
  quem da equipe falou por último no grupo; se ninguém falou, o Inácio.
- **Às 17h**, o que ainda estiver sem resposta vai para o Inácio.
- Agradecimento/confirmação não conta como pergunta: "ok", "Awesome, thank you
  Attila!", "Perfect thanks so much 🙏", "valeu, obrigado", só emoji, reações
  do cliente. Mensagem com "?" sempre conta.
- **Reação do time encerra:** um 👍 ❤️ 😂 ‼️ (ou reação com emoji) de alguém da
  equipe na conversa = tudo antes dela está respondido. A reação ❓ não conta.
- O primeiro aviso só sai depois de 1 hora sem resposta.

Conversas pessoais nunca saem do Mac. Só vai para o app a mensagem do cliente
que está sem resposta (texto, horário, nome do grupo).

## Instalação (uma vez, uns 20 minutos)

1. **Senha de conexão.** No Vercel, projeto `omega-unified` → Settings →
   Environment Variables, crie `IMESSAGE_WATCH_SECRET` (Production) com um
   valor longo e aleatório, e faça um Redeploy.
2. **Copie esta pasta** (`tools/imessage-watch`) para o Mac, por exemplo por
   AirDrop ou pen drive.
3. No Mac, abra o **Terminal**, entre na pasta e rode `bash install.sh`.
   - Se pedir para instalar as "Ferramentas de Linha de Comando", clique em
     Instalar e rode `bash install.sh` de novo no fim.
4. Abra `~/omega-imessage-watch/config.json` e cole a mesma senha do passo 1 em
   `secret`.
5. **Acesso Total ao Disco:** em Preferências do Sistema → Segurança e
   Privacidade → Privacidade → Acesso Total ao Disco, adicione o caminho do
   Python que o instalador mostrou e o app Terminal.
6. **Mac sem dormir:** em Preferências do Sistema → Bateria → Adaptador de
   Energia, marque "Impedir que o computador entre em repouso automaticamente
   quando a tela estiver desligada". Deixe o Mac na tomada e logado.
7. **Grupos verdes:** no iPhone do Inácio, em Ajustes → Mensagens →
   Encaminhamento de Mensagens de Texto, deixe este MacBook ligado.

## Testar

```bash
cd ~/omega-imessage-watch
python3 omega_imessage_watch.py --list      # grupos de clientes e quem é quem
python3 omega_imessage_watch.py --dry-run   # o que SERIA enviado, sem enviar
python3 omega_imessage_watch.py --unmatched # grupos ativos que NÃO têm cliente do app
```

No `--list`, cada participante aparece como `TEAM <nome>`, `CLIENT` ou
`other`. Se alguém da equipe aparecer como `other` (usa iMessage com email),
acrescente em `team_handles` no `config.json`, por exemplo:
`"team_handles": { "attila@icloud.com": "attila" }`.

O registro de cada execução fica em `~/omega-imessage-watch/watch.log`. Se o
Mac parar de checar por mais de 3 horas num dia útil, o Ramon recebe um aviso
no WhatsApp.

## Atualizar (quando o script muda)

No Terminal do Mac, um comando só (baixa a versão nova do GitHub; o
`config.json` e o agendamento continuam como estão):

```bash
curl -fsSL https://raw.githubusercontent.com/ramonpeyroton/omega-unified/main/tools/imessage-watch/omega_imessage_watch.py -o ~/omega-imessage-watch/omega_imessage_watch.py && python3 ~/omega-imessage-watch/omega_imessage_watch.py --test-acks
```

O `--test-acks` mostra quais frases contam como "não precisa responder" — tem
que terminar com "as expected". A próxima checagem (de hora em hora) já usa a
versão nova.

## Desligar

```bash
launchctl unload ~/Library/LaunchAgents/com.omega.imessagewatch.plist
```
