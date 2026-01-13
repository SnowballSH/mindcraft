import { END, START, StateGraph } from '@langchain/langgraph';
import { defaultDeps } from './deps.js';
import { makeMessageGraphNodes } from './nodes.js';
import { MessageState } from './state.js';
export function buildMessageGraph(agent, depsOverride) {
    const deps = { ...defaultDeps, ...(depsOverride ?? {}) };
    deps.commands = { ...defaultDeps.commands, ...(depsOverride?.commands ?? {}) };
    const n = makeMessageGraphNodes(agent, deps);
    const g = new StateGraph(MessageState)
        .addNode('preprocess', n.preprocess)
        .addNode('forced_user_command', n.forcedUserCommand)
        .addNode('inject_behavior_log', n.injectBehaviorLog)
        .addNode('append_history', n.appendHistory)
        .addNode('complexity_classify', n.complexityClassify)
        .addNode('run_plan_execute', n.runPlanExecute)
        .addNode('run_direct_execute', n.runDirectExecute)
        .addEdge(START, 'preprocess')
        .addEdge('preprocess', 'forced_user_command')
        .addConditionalEdges('forced_user_command', n.routeAfterForced, {
        doneNode: END,
        continueNode: 'inject_behavior_log',
    })
        .addEdge('inject_behavior_log', 'append_history')
        .addEdge('append_history', 'complexity_classify')
        .addConditionalEdges('complexity_classify', n.routeAfterClassify, {
        planNode: 'run_plan_execute',
        directNode: 'run_direct_execute',
    })
        .addEdge('run_plan_execute', END)
        .addEdge('run_direct_execute', END);
    return g.compile();
}
