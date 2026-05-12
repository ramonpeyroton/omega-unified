# Omegatron Voice POC

Standalone single-file HTML to test the wake-word + Groq parser pipeline
before buying any hardware. Validates: can a Chrome page running on the
office TV pick up "Omegatron, ..." reliably enough to drive the
dashboard via voice?

## Run

1. Open `voice-poc.html` in any text editor and paste your Groq API key
   at the top of the `<script>` block:

   ```js
   const GROQ_API_KEY = "gsk_yourKeyHere";
   ```

2. Open the file directly in **Chrome** or **Edge** (desktop). It works
   with `file:///` URLs but the browser may prompt for mic permission.
   For a stable test, serve it locally:

   ```bash
   python3 -m http.server 5500
   # then visit http://localhost:5500/voice-poc.html
   ```

3. Click **▶ Start Listening**. Allow mic access when the browser asks.

4. Wait until the badge shows 🟢 **LISTENING** (green pulse).

5. Speak naturally — start every command with one of the wake words:
   - "Omegatron"
   - "Omega tron" (two-word, common Alexa-style transcription)
   - "Ômega tron" (PT-BR accent variant)

## What you should see

| Badge | When |
|---|---|
| 🟢 LISTENING | Idle, waiting for a wake word |
| 🎤 WAKE WORD DETECTED | Heard the wake word, capturing rest of phrase |
| 💭 PARSING | Groq round-trip in flight |
| ✅ DONE | Intent shown |
| ❌ ERROR | Mic blocked, network down, or Groq error |

Below the badge: the live transcript (interim italic gray, final white),
the extracted command, the parsed JSON intent, and the parsing latency
in ms. The log keeps the last 10 detections with timestamp, command,
action/target, and confidence.

## 20 commands to test

Try these out loud after pressing **Start Listening**:

### Navigation

1. *"Omegatron, volta pro dashboard"*
2. *"Omegatron, abre a tela financeira"*
3. *"Omegatron, vai pro pipeline"*
4. *"Omegatron, mostra meus daily logs"*
5. *"Omegatron, abre o calendário"*

### Show document

6. *"Omegatron, mostra o estimate da Megan Flores"*
7. *"Omegatron, abre o contrato da Yulia"*
8. *"Omegatron, quero ver os recibos do job da Anna"*
9. *"Omegatron, mostra a última fatura do Robert"*
10. *"Omegatron, traz os documentos do Pierre"*

### Queries / metrics

11. *"Omegatron, quantos jobs ativos"*
12. *"Omegatron, qual o faturamento desse mês"*
13. *"Omegatron, qual o ticket médio"*
14. *"Omegatron, total pendente de recebimento"*
15. *"Omegatron, quantos estimates assinados hoje"*

### Edge cases

16. *"Omegatron, manda mensagem pro Gabriel"* — should land as `unknown`
    (we haven't taught it messaging yet)
17. *"Omegatron"* alone — too short, should hold for more words
18. *"Omegatron, omegatron, abre o dashboard"* — repeated wake word,
    cooldown should kick in
19. *"que horas são"* (no wake word) — should be ignored entirely
20. *"Omegatron, mostra o estimate da Megan Flores"* spoken twice within
    2 seconds — anti-echo should suppress the second hit

## Test mode

If your environment is noisy or the mic isn't great, scroll down to
**Test Mode** — type any phrase (with or without a wake word) and hit
**Parse this**. Skips the speech engine entirely.

## Known quirks (real-world findings)

- **Web Speech stops on long silence.** We auto-restart on `onend`.
  Watch the "Restarts" counter — anything under ~5 per minute is normal.
- **Mobile Chrome works but laggier.** Interim results arrive in bigger
  chunks; you'll feel +300ms before the wake word triggers.
- **First mic permission asks every time** when running off `file://`.
  Serve via localhost for repeat sessions.
- **The wake word match is fuzzy** (accent-stripped, lowercase). Alexa
  often transcribes "Omegatron" as "Omega tron" — both are in WAKE_WORDS.
- **No streaming output.** The full Groq response arrives at once
  because we use `response_format: json_object`. Latency shown is
  end-to-end POST time.

## What we're learning here

This POC answers four questions before spending money on hardware:

1. **Does Chrome's Web Speech API hear the wake word reliably from
   across the room?** (Tune mic gain, see how miss rate behaves.)
2. **Does Llama 3.3 70B return correct intents fast enough?** (Watch
   the latency badge. < 600ms feels instant; > 1.5s feels broken.)
3. **Is the wake word "Omegatron" distinct enough to avoid false
   positives?** (Leave it running for 20 minutes while you work and
   count accidental hits.)
4. **Does the room ambient noise (HVAC, conversation, music) trash the
   transcript?** (Run during the busiest office hour.)

If all four pass, we move on to a permanent hardware setup. If any
fails, we either tweak (different wake word, better mic, different
model) or pivot (Alexa-skill, dedicated Picovoice porcupine wake-word
on a Pi).

## Files

- `voice-poc.html` — the entire POC, one file, no build.
- `voice-poc-README.md` — this document.

No npm install, no bundler, no framework. Just open and speak.
