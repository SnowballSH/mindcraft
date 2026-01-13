/*
This file is the runtime executor for Behavior Tree (BT) IR. It takes:

1. A parsed IR tree (state.bt: nodes + root ID)
2. A mutable runtime state (state.runtime: stack, statuses, running action)
3. A registry of semantic actions/conditions (registry)
4. A context object (RuntimeContext) with injected services (like a Mindcraft agent, adapters, etc.)
…and advances the BT one tick at a time, returning:

Updated state
The BT’s overall status: SUCCESS | FAILURE | RUNNING
The key design goals it implements are:

Interpreter (not compilation): no LangGraph nodes per BT node; it’s a single ticking loop.
RUNNING support: long actions can span multiple ticks and resume later.
Persistent execution cursor: state.runtime.stack remembers where you were between ticks.
*/


import type {
  ActionResult,
  BTState,
  BTStatus,
  IRNode,
  IRTree,
  RunningAction,
  RuntimeFrame,
} from './types.js';
import { resolveVarsInRecord } from './vars.js';
import type { Registry, RuntimeContext } from './registry.js';

function log(state: BTState, msg: string): void {
  state.logs.push({ ts: Date.now(), msg });
}

function getNode(tree: IRTree, nodeId: string): IRNode {
  const n = tree.nodes[nodeId];
  if (!n) throw new Error(`Unknown nodeId '${nodeId}'`);
  return n;
}

function setStatus(state: BTState, nodeId: string, status: BTStatus): void {
  state.runtime.statusById[nodeId] = status;
}

function getStatus(state: BTState, nodeId: string): BTStatus | undefined {
  return state.runtime.statusById[nodeId];
}

function topFrame(state: BTState): RuntimeFrame | undefined {
  return state.runtime.stack[state.runtime.stack.length - 1];
}

function pushFrame(state: BTState, nodeId: string): void {
  state.runtime.stack.push({ nodeId, childIndex: 0 });
}

function popFrame(state: BTState): RuntimeFrame | undefined {
  return state.runtime.stack.pop();
}

function succeed(state: BTState, nodeId: string): void {
  setStatus(state, nodeId, 'SUCCESS');
}

function fail(state: BTState, nodeId: string): void {
  setStatus(state, nodeId, 'FAILURE');
}

function running(state: BTState, nodeId: string, ra: RunningAction): void {
  setStatus(state, nodeId, 'RUNNING');
  state.runtime.running = ra;
}

async function runActionNode(
  ctx: RuntimeContext,
  registry: Registry,
  nodeId: string,
): Promise<ActionResult> {
  const node = getNode(ctx.state.bt, nodeId);
  if (node.type !== 'Action') throw new Error('Expected Action node');

  const handler = registry.getAction(node.name);
  const resolvedParams = resolveVarsInRecord((node.params ?? {}) as Record<string, unknown>, ctx.state.vars);
  let parsedArgs: any;
  try {
    parsedArgs = handler.schema.parse(resolvedParams);
  } catch (err) {
    log(ctx.state, `action ${node.name} args schema error: ${String(err)}`);
    return { status: 'FAILURE', error: String(err) };
  }

  return handler.run(ctx, parsedArgs);
}

async function resumeActionNode(
  ctx: RuntimeContext,
  registry: Registry,
  runningAction: RunningAction,
): Promise<ActionResult> {
  const handler = registry.getAction(runningAction.actionName);
  if (!handler.resume) {
    // No resume handler means treat as failure (misconfigured action)
    return { status: 'FAILURE', error: `Action '${runningAction.actionName}' is RUNNING but has no resume()` };
  }
  let parsedArgs: any;
  try {
    parsedArgs = handler.schema.parse(runningAction.params);
  } catch (err) {
    log(ctx.state, `resume ${runningAction.actionName} args schema error: ${String(err)}`);
    return { status: 'FAILURE', error: String(err) };
  }
  return handler.resume(ctx, parsedArgs, runningAction.resumeToken);
}

async function evalConditionNode(
  ctx: RuntimeContext,
  registry: Registry,
  nodeId: string,
): Promise<BTStatus> {
  const node = getNode(ctx.state.bt, nodeId);
  if (node.type !== 'Condition') throw new Error('Expected Condition node');

  const handler = registry.getCondition(node.name);
  const resolvedParams = resolveVarsInRecord((node.params ?? {}) as Record<string, unknown>, ctx.state.vars);
  let parsedArgs: any;
  try {
    parsedArgs = handler.schema.parse(resolvedParams);
  } catch (err) {
    log(ctx.state, `condition ${node.name} args schema error: ${String(err)}`);
    return 'FAILURE';
  }

  const res = await handler.evaluate(ctx, parsedArgs);
  if (res.updates) {
    Object.assign(ctx.state, res.updates);
  }
  if (res.status !== 'SUCCESS' && res.status !== 'FAILURE') {
    throw new Error(`Condition '${node.name}' returned invalid status '${res.status}'`);
  }
  return res.status;
}

function bubbleFromChild(
  state: BTState,
  parentId: string,
  childStatus: BTStatus,
): BTStatus {
  const parent = getNode(state.bt, parentId);
  if (parent.type !== 'Sequence' && parent.type !== 'Fallback') {
    throw new Error(`Unsupported composite parent type: ${parent.type}`);
  }

  if (parent.type === 'Sequence') {
    if (childStatus === 'FAILURE') return 'FAILURE';
    if (childStatus === 'RUNNING') return 'RUNNING';
    // SUCCESS: continue until last child
    return 'SUCCESS';
  }

  // Fallback
  if (childStatus === 'SUCCESS') return 'SUCCESS';
  if (childStatus === 'RUNNING') return 'RUNNING';
  // FAILURE: continue to next child
  return 'FAILURE';
}

export interface TickResult {
  state: BTState;
  status: BTStatus;
}

export async function tick(
  state: BTState,
  registry: Registry,
  injectedCtx: Omit<RuntimeContext, 'state' | 'nowMs'> & { nowMs?: () => number } = {},
): Promise<TickResult> {
  const ctx: RuntimeContext = {
    state,
    nowMs: injectedCtx.nowMs ?? (() => Date.now()),
    mindcraft: injectedCtx.mindcraft,
    services: injectedCtx.services,
  };

  // 1) Resume if something is RUNNING
  if (state.runtime.running) {
    const ra = state.runtime.running;
    const res = await resumeActionNode(ctx, registry, ra);

    if (res.updates) Object.assign(state, res.updates);

    if (res.status === 'RUNNING') {
      state.runtime.running = {
        ...ra,
        resumeToken: res.resumeToken ?? ra.resumeToken,
      };
      log(state, `resume ${ra.actionName} -> RUNNING`);
      return { state, status: 'RUNNING' };
    }

    // completed
    state.runtime.running = undefined;
    setStatus(state, ra.nodeId, res.status);
    // If the running action node is still on the stack, pop it so we can continue bubbling.
    const top = topFrame(state);
    if (top?.nodeId === ra.nodeId) {
      popFrame(state);
    }
    log(state, `resume ${ra.actionName} -> ${res.status}`);
  }

  // Ensure stack has root
  if (state.runtime.stack.length === 0) {
    pushFrame(state, state.bt.rootId);
  }

  // 2) Walk down from the top frame until we execute a leaf
  while (true) {
    const frame = topFrame(state);
    if (!frame) {
      // finished bubbling; use root status
      const rootStatus = getStatus(state, state.bt.rootId) ?? 'FAILURE';
      return { state, status: rootStatus };
    }

    const node = getNode(state.bt, frame.nodeId);

    // If a leaf/composite node is already terminal, pop it and continue bubbling.
    const existing = getStatus(state, node.id);
    if (existing === 'SUCCESS' || existing === 'FAILURE') {
      popFrame(state);
      continue;
    }

    if (node.type === 'Sequence' || node.type === 'Fallback') {
      const childIds = node.children;
      if (frame.childIndex >= childIds.length) {
        // No more children: determine result
        if (node.type === 'Sequence') {
          succeed(state, node.id);
        } else {
          // Fallback: all failed
          fail(state, node.id);
        }
        popFrame(state);
        continue;
      }

      const childId = childIds[frame.childIndex];
      const childStatus = getStatus(state, childId);

      if (childStatus === 'SUCCESS') {
        if (node.type === 'Sequence') {
          frame.childIndex++;
          continue;
        } else {
          // Fallback: child success => parent success
          succeed(state, node.id);
          popFrame(state);
          continue;
        }
      }

      if (childStatus === 'FAILURE') {
        if (node.type === 'Sequence') {
          fail(state, node.id);
          popFrame(state);
          continue;
        } else {
          frame.childIndex++;
          continue;
        }
      }

      if (childStatus === 'RUNNING') {
        // parent is RUNNING
        setStatus(state, node.id, 'RUNNING');
        return { state, status: 'RUNNING' };
      }

      // child not evaluated yet => descend
      pushFrame(state, childId);
      continue;
    }

    if (node.type === 'Condition') {
      const status = await evalConditionNode(ctx, registry, node.id);
      setStatus(state, node.id, status);
      popFrame(state);

      // bubble to parent by leaving child status in statusById; parent will react in next loop
      continue;
    }

    if (node.type === 'Action') {
      const res = await runActionNode(ctx, registry, node.id);
      if (res.updates) Object.assign(state, res.updates);

      if (res.status === 'RUNNING') {
        running(state, node.id, {
          nodeId: node.id,
          actionName: node.name,
          params: resolveVarsInRecord((node.params ?? {}) as Record<string, unknown>, state.vars) as Record<string, unknown>,
          startedAtMs: ctx.nowMs(),
          resumeToken: res.resumeToken,
        });
        log(state, `action ${node.name} -> RUNNING`);
        return { state, status: 'RUNNING' };
      }

      setStatus(state, node.id, res.status);
      log(state, `action ${node.name} -> ${res.status}`);
      popFrame(state);
      continue;
    }

    throw new Error(`Unsupported node type in interpreter: ${(node as any).type}`);
  }
}
