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
