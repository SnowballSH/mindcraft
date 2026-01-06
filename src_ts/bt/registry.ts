/*
registry.ts defines the “capability registry” for Behavior Tree (BT) system:

XML BT nodes like <Action name="obtain_item" .../> and <Condition name="has_item" .../> are semantic labels.
The registry maps those labels to:
  1. a runtime implementation (run / resume / evaluate)
  2. a Zod schema used to validate and coerce the node’s arguments at runtime
So instead of hard-coding behavior inside the parser/interpreter, you get an extensible plug-in mechanism:

add a new action by registering it once
the interpreter can execute it by name
you get runtime validation and defaults via Zod
*/


import { z } from 'zod';
import type { ActionResult, ConditionResult, BTState } from './types.js';

export interface RuntimeContext {
  state: BTState;
  nowMs: () => number;
  // late-bound to avoid circular deps: concrete adapters are injected by the host
  mindcraft?: unknown;
  services?: Record<string, unknown>;
}

export interface ActionHandler<TArgs> {
  name: string;
  schema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  run: (ctx: RuntimeContext, args: TArgs) => Promise<ActionResult>;
  resume?: (ctx: RuntimeContext, args: TArgs, resumeToken: unknown) => Promise<ActionResult>;
}

export interface ConditionHandler<TArgs> {
  name: string;
  schema: z.ZodType<TArgs, z.ZodTypeDef, unknown>;
  evaluate: (ctx: RuntimeContext, args: TArgs) => Promise<ConditionResult>;
}

export class Registry {
  private actions = new Map<string, ActionHandler<any>>();
  private conditions = new Map<string, ConditionHandler<any>>();

  registerAction<TArgs>(handler: ActionHandler<TArgs>): this {
    if (this.actions.has(handler.name)) {
      throw new Error(`Action '${handler.name}' already registered`);
    }
    this.actions.set(handler.name, handler);
    return this;
  }

  registerCondition<TArgs>(handler: ConditionHandler<TArgs>): this {
    if (this.conditions.has(handler.name)) {
      throw new Error(`Condition '${handler.name}' already registered`);
    }
    this.conditions.set(handler.name, handler);
    return this;
  }

  getAction(name: string): ActionHandler<any> {
    const h = this.actions.get(name);
    if (!h) throw new Error(`Unknown action '${name}'`);
    return h;
  }

  getCondition(name: string): ConditionHandler<any> {
    const h = this.conditions.get(name);
    if (!h) throw new Error(`Unknown condition '${name}'`);
    return h;
  }

  hasAction(name: string): boolean {
    return this.actions.has(name);
  }

  hasCondition(name: string): boolean {
    return this.conditions.has(name);
  }

  listActions(): string[] {
    return [...this.actions.keys()].sort();
  }

  listConditions(): string[] {
    return [...this.conditions.keys()].sort();
  }
}
