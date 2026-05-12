// ════════════════════════════════════════════════════════════════════
// Groq chat client (OpenAI-compatible, direct fetch — no SDK).
// Exports:
//   chatWithGroq(messages)
//   chatWithGroqTools(messages, tools, toolImpls, ctx)
// ════════════════════════════════════════════════════════════════════

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
const MAX_TOOL_ITERATIONS = 5;

function apiKey() {
  return import.meta.env.VITE_GROQ_API_KEY;
}

async function callGroq(body) {
  const key = apiKey();
  if (!key) throw new Error('Missing VITE_GROQ_API_KEY — set it in Vercel or .env.local.');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Groq API ${res.status}: ${text.slice(0, 240)}`);
  }
  return res.json();
}

// ─── Voice intent parser ─────────────────────────────────────────
// Used by the Screen role's ambient voice assistant. Takes a free-text
// command (typically pt-BR transcribed by Chrome's Web Speech API) and
// returns a structured intent we can dispatch into the app. The system
// prompt teaches the model our vocabulary so the same query works in
// either Portuguese ("orçamento da Yulia") or English-as-heard-by-pt-BR
// ("smate da yulia").
const VOICE_INTENT_SYSTEM_PROMPT = `Você é um parser de comandos de voz do Omega Unified, app de gestão de construção. Recebe frase em português brasileiro (fala natural, com erros de transcrição) e retorna APENAS JSON válido (sem markdown, sem explicação) com a intenção.

Schema:
{
  "action": "navigate" | "show_document" | "query" | "unknown",
  "target": string | null,
  "filter": object | null,
  "raw_query": string,
  "confidence": "high" | "medium" | "low"
}

VOCABULÁRIO — mapeia inputs (PT-BR ou inglês mal-transcrito) para targets canônicos em inglês:
- "orçamento", "orcamento", "estimate", "estima", "smate" → target="estimate"
- "contrato", "contract", "contracto" → target="contract"
- "fatura", "invoice", "boleto", "cobrança", "nota" → target="invoice"
- "recibo", "receipt" → target="receipt"
- "dashboard", "painel", "home" → target="dashboard"
- "pipeline", "kanban", "funil" → target="pipeline"
- "calendário", "agenda", "calendar" → target="calendar"
- "financeiro", "finance", "finanças" → target="finance"
- "obras", "jobs", "trabalhos", "projetos" → target="jobs"
- "subs", "subcontratados", "subcontractors", "terceiros" → target="subs"

REGRAS:
1. "abrir / mostrar / ver" + documento DE alguém → action="show_document", target=tipo, filter.client=nome, filter.latest=true.
2. "ir / volta / abre" + nome de tela → action="navigate", target=nome da tela.
3. "quantos / qual / total" → action="query".
4. Nome próprio vai SEMPRE em filter.client.

Exemplos:
- "abre o orçamento da Megan Flores" → {"action":"show_document","target":"estimate","filter":{"client":"Megan Flores","latest":true},"raw_query":"abre o orçamento da Megan Flores","confidence":"high"}
- "mostra o estimate da Yulia" → {"action":"show_document","target":"estimate","filter":{"client":"Yulia","latest":true},"raw_query":"mostra o estimate da Yulia","confidence":"high"}
- "quantos jobs ativos" → {"action":"query","target":"jobs_count","filter":{"status":"active"},"raw_query":"quantos jobs ativos","confidence":"high"}
- "volta pro dashboard" → {"action":"navigate","target":"dashboard","filter":null,"raw_query":"volta pro dashboard","confidence":"high"}

SEMPRE retorne JSON válido. NUNCA texto fora do JSON. Erros de transcrição são esperados — interprete a INTENÇÃO, não a letra.`;

/**
 * Parse a free-text voice command into a structured intent.
 * Returns { intent, latency_ms } on success. Throws on API errors.
 */
export async function parseVoiceIntent(commandText) {
  const started = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const data = await callGroq({
    model: MODEL,
    temperature: 0,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: VOICE_INTENT_SYSTEM_PROMPT },
      { role: 'user', content: commandText },
    ],
  });
  const content = data?.choices?.[0]?.message?.content || '{}';
  let intent;
  try { intent = JSON.parse(content); }
  catch {
    const stripped = content.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    intent = JSON.parse(stripped);
  }
  if (!intent.raw_query) intent.raw_query = commandText;
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return { intent, latency_ms: Math.round(now - started) };
}

/** Simple chat (no tools). */
export async function chatWithGroq(messages) {
  try {
    const data = await callGroq({
      model: MODEL,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    });
    return data?.choices?.[0]?.message?.content || "Hmm — empty response. Try again.";
  } catch (err) {
    console.error('[groq] chat failed', err);
    return "I'm having trouble reaching my brain right now. Give me a moment and try again.";
  }
}

/**
 * Chat with tool-calling. `ctx` (3rd arg) is passed to every tool so they
 * can scope results to the current user/role (e.g. sales sees only their
 * own jobs). `ctx` is NEVER shown to the model.
 *
 * @param {Array}  messages
 * @param {Array}  tools
 * @param {Object} toolImpls  — { toolName: async (args, ctx) => result }
 * @param {Object} ctx        — { user: { name, role } }
 */
export async function chatWithGroqTools(messages, tools, toolImpls, ctx = {}) {
  try {
    const history = [...messages];

    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const data = await callGroq({
        model: MODEL,
        messages: history,
        tools,
        tool_choice: 'auto',
        temperature: 0.4,
        max_tokens: 1024,
      });

      const msg = data?.choices?.[0]?.message;
      if (!msg) return "Hmm — empty response. Try again.";

      const toolCalls = msg.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        return msg.content || "I don't have a response for that.";
      }

      history.push({
        role: 'assistant',
        content: msg.content || '',
        tool_calls: toolCalls,
      });

      for (const call of toolCalls) {
        const name = call?.function?.name;
        let args = {};
        try { args = call.function.arguments ? JSON.parse(call.function.arguments) : {}; }
        catch { args = {}; }

        let result;
        try {
          const impl = toolImpls?.[name];
          result = impl
            ? await impl(args, ctx)
            : { error: `Tool "${name}" is not implemented.` };
        } catch (err) {
          result = { error: `Tool "${name}" crashed: ${err?.message || err}` };
        }

        history.push({
          role: 'tool',
          tool_call_id: call.id,
          name,
          content: JSON.stringify(result).slice(0, 8000),
        });
      }
    }

    return "I tried a few different lookups and got stuck. Could you rephrase the question?";
  } catch (err) {
    console.error('[groq] tool-chat failed', err);
    return "I'm having trouble reaching the database right now. Give me a moment and try again.";
  }
}
