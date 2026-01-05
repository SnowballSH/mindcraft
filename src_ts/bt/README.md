This folder contains a TypeScript Behavior Tree (BT) interpreter that can be driven by LangGraph.

Key ideas:
- XML (BehaviorTree.CPP-style) -> IR
- IR executed by an interpreter with SUCCESS/FAILURE/RUNNING
- Actions/Conditions are registry-driven and extensible
- Leaf actions call into Mindcraft via executeCommand (adapter)

Scripts:
- pnpm bt:dev

To run against a live bot, inject a running Mindcraft Agent instance into demo.ts (services.agent).

What's added:
1) TypeScript toolchain
* Added tsconfig.json
* Added src_ts/ folder (isolated from existing JS runtime)
* Updated package.json:
    * deps: langchain/langgraph, langchain/core, fast-xml-parser, zod
    * dev deps: typescript, tsx
        * scripts:
        * bt:dev: tsx src_ts/bt/demo.ts
        * bt:build: tsc -p tsconfig.json
    
2) XML → IR parser (BehaviorTree.CPP-ish subset)
Files:
* src_ts/bt/xml_parser.ts
    * Supports:
    * <BehaviorTree>
    * <Sequence>, <Fallback>
    * <Action name="...">, <Condition name="...">
    * Produces an IR tree:
    * rootId
    * nodes map keyed by stable IDs like root/0/1

3) Variable binding system
Files:
* src_ts/bt/vars.ts
* Implements {var} placeholder substitution on action/condition params.
* Variables live in state.vars.

4) Registry-driven extensibility (scalable actions/conditions)
Files:
* src_ts/bt/registry.ts
    * Actions and conditions are registered with:
    * a name
    * a zod schema (validation/coercion, including defaults)
    * a run function (and optional resume)
This is the core scalability hook: to add a new leaf capability, you add one registry entry. No compiler changes.

5) BT interpreter with SUCCESS | FAILURE | RUNNING
Files:
* src_ts/bt/interpreter.ts
Key properties:
* Persistent runtime.stack = BT call stack ({nodeId, childIndex})
* Persistent runtime.running = currently running action + resume token
    * Handles:
    * Sequence semantics
    * Fallback semantics
    * Leaf execution
    * Resume logic for RUNNING actions
* Fixed a correctness issue: when a RUNNING action completes, the interpreter now pops the leaf frame to avoid re-executing it.

6) Mindcraft integration layer (via existing executeCommand)
Files:
* src_ts/bt/mindcraft_adapter.ts
This adapter wraps:
* executeCommand(agent, message) from Mindcraft

7) Built-in actions/conditions (including ItemGoal integration)
Files:
* src_ts/bt/actions_builtin.ts
* src_ts/bt/conditions_builtin.ts
Included actions:
* goto_player → !goToPlayer
* give_player → !givePlayer
* obtain_item → uses Mindcraft’s deterministic ItemGoal (RUNNING-capable)
Important fixes made:
* obtain_item now returns SUCCESS once inventory satisfies the target count.
* Fixed the previous invalid this.run(...) in the resume handler (now uses a shared helper).
Included condition:
* has_item

8) LangGraph wrapper (StateGraph that ticks until done)
Files:
* src_ts/bt/langgraph_runner.ts
Graph:
* START -> bt_tick -> (loop until SUCCESS/FAILURE)

9) Demo entrypoint
Files:
* src_ts/bt/demo.ts
This compiles XML + builds the LangGraph app and runs it.
Note: It will throw until you inject services.agent (a live Mindcraft 
Agent instance). That’s expected for now

10) TS shims for JS imports
Files:
* src_ts/shims.d.ts
This avoids TS errors when importing Mindcraft JS modules.

