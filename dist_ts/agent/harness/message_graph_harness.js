import assert from 'node:assert/strict';
import { buildMessageGraph } from '../message_graph.js';
function makeAgentHarness() {
    const routed = [];
    const historyAdds = [];
    const execCalls = [];
    // Extremely small fake model that returns pre-seeded outputs.
    const modelOutputs = [];
    const fakeModel = {
        async sendRequest() {
            const out = modelOutputs.shift();
            if (out == null)
                throw new Error('No more fake model outputs in queue');
            return out;
        },
    };
    const agent = {
        name: 'TestBot',
        shut_up: false,
        history: {
            async add(role, content) {
                historyAdds.push({ role, content });
            },
            save() { },
            getHistory() {
                return historyAdds.map((x) => ({ role: x.role, content: x.content }));
            },
        },
        prompter: {
            chat_model: fakeModel,
            async promptConvo() {
                // Legacy fallback should rarely be used in these tests
                return '';
            },
        },
        self_prompter: {
            shouldInterrupt() {
                return false;
            },
            isActive() {
                return false;
            },
            handleUserPromptedCmd() { },
        },
        bot: {
            modes: {
                flushBehaviorLog() {
                    return '';
                },
            },
        },
        async checkTaskDone() { },
        async routeResponse(toPlayer, message) {
            routed.push({ to: toPlayer, msg: message });
        },
    };
    const deps = {
        settings: {
            // mimic src/agent/settings.js object shape, only fields needed by message_graph
            max_commands: -1,
            plan_execute_enabled: true,
            plan_execute_recursion_limit: 10,
        },
        convoManager: {
            isOtherAgent() {
                return false;
            },
            responseScheduledFor() {
                return false;
            },
        },
        handleEnglishTranslation: async (m) => m,
        commands: {
            containsCommand: (msg) => {
                const m = msg.match(/!(\w+)/);
                return m ? `!${m[1]}` : null;
            },
            commandExists: (name) => name === '!stats' || name === '!stop',
            executeCommand: async (_agent, message) => {
                execCalls.push({ message });
                if (message.includes('!stop'))
                    return 'Stopped.';
                if (message.includes('!stats'))
                    return 'Stats.';
                return 'Done.';
            },
            getCommandDocs: () => '!stats()\\n!stop()',
            truncCommandMessage: (s) => s,
            isAction: () => true,
        },
    };
    return { agent, deps, routed, historyAdds, execCalls, modelOutputs };
}
async function run() {
    // NOTE: These tests validate the new LangGraph flow at a high level.
    // They intentionally do not require a running Minecraft server.
    {
        // Forced user command should bypass planning/classification
        const h = makeAgentHarness();
        const app = buildMessageGraph(h.agent, h.deps);
        await app.invoke({
            source: 'User',
            rawMessage: '!stop()',
            maxResponses: 1,
            responsesSoFar: 0,
            done: false,
            usedCommand: false,
            isComplex: false,
        });
        assert.ok(h.execCalls.some((c) => c.message.includes('!stop')));
        assert.ok(h.routed.some((x) => x.msg.includes('*User used stop*')));
        assert.ok(h.routed.some((x) => x.msg === 'Stopped.'));
    }
    {
        // Not complex -> respond (classifier false, direct_execute respond)
        const h = makeAgentHarness();
        // complexity classifier output
        h.modelOutputs.push('{"isComplex": false, "reason": "simple question"}');
        // direct execute decision output
        h.modelOutputs.push('{"decision": "respond", "response": "Hello!"}');
        const app = buildMessageGraph(h.agent, h.deps);
        await app.invoke({ source: 'User', rawMessage: 'Hi there', maxResponses: 1, responsesSoFar: 0, done: false, usedCommand: false, isComplex: false });
        assert.equal(h.routed.length, 1);
        assert.equal(h.routed[0]?.msg, 'Hello!');
    }
    {
        // Not complex -> direct_command
        const h = makeAgentHarness();
        h.modelOutputs.push('{"isComplex": false, "reason": "simple action"}');
        h.modelOutputs.push('{"decision": "direct_command", "command": "!stats()"}');
        const app = buildMessageGraph(h.agent, h.deps);
        await app.invoke({
            source: 'User',
            rawMessage: 'Show stats',
            maxResponses: 1,
            responsesSoFar: 0,
            done: false,
            usedCommand: false,
            isComplex: false,
        });
        assert.ok(h.execCalls.some((c) => c.message.includes('!stats')));
        assert.ok(h.routed.some((x) => x.msg === 'Stats.'));
    }
    {
        // Not complex -> invalid direct_command should be handled safely
        const h = makeAgentHarness();
        h.modelOutputs.push('{"isComplex": false}');
        h.modelOutputs.push('{"decision": "direct_command", "command": "!nope()"}');
        const app = buildMessageGraph(h.agent, h.deps);
        await app.invoke({
            source: 'User',
            rawMessage: 'Do the thing',
            maxResponses: 1,
            responsesSoFar: 0,
            done: false,
            usedCommand: false,
            isComplex: false,
        });
        assert.ok(h.routed.some((x) => x.msg.includes('invalid')));
        assert.equal(h.execCalls.length, 0);
    }
    {
        // Complex -> plan/execute path should at least emit a Plan: message (planner output)
        const h = makeAgentHarness();
        h.modelOutputs.push('{"isComplex": true, "reason": "multi-step"}');
        // planner steps
        h.modelOutputs.push('{"steps":["Do X","Do Y"]}');
        // step->command for X
        h.modelOutputs.push('{"command":"!stats()"}');
        // replan says done
        h.modelOutputs.push('{"action":"response","response":"Done."}');
        const app = buildMessageGraph(h.agent, h.deps);
        await app.invoke({ source: 'User', rawMessage: 'Do a complex thing', maxResponses: 1, responsesSoFar: 0, done: false, usedCommand: false, isComplex: false });
        // At least these should be routed
        assert.ok(h.routed.some((x) => x.msg.startsWith('Plan: ')));
        assert.ok(h.routed.some((x) => x.msg === 'Done.'));
    }
    console.log('message_graph_harness: OK');
}
run().catch((err) => {
    console.error('message_graph_harness: FAILED', err);
    process.exit(1);
});
