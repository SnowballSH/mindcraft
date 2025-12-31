export const FUNCTION_GEMMA_TAG = '@function_gemma';

export function extractFunctionGemmaRequest(message) {
    if (!message) {
        return null;
    }
    const lines = message.split('\n');
    let intent = null;
    const remaining = [];
    for (const line of lines) {
        const lower = line.toLowerCase();
        const tagIndex = lower.indexOf(FUNCTION_GEMMA_TAG);
        if (tagIndex !== -1) {
            let afterTag = line.slice(tagIndex + FUNCTION_GEMMA_TAG.length).trim();
            if (afterTag.startsWith(':')) {
                afterTag = afterTag.slice(1).trim();
            }
            if (intent === null) {
                intent = afterTag;
            }
            const before = line.slice(0, tagIndex).trim();
            if (before) {
                remaining.push(before);
            }
            continue;
        }
        remaining.push(line);
    }
    if (intent === null) {
        return null;
    }
    if (!intent) {
        intent = 'Choose the single best command for the requested action.';
    }
    return { intent, cleaned: remaining.join('\n').trim() };
}
