import { parseBehaviorTreeXml } from './xml_parser.js';
import { createDefaultRegistry } from './actions_builtin.js';
import { registerDefaultConditions } from './conditions_builtin.js';
import { buildBTGraph } from './langgraph_runner.js';
import type { BTState } from './types.js';

// NOTE: This is a demo harness.
// To run it meaningfully, you need to provide a live Mindcraft Agent instance in services.agent.
// For now, this file demonstrates compilation+graph wiring. It will throw if agent is missing.

const xml = `
<BehaviorTree ID="navigate_and_scan">
  <Sequence>
    <Action name="goto_player" player="{player}" min_distance="3" />
    <Action name="sense_nearby_entities" max_distance="16" set="nearbyEntities" />
    <Condition name="bb_any_equals" key="nearbyEntities" field="name" value="{target_entity}" />
  </Sequence>
</BehaviorTree>
`;

const tree = parseBehaviorTreeXml(xml);

const registry = registerDefaultConditions(createDefaultRegistry());

const btState: BTState = {
  bt: tree,
  runtime: { statusById: {}, stack: [] },
  world: { inventory: {} },
  vars: { player: 'Steve', target_entity: 'zombie' },
  blackboard: {},
  logs: [],
};

const services: Record<string, unknown> = {
  // You must inject a running Mindcraft agent here:
  // agent,
  // capabilities,
};

const app = buildBTGraph(registry, services);

(async () => {
  const out = await app.invoke({ btState, status: 'RUNNING' }, { recursionLimit: 500 });
  console.log('Final status:', out.status);
  console.log('Logs:', out.btState.logs.slice(-20));
})();
