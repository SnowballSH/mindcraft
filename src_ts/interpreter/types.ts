export type BTStatus = 'SUCCESS' | 'FAILURE' | 'RUNNING';

export type IRNodeType =
  | 'Sequence'
  | 'Fallback'
  | 'Action'
  | 'Condition'
  | 'Inverter'
  | 'Retry'
  | 'Timeout';

export interface IRBaseNode {
  id: string;
  type: IRNodeType;
  params?: Record<string, unknown>;
}

export interface IRCompositeNode extends IRBaseNode {
  children: string[];
}

export interface IRSequenceNode extends IRCompositeNode {
  type: 'Sequence';
}

export interface IRFallbackNode extends IRCompositeNode {
  type: 'Fallback';
}

export interface IRActionNode extends IRBaseNode {
  type: 'Action';
  name: string;
}

export interface IRConditionNode extends IRBaseNode {
  type: 'Condition';
  name: string;
}

export interface IRInverterNode extends IRCompositeNode {
  type: 'Inverter';
}

export interface IRRetryNode extends IRCompositeNode {
  type: 'Retry';
}

export interface IRTimeoutNode extends IRCompositeNode {
  type: 'Timeout';
}

export type IRNode =
  | IRSequenceNode
  | IRFallbackNode
  | IRActionNode
  | IRConditionNode
  | IRInverterNode
  | IRRetryNode
  | IRTimeoutNode;

export interface IRTree {
  rootId: string;
  nodes: Record<string, IRNode>;
}

export interface RuntimeFrame {
  nodeId: string;
  childIndex: number;
}

export interface RunningAction {
  nodeId: string;
  actionName: string;
  params: Record<string, unknown>;
  startedAtMs: number;
  resumeToken?: unknown;
}

export interface BTRuntimeState {
  statusById: Record<string, BTStatus>;
  stack: RuntimeFrame[];
  running?: RunningAction;
}

export interface WorldState {
  inventory: Record<string, number>;
  position?: { x: number; y: number; z: number };
}

export interface BTState {
  bt: IRTree;
  runtime: BTRuntimeState;
  world: WorldState;
  vars: Record<string, string>;
  // Structured scratchpad for sensed data / intermediate results.
  // Prefer this over parsing strings from vars.
  blackboard: Record<string, unknown>;
  logs: Array<{ ts: number; msg: string }>;
}

export interface ActionResult {
  status: BTStatus;
  updates?: Partial<BTState>;
  error?: string;
  resumeToken?: unknown;
}

export interface ConditionResult {
  status: Exclude<BTStatus, 'RUNNING'>;
  updates?: Partial<BTState>;
  error?: string;
}
