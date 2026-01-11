export function createInitialState(tree, vars) {
    return {
        bt: tree,
        runtime: { statusById: {}, stack: [] },
        world: { inventory: {} },
        vars,
        blackboard: {},
        logs: [],
    };
}
