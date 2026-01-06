import { parseBehaviorTreeXml } from './xml_parser.js';
import { createDefaultRegistry } from './actions_builtin.js';
import { registerDefaultConditions } from './conditions_builtin.js';
import { buildBTGraph } from './langgraph_runner.js';
// NOTE: This is a demo harness.
// To run it meaningfully, you need to provide a live Mindcraft Agent instance in services.agent.
// For now, this file demonstrates compilation+graph wiring. It will throw if agent is missing.
const xml = `
<BehaviorTree ID="obtain_and_give">
  <Sequence>
    <Action name="obtain_item" item="{item}" count="{count}" />
    <Action name="goto_player" player="{player}" closeness="2" />
    <Action name="give_player" player="{player}" item="{item}" count="{count}" />
  </Sequence>
</BehaviorTree>
`;
const tree = parseBehaviorTreeXml(xml);
const registry = registerDefaultConditions(createDefaultRegistry());
const btState = {
    bt: tree,
    runtime: { statusById: {}, stack: [] },
    world: { inventory: {} },
    vars: { item: 'torch', count: '16', player: 'Steve' },
    logs: [],
};
const services = {
// You must inject a running Mindcraft agent here:
// agent,
// mindcraftAdapter,
};
const app = buildBTGraph(registry, services);
(async () => {
    const out = await app.invoke({ btState, status: 'RUNNING' }, { recursionLimit: 500 });
    console.log('Final status:', out.status);
    console.log('Logs:', out.btState.logs.slice(-20));
})();
