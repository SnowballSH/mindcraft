import { z } from 'zod';

export type Turn = { role: string; content: string };

export interface ChatModelLike {
  sendRequest(turns: Turn[], systemPrompt?: string): Promise<string>;
}

function stripCodeFences(text: unknown) {
  const t = String(text ?? '').trim();
  if (t.startsWith('```')) {
    const parts = t.split('```');
    if (parts.length >= 3) {
      return parts[1].replace(/^json\s*/i, '').trim();
    }
  }
  return t;
}

function extractJsonObject(text: unknown) {
  const t = stripCodeFences(text);
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return t.slice(start, end + 1);
}

export async function llmJson<T extends z.ZodTypeAny>(
  model: ChatModelLike,
  systemPrompt: string,
  userPrompt: string,
  schema: T,
): Promise<z.infer<T>> {
  const turns: Turn[] = [{ role: 'user', content: userPrompt }];
  const raw = await model.sendRequest(turns, systemPrompt);
  const candidate = extractJsonObject(raw);
  if (!candidate) throw new Error('Failed to parse JSON from model response');
  const parsed = JSON.parse(candidate) as unknown;
  return schema.parse(parsed);
}

export async function llmJsonSafe<T extends z.ZodTypeAny>(
  model: ChatModelLike,
  systemPrompt: string,
  userPrompt: string,
  schema: T,
): Promise<
  | { ok: true; value: z.infer<T>; raw: string }
  | { ok: false; error: string; raw: string }
> {
  const turns: Turn[] = [{ role: 'user', content: userPrompt }];
  const raw = await model.sendRequest(turns, systemPrompt);
  const candidate = extractJsonObject(raw);
  if (!candidate) {
    return { ok: false, error: 'Failed to parse JSON object from model response', raw: String(raw ?? '') };
  }
  try {
    const parsed = JSON.parse(candidate) as unknown;
    const res = schema.safeParse(parsed);
    if (!res.success) {
      return { ok: false, error: res.error.message, raw: String(raw ?? '') };
    }
    return { ok: true, value: res.data, raw: String(raw ?? '') };
  } catch (err) {
    return { ok: false, error: String(err), raw: String(raw ?? '') };
  }
}


