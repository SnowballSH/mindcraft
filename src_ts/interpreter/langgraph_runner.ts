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
import type { BTState, BTStatus } from './types.js';
import { tick } from './interpreter.js';
import type { Registry } from './registry.js';

export const BTGraphState = Annotation.Root({
  btState: Annotation<BTState>({
    reducer: (_x: BTState | undefined, y: BTState) => y,
  }),
  status: Annotation<BTStatus>({
    reducer: (_x: BTStatus | undefined, y: BTStatus) => y,
  }),
});

export function buildBTGraph(registry: Registry, services: Record<string, unknown>) {
  async function btTickNode(state: typeof BTGraphState.State) {
    const res = await tick(state.btState, registry, { services });
    return { btState: res.state, status: res.status };
  }

  function shouldEnd(state: typeof BTGraphState.State) {
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
