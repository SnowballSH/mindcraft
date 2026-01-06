/*
This file is a thin adapter that wraps
    Behavior Tree interpreter (tick in interpreter.ts)
    inside a LangGraph StateGraph loop.

Functionally, it turns “tick a BT until it finishes”
    into a reusable LangGraph runnable:

Start with { btState, status: "RUNNING" }
Repeatedly call tick(...)
Stop when the BT returns SUCCESS or FAILURE
This gives:

1. A consistent “orchestration shell” around the interpreter
2. A clean place to add checkpointing/streaming later (LangGraph supports this)
3. An explicit recursion bound via LangGraph config (recursionLimit) to prevent infinite loops
*/
import { Annotation, START, END, StateGraph } from '@langchain/langgraph';
import { tick } from './interpreter.js';
export const BTGraphState = Annotation.Root({
    btState: Annotation({
        reducer: (_x, y) => y,
    }),
    status: Annotation({
        reducer: (_x, y) => y,
    }),
});
export function buildBTGraph(registry, services) {
    async function btTickNode(state) {
        const res = await tick(state.btState, registry, { services });
        return { btState: res.state, status: res.status };
    }
    function shouldEnd(state) {
        return state.status === 'SUCCESS' || state.status === 'FAILURE' ? 'end' : 'continue';
    }
    const g = new StateGraph(BTGraphState)
        .addNode('bt_tick', btTickNode)
        .addEdge(START, 'bt_tick')
        .addConditionalEdges('bt_tick', shouldEnd, {
        end: END,
        continue: 'bt_tick',
    });
    return g.compile();
}
