const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY;

export async function scanMaterialsImage(base64Data, mimeType = 'image/jpeg', onRetry) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64Data } },
              {
                type: 'text',
                text: `You are a construction materials expert. Identify every construction material, product, or supply item visible in this image (including items on invoices, receipts, handwritten lists, or physical materials).

For each item return a JSON array with these exact fields:
- item: short product name (e.g. "2x4x8 Stud", "1/2\" Drywall Sheet", "PVC 90° Elbow 3/4\"")
- description: material type or grade (e.g. "Douglas Fir KD", "Type X Fire Rated", "Schedule 40")
- quantity: numeric quantity visible or estimated from the image (number only, no units)
- size: dimensions or size spec (e.g. "2\" x 4\" x 8'", "4x8 sheet", "3/4\" dia")
- sku: Home Depot or supplier SKU if visible, otherwise leave empty string
- color: color or finish if visible or applicable, otherwise leave empty string
- category: one of Lumber, Hardware, Electrical, Plumbing, Waterproofing, Finishes, Tools, Other

Return ONLY a valid JSON array — no markdown, no explanation:
[{"item":"2x4x8 Stud","description":"Douglas Fir KD","quantity":48,"size":"2\\" x 4\\" x 8'","sku":"161640","color":"Natural","category":"Lumber"}]`,
              },
            ],
          }],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') throw new Error('Request timed out. Please try again.');
      throw err;
    }
    clearTimeout(timeout);
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      if (response.status === 429) {
        if (attempt < 3) {
          onRetry?.(`Scanning... retrying (${attempt + 1}/3)`);
          await new Promise((r) => setTimeout(r, 10000));
          continue;
        }
        throw new Error('AI is busy. Please try again in a few minutes.');
      }
      throw new Error(err?.error?.message || `API error ${response.status}`);
    }
    const data = await response.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Could not parse materials from image. Try a clearer photo.');
    return JSON.parse(match[0]);
  }
}
