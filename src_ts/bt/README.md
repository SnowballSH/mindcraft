This folder contains a TypeScript Behavior Tree (BT) interpreter that can be driven by LangGraph.

Key ideas:
- XML (BehaviorTree.CPP-style) -> IR
- IR executed by an interpreter with SUCCESS/FAILURE/RUNNING
- Actions/Conditions are registry-driven and extensible
- Leaf actions call into Mindcraft via executeCommand (adapter)

Scripts:
- pnpm bt:dev

To run against a live bot, inject a running Mindcraft Agent instance into demo.ts (services.agent).
