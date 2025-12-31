import { readFileSync, mkdirSync, writeFileSync} from 'fs';
import { Examples } from '../utils/examples.js';
import { getCommandDocs, getCommandToolSpecs, formatCommandFromArgs } from '../agent/commands/index.js';
import { SkillLibrary } from "../agent/library/skill_library.js";
import { stringifyTurns } from '../utils/text.js';
import { getCommand } from '../agent/commands/index.js';
import settings from '../agent/settings.js';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { selectAPI, createModel } from './_model_map.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FUNCTION_CALL_PROMPT = [
    'You are FunctionGemma, a function-calling assistant for a Minecraft bot.',
    'Choose the single best command to execute based on the thinker intent and the context.',
    'Respond with exactly one command using this format: !commandName or !commandName("arg", 1.2).',
    'If no command is required, respond with NO_COMMAND.',
    'Do not add any other text.',
    'Thinker intent: $FUNCTION_INTENT',
    '$STATS',
    '$INVENTORY',
    '$COMMAND_DOCS',
    '$CONVO'
].join('\n');
const DEFAULT_FUNCTION_CALL_PROMPT_TOOLS = [
    'You are a model that can do function calling with the following functions.',
    'Select exactly one function to call based on the user request.',
    'Return only the function call and no other text.',
    'If no function applies, respond with NO_FUNCTION.',
].join('\n');
const DEFAULT_FUNCTION_CALL_USER_PROMPT_TOOLS = [
    'Thinker intent: $FUNCTION_INTENT',
    '$STATS',
    '$INVENTORY'
].join('\n');
const FUNCTION_CALLING_INSTRUCTIONS = [
    'When you need to take an action, do not write the !command yourself (this overrides any instruction about writing commands directly).',
    'Instead write a single line starting with @function_gemma followed by your intent and key parameters.',
    'Example: @function_gemma go to player "steve" and stay within 2 blocks.',
    'If no action is needed, respond normally.'
].join(' ');

function parseFunctionGemmaCall(text) {
    if (!text) {
        return null;
    }
    const start = text.indexOf('<start_function_call>');
    const end = text.indexOf('<end_function_call>');
    if (start === -1 || end === -1 || end <= start) {
        return null;
    }
    const inner = text.slice(start + '<start_function_call>'.length, end).trim();
    const callPrefix = 'call:';
    const callStart = inner.startsWith(callPrefix) ? inner.slice(callPrefix.length) : inner;
    const nameEnd = callStart.indexOf('{');
    const fnName = nameEnd === -1 ? callStart.trim() : callStart.slice(0, nameEnd).trim();
    const argsSection = nameEnd === -1 ? '' : callStart.slice(nameEnd + 1, callStart.lastIndexOf('}')).trim();
    if (!fnName) {
        return null;
    }
    if (!argsSection) {
        return { name: fnName, args: {} };
    }
    const args = {};
    const regex = /(\w+):(?:(<escape>)([\s\S]*?)<escape>|([^,}]+))/g;
    let match;
    while ((match = regex.exec(argsSection)) !== null) {
        const key = match[1];
        let value = null;
        if (match[2]) {
            value = match[3] ?? '';
        } else {
            const raw = (match[4] || '').trim();
            if (raw === 'true') {
                value = true;
            } else if (raw === 'false') {
                value = false;
            } else if (raw !== '' && !Number.isNaN(Number(raw))) {
                value = Number(raw);
            } else {
                value = raw;
            }
        }
        args[key] = value;
    }
    return { name: fnName, args };
}

export class Prompter {
    constructor(agent, profile) {
        this.agent = agent;
        this.profile = profile;
        let default_profile = JSON.parse(readFileSync('./profiles/defaults/_default.json', 'utf8'));
        let base_fp = '';
        if (settings.base_profile.includes('survival')) {
            base_fp = './profiles/defaults/survival.json';
        } else if (settings.base_profile.includes('assistant')) {
            base_fp = './profiles/defaults/assistant.json';
        } else if (settings.base_profile.includes('creative')) {
            base_fp = './profiles/defaults/creative.json';
        } else if (settings.base_profile.includes('god_mode')) {
            base_fp = './profiles/defaults/god_mode.json';
        }
        let base_profile = JSON.parse(readFileSync(base_fp, 'utf8'));

        // first use defaults to fill in missing values in the base profile
        for (let key in default_profile) {
            if (base_profile[key] === undefined)
                base_profile[key] = default_profile[key];
        }
        // then use base profile to fill in missing values in the individual profile
        for (let key in base_profile) {
            if (this.profile[key] === undefined)
                this.profile[key] = base_profile[key];
        }
        // base overrides default, individual overrides base

        this.convo_examples = null;
        this.coding_examples = null;
        
        let name = this.profile.name;
        this.cooldown = this.profile.cooldown ? this.profile.cooldown : 0;
        this.last_prompt_time = 0;
        this.awaiting_coding = false;

        // for backwards compatibility, move max_tokens to params
        let max_tokens = null;
        if (this.profile.max_tokens)
            max_tokens = this.profile.max_tokens;

        let chat_model_profile = selectAPI(this.profile.model);
        this.chat_model = createModel(chat_model_profile);

        if (this.profile.code_model) {
            let code_model_profile = selectAPI(this.profile.code_model);
            this.code_model = createModel(code_model_profile);
        }
        else {
            this.code_model = this.chat_model;
        }

        if (this.profile.vision_model) {
            let vision_model_profile = selectAPI(this.profile.vision_model);
            this.vision_model = createModel(vision_model_profile);
        }
        else {
            this.vision_model = this.chat_model;
        }

        
        let embedding_model_profile = null;
        if (this.profile.embedding) {
            try {
                embedding_model_profile = selectAPI(this.profile.embedding);
            } catch (e) {
                embedding_model_profile = null;
            }
        }
        if (embedding_model_profile) {
            this.embedding_model = createModel(embedding_model_profile);
        }
        else {
            this.embedding_model = createModel({api: chat_model_profile.api});
        }

        this.function_model = null;
        this.function_call_prompt = this.profile.function_call_prompt || DEFAULT_FUNCTION_CALL_PROMPT;
        this.function_call_prompt_tools = this.profile.function_call_prompt_tools || DEFAULT_FUNCTION_CALL_PROMPT_TOOLS;
        this.function_call_user_prompt_tools = this.profile.function_call_user_prompt_tools || DEFAULT_FUNCTION_CALL_USER_PROMPT_TOOLS;
        this.function_cooldown = this.profile.function_cooldown ?? 0;
        this.last_function_prompt_time = 0;
        const function_model_profile = this.profile.function_model || settings.function_model;
        if (function_model_profile) {
            try {
                let function_profile = typeof function_model_profile === 'string'
                    ? { model: function_model_profile }
                    : { ...function_model_profile };
                function_profile = selectAPI(function_profile);
                this.function_model = createModel(function_profile);
            } catch (error) {
                console.warn('Failed to initialize function model:', error?.message || error);
            }
        }

        this.skill_libary = new SkillLibrary(agent, this.embedding_model);
        mkdirSync(`./bots/${name}`, { recursive: true });
        writeFileSync(`./bots/${name}/last_profile.json`, JSON.stringify(this.profile, null, 4), (err) => {
            if (err) {
                throw new Error('Failed to save profile:', err);
            }
            console.log("Copy profile saved.");
        });
    }

    getName() {
        return this.profile.name;
    }

    getInitModes() {
        return this.profile.modes;
    }

    async initExamples() {
        try {
            this.convo_examples = new Examples(this.embedding_model, settings.num_examples);
            this.coding_examples = new Examples(this.embedding_model, settings.num_examples);
            
            // Wait for both examples to load before proceeding
            await Promise.all([
                this.convo_examples.load(this.profile.conversation_examples),
                this.coding_examples.load(this.profile.coding_examples),
                this.skill_libary.initSkillLibrary()
            ]).catch(error => {
                // Preserve error details
                console.error('Failed to initialize examples. Error details:', error);
                console.error('Stack trace:', error.stack);
                throw error;
            });

            console.log('Examples initialized.');
        } catch (error) {
            console.error('Failed to initialize examples:', error);
            console.error('Stack trace:', error.stack);
            throw error; // Re-throw with preserved details
        }
    }

    async replaceStrings(prompt, messages, examples=null, to_summarize=[], last_goals=null, function_intent=null) {
        prompt = prompt.replaceAll('$NAME', this.agent.name);

        if (prompt.includes('$STATS')) {
            let stats = await getCommand('!stats').perform(this.agent) + '\n';
            stats += await getCommand('!entities').perform(this.agent) + '\n';
            stats += await getCommand('!nearbyBlocks').perform(this.agent);
            prompt = prompt.replaceAll('$STATS', stats);
        }
        if (prompt.includes('$INVENTORY')) {
            let inventory = await getCommand('!inventory').perform(this.agent);
            prompt = prompt.replaceAll('$INVENTORY', inventory);
        }
        if (prompt.includes('$ACTION')) {
            prompt = prompt.replaceAll('$ACTION', this.agent.actions.currentActionLabel);
        }
        if (prompt.includes('$COMMAND_DOCS'))
            prompt = prompt.replaceAll('$COMMAND_DOCS', getCommandDocs(this.agent));
        if (prompt.includes('$FUNCTION_CALLING')) {
            const instructions = this.function_model ? FUNCTION_CALLING_INSTRUCTIONS : '';
            prompt = prompt.replaceAll('$FUNCTION_CALLING', instructions);
        }
        if (prompt.includes('$FUNCTION_INTENT')) {
            prompt = prompt.replaceAll('$FUNCTION_INTENT', function_intent || '');
        }
        if (prompt.includes('$CODE_DOCS')) {
            const code_task_content = messages.slice().reverse().find(msg =>
                msg.role !== 'system' && msg.content.includes('!newAction(')
            )?.content?.match(/!newAction\((.*?)\)/)?.[1] || '';

            prompt = prompt.replaceAll(
                '$CODE_DOCS',
                await this.skill_libary.getRelevantSkillDocs(code_task_content, settings.relevant_docs_count)
            );
        }
        if (prompt.includes('$EXAMPLES') && examples !== null)
            prompt = prompt.replaceAll('$EXAMPLES', await examples.createExampleMessage(messages));
        if (prompt.includes('$MEMORY'))
            prompt = prompt.replaceAll('$MEMORY', this.agent.history.memory);
        if (prompt.includes('$TO_SUMMARIZE'))
            prompt = prompt.replaceAll('$TO_SUMMARIZE', stringifyTurns(to_summarize));
        if (prompt.includes('$CONVO'))
            prompt = prompt.replaceAll('$CONVO', 'Recent conversation:\n' + stringifyTurns(messages));
        if (prompt.includes('$SELF_PROMPT')) {
            // if active or paused, show the current goal
            let self_prompt = !this.agent.self_prompter.isStopped() ? `YOUR CURRENT ASSIGNED GOAL: "${this.agent.self_prompter.prompt}"\n` : '';
            prompt = prompt.replaceAll('$SELF_PROMPT', self_prompt);
        }
        if (prompt.includes('$LAST_GOALS')) {
            let goal_text = '';
            for (let goal in last_goals) {
                if (last_goals[goal])
                    goal_text += `You recently successfully completed the goal ${goal}.\n`
                else
                    goal_text += `You recently failed to complete the goal ${goal}.\n`
            }
            prompt = prompt.replaceAll('$LAST_GOALS', goal_text.trim());
        }
        if (prompt.includes('$BLUEPRINTS')) {
            if (this.agent.npc.constructions) {
                let blueprints = '';
                for (let blueprint in this.agent.npc.constructions) {
                    blueprints += blueprint + ', ';
                }
                prompt = prompt.replaceAll('$BLUEPRINTS', blueprints.slice(0, -2));
            }
        }

        // check if there are any remaining placeholders with syntax $<word>
        let remaining = prompt.match(/\$[A-Z_]+/g);
        if (remaining !== null) {
            console.warn('Unknown prompt placeholders:', remaining.join(', '));
        }
        return prompt;
    }

    async checkCooldown() {
        let elapsed = Date.now() - this.last_prompt_time;
        if (elapsed < this.cooldown && this.cooldown > 0) {
            await new Promise(r => setTimeout(r, this.cooldown - elapsed));
        }
        this.last_prompt_time = Date.now();
    }

    async checkFunctionCooldown() {
        let elapsed = Date.now() - this.last_function_prompt_time;
        if (elapsed < this.function_cooldown && this.function_cooldown > 0) {
            await new Promise(r => setTimeout(r, this.function_cooldown - elapsed));
        }
        this.last_function_prompt_time = Date.now();
    }

    async promptConvo(messages) {
        this.most_recent_msg_time = Date.now();
        let current_msg_time = this.most_recent_msg_time;

        for (let i = 0; i < 3; i++) { // try 3 times to avoid hallucinations
            await this.checkCooldown();
            if (current_msg_time !== this.most_recent_msg_time) {
                return '';
            }

            let prompt = this.profile.conversing;
            prompt = await this.replaceStrings(prompt, messages, this.convo_examples);
            let generation;

            try {
                generation = await this.chat_model.sendRequest(messages, prompt);
                if (typeof generation !== 'string') {
                    console.error('Error: Generated response is not a string', generation);
                    throw new Error('Generated response is not a string');
                }
                console.log("Generated response:", generation);
                await this._saveLog(prompt, messages, generation, 'conversation');

            } catch (error) {
                console.error('Error during message generation or file writing:', error);
                continue;
            }

            // Check for hallucination or invalid output
            if (generation?.includes('(FROM OTHER BOT)')) {
                console.warn('LLM hallucinated message as another bot. Trying again...');
                continue;
            }

            if (current_msg_time !== this.most_recent_msg_time) {
                console.warn(`${this.agent.name} received new message while generating, discarding old response.`);
                return '';
            }

            if (generation?.includes('</think>')) {
                const [_, afterThink] = generation.split('</think>')
                generation = afterThink
            }

            return generation;
        }

        return '';
    }

    async promptFunctionCall(intent, messages) {
        if (!this.function_model) {
            return null;
        }
        await this.checkFunctionCooldown();
        let prompt = this.function_call_prompt || DEFAULT_FUNCTION_CALL_PROMPT;
        prompt = await this.replaceStrings(prompt, messages, null, null, null, intent);

        let rawResponse = '';
        let toolCalls = null;
        if (typeof this.function_model.sendToolRequest === 'function') {
            const isLMStudio = this.function_model?.constructor?.prefix === 'lmstudio';
            const paramNameTransform = isLMStudio
                ? (paramName) => (paramName === 'type' ? 'type_name' : paramName)
                : null;
            const toolPrompt = this.function_call_prompt_tools || DEFAULT_FUNCTION_CALL_PROMPT_TOOLS;
            const toolPromptResolved = await this.replaceStrings(toolPrompt, null, null, null, null, intent);
            const toolUserPrompt = this.function_call_user_prompt_tools || DEFAULT_FUNCTION_CALL_USER_PROMPT_TOOLS;
            const toolUserPromptResolved = await this.replaceStrings(toolUserPrompt, messages, null, null, null, intent);
            const { tools, paramNameMap } = getCommandToolSpecs(this.agent, { paramNameTransform });
            if (tools.length > 0) {
                const toolResponse = await this.function_model.sendToolRequest([{ role: 'user', content: toolUserPromptResolved }], toolPromptResolved, tools);
                if (toolResponse?.error) {
                    rawResponse = '';
                } else {
                    rawResponse = toolResponse?.content ?? '';
                }
                toolCalls = toolResponse?.tool_calls || null;

                if (toolCalls && toolCalls.length > 0) {
                    const toolCall = toolCalls[0];
                    let args = null;
                    try {
                        args = toolCall?.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};
                    } catch (err) {
                        args = null;
                    }
                    if (args && toolCall?.function?.name && paramNameMap?.[toolCall.function.name]) {
                        const remapped = {};
                        for (const [key, value] of Object.entries(args)) {
                            const originalKey = paramNameMap[toolCall.function.name][key] || key;
                            remapped[originalKey] = value;
                        }
                        args = remapped;
                    }
                    const command = formatCommandFromArgs(toolCall?.function?.name, args);
                    if (command) {
                        await this._saveLog(prompt, messages, JSON.stringify({ tool_calls: toolCalls, command }), 'function_call');
                        return command;
                    }
                }
            }
        }

        const tokenCall = parseFunctionGemmaCall(rawResponse);
        if (tokenCall) {
            const command = formatCommandFromArgs(tokenCall.name, tokenCall.args);
            if (command) {
                await this._saveLog(prompt, messages, JSON.stringify({ token_call: tokenCall, command }), 'function_call');
                return command;
            }
        }

        if (!rawResponse) {
            rawResponse = await this.function_model.sendRequest([], prompt);
        }
        if (rawResponse?.includes('</think>')) {
            rawResponse = rawResponse.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        }
        const fallbackTokenCall = parseFunctionGemmaCall(rawResponse);
        if (fallbackTokenCall) {
            const command = formatCommandFromArgs(fallbackTokenCall.name, fallbackTokenCall.args);
            if (command) {
                await this._saveLog(prompt, messages, JSON.stringify({ token_call: fallbackTokenCall, command }), 'function_call');
                return command;
            }
        }
        await this._saveLog(prompt, messages, rawResponse, 'function_call');
        return rawResponse;
    }

    async promptCoding(messages) {
        if (this.awaiting_coding) {
            console.warn('Already awaiting coding response, returning no response.');
            return '```//no response```';
        }
        this.awaiting_coding = true;
        await this.checkCooldown();
        let prompt = this.profile.coding;
        prompt = await this.replaceStrings(prompt, messages, this.coding_examples);

        let resp = await this.code_model.sendRequest(messages, prompt);
        this.awaiting_coding = false;
        await this._saveLog(prompt, messages, resp, 'coding');
        return resp;
    }

    async promptMemSaving(to_summarize) {
        await this.checkCooldown();
        let prompt = this.profile.saving_memory;
        prompt = await this.replaceStrings(prompt, null, null, to_summarize);
        let resp = await this.chat_model.sendRequest([], prompt);
        await this._saveLog(prompt, to_summarize, resp, 'memSaving');
        if (resp?.includes('</think>')) {
            const [_, afterThink] = resp.split('</think>')
            resp = afterThink;
        }
        return resp;
    }

    async promptShouldRespondToBot(new_message) {
        await this.checkCooldown();
        let prompt = this.profile.bot_responder;
        let messages = this.agent.history.getHistory();
        messages.push({role: 'user', content: new_message});
        prompt = await this.replaceStrings(prompt, null, null, messages);
        let res = await this.chat_model.sendRequest([], prompt);
        return res.trim().toLowerCase() === 'respond';
    }

    async promptVision(messages, imageBuffer) {
        await this.checkCooldown();
        let prompt = this.profile.image_analysis;
        prompt = await this.replaceStrings(prompt, messages, null, null, null);
        return await this.vision_model.sendVisionRequest(messages, prompt, imageBuffer);
    }

    async promptGoalSetting(messages, last_goals) {
        // deprecated
        let system_message = this.profile.goal_setting;
        system_message = await this.replaceStrings(system_message, messages);

        let user_message = 'Use the below info to determine what goal to target next\n\n';
        user_message += '$LAST_GOALS\n$STATS\n$INVENTORY\n$CONVO'
        user_message = await this.replaceStrings(user_message, messages, null, null, last_goals);
        let user_messages = [{role: 'user', content: user_message}];

        let res = await this.chat_model.sendRequest(user_messages, system_message);

        let goal = null;
        try {
            let data = res.split('```')[1].replace('json', '').trim();
            goal = JSON.parse(data);
        } catch (err) {
            console.log('Failed to parse goal:', res, err);
        }
        if (!goal || !goal.name || !goal.quantity || isNaN(parseInt(goal.quantity))) {
            console.log('Failed to set goal:', res);
            return null;
        }
        goal.quantity = parseInt(goal.quantity);
        return goal;
    }

    async _saveLog(prompt, messages, generation, tag) {
        if (!settings.log_all_prompts)
            return;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        let logEntry;
        let task_id = this.agent.task.task_id;
        if (task_id == null) {
            logEntry = `[${timestamp}] \nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        } else {
            logEntry = `[${timestamp}] Task ID: ${task_id}\nPrompt:\n${prompt}\n\nConversation:\n${JSON.stringify(messages, null, 2)}\n\nResponse:\n${generation}\n\n`;
        }
        const logFile = `${tag}_${timestamp}.txt`;
        await this._saveToFile(logFile, logEntry);
    }

    async _saveToFile(logFile, logEntry) {
        let task_id = this.agent.task.task_id;
        let logDir;
        if (task_id == null) {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs`);
        } else {
            logDir = path.join(__dirname, `../../bots/${this.agent.name}/logs/${task_id}`);
        }

        await fs.mkdir(logDir, { recursive: true });

        logFile = path.join(logDir, logFile);
        await fs.appendFile(logFile, String(logEntry), 'utf-8');
    }
}
