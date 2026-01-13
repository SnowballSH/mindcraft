import { classifyComplexity } from '../complexity_classifier.js';
import { decideDirectExecute } from '../direct_execute.js';
import { runPlanAndExecute as runPlanAndExecuteGraph } from '../plan_execute.js';
import type { AgentAdapter } from '../agent_adapter.js';
import type { MessageGraphDeps } from './deps.js';
import { MessageState } from './state.js';
import { getKey, hasKey } from '../../../src/utils/keys.js';

export function makeMessageGraphNodes(agent: AgentAdapter, deps: MessageGraphDeps) {
  function buildPersonaPreamble(): string {
    // We intentionally take ONLY the "persona/policy" part of the profile prompt.
    // The full profile.conversing contains dynamic placeholders ($STATS/$INVENTORY/...), which we do NOT want here.
    const raw = String((agent as any)?.prompter?.profile?.conversing ?? '');
    if (!raw) return '';

    // Cut before the dynamic sections if present.
    const cutMarkers = ['Summarized memory:', '$STATS', '$INVENTORY', '$COMMAND_DOCS', '$EXAMPLES', 'Conversation Begin:'];
    let cut = raw.length;
    for (const m of cutMarkers) {
      const idx = raw.indexOf(m);
      if (idx >= 0) cut = Math.min(cut, idx);
    }
    let s = raw.slice(0, cut);

    // Substitute name and drop other placeholders (e.g. $SELF_PROMPT).
    s = s.replaceAll('$NAME', String(agent.name ?? ''));
    s = s.replace(/\$[A-Z_]+/g, '');

    // Keep it small to avoid bloating controller prompts.
    s = s.trim();
    if (s.length > 1200) s = `${s.slice(0, 1200)}…`;
    return s;
  }

  const personaPreamble = buildPersonaPreamble();

  function nodeLog(node: string, extra?: Record<string, unknown>) {
    if (!deps.settings?.langgraph_node_logs) return;
    const base: Record<string, unknown> = { agent: agent.name };
    // Keep logs compact and grep-friendly
    console.log('[LangGraph][MessageGraph]', node, { ...base, ...(extra ?? {}) });
  }

  async function preprocess(state: typeof MessageState.State) {
    nodeLog('preprocess', { source: state.source });
    await agent.checkTaskDone();
    const selfPrompt = state.source === 'system' || state.source === agent.name;
    const fromOtherBot = deps.convoManager.isOtherAgent(state.source);

    const messageEn = await deps.handleEnglishTranslation(state.rawMessage);

    let maxResponses = state.maxResponses;
    if (maxResponses == null) {
      maxResponses = deps.settings.max_commands === -1 ? Number.POSITIVE_INFINITY : deps.settings.max_commands;
    }
    if (maxResponses === -1) maxResponses = Number.POSITIVE_INFINITY;
    if (!selfPrompt && agent.self_prompter?.isActive?.()) {
      maxResponses = 1;
    }

    return { selfPrompt, fromOtherBot, messageEn, maxResponses };
  }

  async function forcedUserCommand(state: typeof MessageState.State) {
    nodeLog('forced_user_command');
    if (state.selfPrompt || state.fromOtherBot) return {};
    const userCommandName = deps.commands.containsCommand(state.messageEn);
    if (!userCommandName) return {};

    if (!deps.commands.commandExists(userCommandName)) {
      await agent.routeResponse(state.source, `Command '${userCommandName}' does not exist.`);
      return { done: true };
    }

    await agent.routeResponse(state.source, `*${state.source} used ${userCommandName.substring(1)}*`);
    const result = await deps.commands.executeCommand(agent as unknown, state.messageEn);
    if (result) await agent.routeResponse(state.source, String(result));
    return { done: true, usedCommand: true };
  }

  async function injectBehaviorLog(_state: typeof MessageState.State) {
    nodeLog('inject_behavior_log');
    const behaviorLog = agent.bot?.modes?.flushBehaviorLog?.().trim?.() ?? '';
    if (behaviorLog && behaviorLog.length > 0) {
      const MAX_LOG = 500;
      const trimmed = behaviorLog.length > MAX_LOG ? `...${behaviorLog.substring(behaviorLog.length - MAX_LOG)}` : behaviorLog;
      await agent.history.add('system', `Recent behaviors log: \n${trimmed}`);
    }
    return {};
  }

  async function appendHistory(state: typeof MessageState.State) {
    nodeLog('append_history');
    await agent.history.add(state.source, state.messageEn);
    agent.history.save();
    return {};
  }

  async function complexityClassify(state: typeof MessageState.State) {
    nodeLog('complexity_classify');

    if (state.selfPrompt || state.fromOtherBot) {
      return { isComplex: false };
    }

    try {
      const out = await classifyComplexity(state.messageEn, {
        model: agent.prompter.chat_model,
        getCommandDocs: () => deps.commands.getCommandDocs(agent as unknown),
        personaPreamble,
      });
      return { isComplex: out.isComplex };
    } catch {
      nodeLog('failed to classify complexity')
      return { isComplex: false };
    }
  }

  async function runPlanExecute(state: typeof MessageState.State) {
    nodeLog('run_plan_execute', { recursionLimit: deps.settings.plan_execute_recursion_limit ?? 50 });

    // Build a LangChain Chat model for structured output/tool calling.
    // plan_execute requires this; if unavailable, we refuse to run plan_execute.
    let lcModel: any = undefined;
    const profileModel = String((agent as any)?.prompter?.profile?.model ?? '');
    const looksOpenAI = profileModel.includes('gpt') || profileModel.includes('o1') || profileModel.includes('o3') || profileModel.startsWith('openai/');
    const looksGemini = profileModel.includes('gemini') || profileModel.startsWith('google/');

    // OpenAI (ChatOpenAI)
    if (!lcModel && looksOpenAI && hasKey('OPENAI_API_KEY')) {
      try {
        const modelName = profileModel.replace(/^openai\//, '');
        const cacheKey = `_lcPlanModel:openai:${modelName}`;
        lcModel = (agent as any)[cacheKey];
        if (!lcModel) {
          const mod = await import('@langchain/openai');
          lcModel = new mod.ChatOpenAI({ modelName, temperature: 0, apiKey: getKey('OPENAI_API_KEY') });
          (agent as any)[cacheKey] = lcModel;
        }
        nodeLog('lcmodel_ready', { provider: 'openai', model: modelName });
      } catch (err) {
        nodeLog('lcmodel_build_failed', { provider: 'openai', err: String(err) });
      }
    }
    // Google Gemini (ChatGoogleGenerativeAI) - requires GOOGLE_API_KEY
    else if (!lcModel && looksGemini && hasKey('GEMINI_API_KEY')) {
      try {
        const modelName = profileModel.replace(/^google\//, '');
        const cacheKey = `_lcPlanModel:google:${modelName}`;
        lcModel = (agent as any)[cacheKey];
        if (!lcModel) {
          const mod = await import('@langchain/google-genai');
          lcModel = new mod.ChatGoogleGenerativeAI({
            model: modelName,
            temperature: 0,
            maxRetries: 2,
            apiKey: getKey('GEMINI_API_KEY'),
          });
          (agent as any)[cacheKey] = lcModel;
        }
        nodeLog('lcmodel_ready', { provider: 'google-genai', model: modelName });
      } catch (err) {
        nodeLog('lcmodel_build_failed', { provider: 'google-genai', err: String(err) });
      }
    }

    if (!lcModel) {
      nodeLog('plan_execute_no_lcmodel', { profileModel });
      await agent.routeResponse(
        state.source,
        `plan_execute is disabled because no LangChain model was constructed for profile model '${profileModel}'. ` +
          `Configure provider API keys / model so structured output is available.`,
      );
      return { done: true, usedCommand: false };
    }

    await runPlanAndExecuteGraph(
      agent,
      {
        lcModel,
        personaPreamble,
        getCommandDocs: () => deps.commands.getCommandDocs(agent as unknown),
        containsCommand: deps.commands.containsCommand,
        commandExists: deps.commands.commandExists,
        executeCommand: deps.commands.executeCommand,
        btRecursionLimit: (deps.settings as any)?.bt_recursion_limit ?? undefined,
        btMaxRepairs: (deps.settings as any)?.bt_max_repairs ?? undefined,
        btMaxNodes: (deps.settings as any)?.bt_max_nodes ?? undefined,
      },
      state.source,
      state.messageEn,
      { recursionLimit: deps.settings.plan_execute_recursion_limit ?? 50 },
    );
    return { done: true, usedCommand: true };
  }

  async function runDirectExecute(state: typeof MessageState.State) {
    nodeLog('run_direct_execute');
    try {
      const decision = await decideDirectExecute(state.messageEn, {
        model: agent.prompter.chat_model,
        getCommandDocs: () => deps.commands.getCommandDocs(agent as unknown),
        personaPreamble,
      });

      if (decision.decision === 'respond' && decision.response) {
        await agent.routeResponse(state.source, decision.response);
        return { done: true, usedCommand: false };
      }

      if (decision.decision === 'direct_command' && decision.command) {
        const cmdMsg = deps.commands.containsCommand(decision.command)
          ? decision.command
          : `!${decision.command.replace(/^!/, '')}`;
        const name = deps.commands.containsCommand(cmdMsg);
        if (!name || !deps.commands.commandExists(name)) {
          await agent.routeResponse(state.source, `I tried to run a command but it was invalid: ${cmdMsg}`);
          return { done: true, usedCommand: false };
        }

        if (deps.settings.show_command_syntax === 'full') {
          await agent.routeResponse(state.source, cmdMsg);
        } else if (deps.settings.show_command_syntax === 'shortened') {
          await agent.routeResponse(state.source, `*used ${name.substring(1)}*`);
        }

        const result = await deps.commands.executeCommand(agent as unknown, cmdMsg);
        if (result) {
          await agent.history.add('system', String(result));
          agent.history.save();
          await agent.routeResponse(state.source, String(result));
        } else {
          await agent.routeResponse(state.source, 'Done.');
        }
        return { done: true, usedCommand: true };
      }
    } catch {
      // fallthrough to legacy fallback below
    }

    const history = agent.history.getHistory();
    const res = await agent.prompter.promptConvo(history);
    if (!res || res.trim().length === 0) return { done: true };

    const commandName = deps.commands.containsCommand(res);
    if (!commandName) {
      await agent.routeResponse(state.source, res);
      return { done: true, usedCommand: false };
    }

    const truncated = deps.commands.truncCommandMessage(res);
    await agent.history.add(agent.name, truncated);

    if (!deps.commands.commandExists(commandName)) {
      await agent.history.add('system', `Command ${commandName} does not exist.`);
      return { done: true, usedCommand: false };
    }

    agent.self_prompter.handleUserPromptedCmd(state.selfPrompt, deps.commands.isAction(commandName));
    const execRes = await deps.commands.executeCommand(agent as unknown, truncated);
    if (execRes) await agent.history.add('system', String(execRes));
    agent.history.save();
    if (execRes) await agent.routeResponse(state.source, String(execRes));
    return { done: true, usedCommand: true };
  }

  function routeAfterForced(state: typeof MessageState.State) {
    nodeLog('route_after_forced', { done: state.done });
    return state.done ? 'doneNode' : 'continueNode';
  }

  function routeAfterClassify(state: typeof MessageState.State) {
    nodeLog('route_after_classify', { isComplex: state.isComplex });
    return state.isComplex ? 'planNode' : 'directNode';
  }

  return {
    preprocess,
    forcedUserCommand,
    injectBehaviorLog,
    appendHistory,
    complexityClassify,
    runPlanExecute,
    runDirectExecute,
    routeAfterForced,
    routeAfterClassify,
  };
}


