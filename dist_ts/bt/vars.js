// Variable substitution is intentionally simple and scalable:
// - Variables live in state.vars
// - XML attributes can include placeholders like "{player}" or "Hello {name}!"
// - After parsing XML, we resolve placeholders into concrete strings before schema validation.
const VAR_PATTERN = /\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
// 1. Must start with a letter or underscore
// 2. Can then contain letters, digits, underscores
export function resolveVarsInString(input, vars) {
    return input.replace(VAR_PATTERN, (match, varName) => {
        if (vars[varName] === undefined)
            return match;
        return vars[varName];
    });
}
// Example:
// input: "Give {player} {count} {item}"
// vars: { player: "Steve", count: "16", item: "torch" }
// output: "Give Steve 16 torch"
// If vars is missing item:
// output: "Give Steve 16 {item}"
export function resolveVarsInRecord(params, vars) {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') {
            out[k] = resolveVarsInString(v, vars);
        }
        else {
            out[k] = v;
        }
    }
    return out;
}
