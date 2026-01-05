// Variable substitution is intentionally simple and scalable:
// - Variables live in state.vars
// - XML attributes can include placeholders like "{player}" or "Hello {name}!"
// - After parsing XML, we resolve placeholders into concrete strings before schema validation.

const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

export function resolveVarsInString(input: string, vars: Record<string, string>): string {
  return input.replace(VAR_PATTERN, (match, varName) => {
    if (vars[varName] === undefined) return match;
    return vars[varName];
  });
}

export function resolveVarsInRecord(
  params: Record<string, unknown>,
  vars: Record<string, string>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === 'string') {
      out[k] = resolveVarsInString(v, vars);
    } else {
      out[k] = v;
    }
  }
  return out;
}
