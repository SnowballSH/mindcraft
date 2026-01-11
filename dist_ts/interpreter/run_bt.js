import { parseBehaviorTreeXml } from './xml_parser.js';
import { createDefaultRegistry } from './actions_builtin.js';
import { registerDefaultConditions } from './conditions_builtin.js';
import { createInitialState } from './state_init.js';
import { tick } from './interpreter.js';
import { createMindcraftCapabilities } from './mindcraft_capabilities.js';
export async function runBT(agent, opts) {
    if (!agent)
        throw new Error('runBT: missing agent');
    const tree = opts.tree ?? (opts.xml ? parseBehaviorTreeXml(opts.xml) : null);
    if (!tree)
        throw new Error('runBT: missing opts.tree or opts.xml');
    const registry = registerDefaultConditions(createDefaultRegistry());
    const vars = opts.vars ?? {};
    const state = createInitialState(tree, vars);
    const services = {
        agent,
        capabilities: createMindcraftCapabilities(agent),
    };
    const limit = opts.recursionLimit ?? 500;
    let status = 'RUNNING';
    for (let i = 0; i < limit; i++) {
        const res = await tick(state, registry, { services });
        status = res.status;
        if (status === 'SUCCESS' || status === 'FAILURE') {
            return { status, state };
        }
    }
    return { status: 'FAILURE', state };
}
