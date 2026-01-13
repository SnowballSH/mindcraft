function stripCodeFences(text) {
    const t = String(text ?? '').trim();
    if (t.startsWith('```')) {
        const parts = t.split('```');
        if (parts.length >= 3) {
            return parts[1].replace(/^json\s*/i, '').trim();
        }
    }
    return t;
}
function extractJsonObject(text) {
    const t = stripCodeFences(text);
    const start = t.indexOf('{');
    const end = t.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start)
        return null;
    return t.slice(start, end + 1);
}
export async function llmJson(model, systemPrompt, userPrompt, schema) {
    const turns = [{ role: 'user', content: userPrompt }];
    const raw = await model.sendRequest(turns, systemPrompt);
    const candidate = extractJsonObject(raw);
    if (!candidate)
        throw new Error('Failed to parse JSON from model response');
    const parsed = JSON.parse(candidate);
    return schema.parse(parsed);
}
export async function llmJsonSafe(model, systemPrompt, userPrompt, schema) {
    const turns = [{ role: 'user', content: userPrompt }];
    const raw = await model.sendRequest(turns, systemPrompt);
    const candidate = extractJsonObject(raw);
    if (!candidate) {
        return { ok: false, error: 'Failed to parse JSON object from model response', raw: String(raw ?? '') };
    }
    try {
        const parsed = JSON.parse(candidate);
        const res = schema.safeParse(parsed);
        if (!res.success) {
            return { ok: false, error: res.error.message, raw: String(raw ?? '') };
        }
        return { ok: true, value: res.data, raw: String(raw ?? '') };
    }
    catch (err) {
        return { ok: false, error: String(err), raw: String(raw ?? '') };
    }
}
