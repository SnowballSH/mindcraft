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
export class Registry {
    actions = new Map();
    conditions = new Map();
    registerAction(handler) {
        if (this.actions.has(handler.name)) {
            throw new Error(`Action '${handler.name}' already registered`);
        }
        this.actions.set(handler.name, handler);
        return this;
    }
    registerCondition(handler) {
        if (this.conditions.has(handler.name)) {
            throw new Error(`Condition '${handler.name}' already registered`);
        }
        this.conditions.set(handler.name, handler);
        return this;
    }
    getAction(name) {
        const h = this.actions.get(name);
        if (!h)
            throw new Error(`Unknown action '${name}'`);
        return h;
    }
    getCondition(name) {
        const h = this.conditions.get(name);
        if (!h)
            throw new Error(`Unknown condition '${name}'`);
        return h;
    }
    hasAction(name) {
        return this.actions.has(name);
    }
    hasCondition(name) {
        return this.conditions.has(name);
    }
    listActions() {
        return [...this.actions.keys()].sort();
    }
    listConditions() {
        return [...this.conditions.keys()].sort();
    }
}
