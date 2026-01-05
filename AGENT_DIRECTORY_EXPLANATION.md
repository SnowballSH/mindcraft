# Agent Directory Structure & Customization Guide

## Overview

The `src/agent/` directory contains the core agentic AI system for Minecraft NPCs. This system enables NPCs to perceive the world, make decisions, execute actions, remember experiences, and interact with players and other agents.

---

## Core Modules

### 1. **agent.js** - Main Agent Controller
**Purpose**: The central orchestrator that initializes and coordinates all agent subsystems.

**Key Responsibilities**:
- Initializes all components (prompter, history, coder, NPC controller, memory, etc.)
- Manages bot connection and lifecycle (login, spawn, disconnect)
- Handles message routing and conversation flow
- Coordinates event handlers (death, health, time, etc.)
- Manages task execution and completion checking
- Updates agent state every 300ms

**Key Methods**:
- `start()` - Initializes the agent and connects to Minecraft
- `handleMessage()` - Processes incoming messages and generates responses
- `routeResponse()` - Routes agent responses to appropriate channels
- `update()` - Main update loop for continuous agent behavior

---

### 2. **action_manager.js** - Action Execution System
**Purpose**: Manages the execution of agent actions with timeout protection and interruption handling.

**Key Features**:
- Executes actions with configurable timeouts (default 10 minutes)
- Detects and prevents infinite action loops
- Handles action interruption and resumption
- Provides action status reports (success, interrupted, timed out)
- Manages concurrent action execution safely

**Key Methods**:
- `runAction()` - Execute an action with optional timeout
- `stop()` - Force stop current action
- `resumeAction()` - Resume a previously interrupted action

**Customization**: Modify timeout values, add custom action validation, or extend interruption logic.

---

### 3. **self_prompter.js** - Autonomous Goal Pursuit
**Purpose**: Enables the agent to autonomously pursue goals without external prompting.

**Key Features**:
- Three states: STOPPED, ACTIVE, PAUSED
- Automatically prompts the agent when idle
- Pauses during conversations or user interactions
- Configurable cooldown between self-prompts (default 2 seconds)
- Stops if agent fails to use commands after 3 attempts

**Key Methods**:
- `start(prompt)` - Begin self-prompting with a goal
- `stop()` - Stop self-prompting
- `pause()` - Temporarily pause (e.g., during conversation)
- `update(delta)` - Auto-restart loop when idle

**Customization**: 
- Adjust `cooldown` (line 12) for prompt frequency
- Modify `MAX_NO_COMMAND` (line 64) for tolerance
- Change idle detection logic in `update()`

---

### 4. **conversation.js** - Multi-Agent Communication
**Purpose**: Manages conversations between agents and coordinates message flow.

**Key Features**:
- Handles bot-to-bot conversations via whispers
- Queues messages during busy periods
- Monitors conversation health (timeouts, disconnections)
- Automatically pauses self-prompting during conversations
- Smart response scheduling based on agent busy states

**Key Classes**:
- `ConversationManager` - Manages all active conversations
- `Conversation` - Individual conversation state

**Customization**:
- Adjust `WAIT_TIME_START` (line 44) for response timeout
- Modify `fastDelay`/`longDelay` (lines 271-272) for response timing
- Add custom conversation rules in `_scheduleProcessInMessage()`

---

### 5. **history.js** - Memory & Context Management
**Purpose**: Manages conversation history and long-term memory compression.

**Key Features**:
- Maintains conversation turns (system/user/assistant messages)
- Automatically summarizes old messages into compressed memory
- Saves full history to timestamped JSON files
- Loads previous state on restart
- Configurable message limits (default from settings)

**Key Methods**:
- `add()` - Add message to history
- `getHistory()` - Get current conversation context
- `summarizeMemories()` - Compress old messages using LLM
- `save()`/`load()` - Persist agent state

**Customization**:
- Adjust `max_messages` (from settings) for context window size
- Modify `summary_chunk_size` (line 24) for compression frequency
- Change memory truncation length (line 38)

---

### 6. **memory_bank.js** - Spatial Memory
**Purpose**: Stores and retrieves named locations (e.g., "last_death_position", "home").

**Key Features**:
- Simple key-value store for 3D coordinates
- Persisted to JSON
- Used for remembering important places

**Key Methods**:
- `rememberPlace(name, x, y, z)` - Save a location
- `recallPlace(name)` - Retrieve a location

**Customization**: Extend to store more complex spatial data (regions, paths, etc.)

---

### 7. **coder.js** - Code Generation & Execution
**Purpose**: Generates and executes JavaScript code for complex actions.

**Key Features**:
- Uses LLM to generate code from natural language
- Validates code with ESLint
- Executes code in a sandboxed environment (lockdown.js)
- Provides access to skills and world libraries
- Retries on errors (up to 5 attempts)

**Key Methods**:
- `generateCode()` - Generate code from conversation history
- `_stageCode()` - Prepare code for execution
- `_lintCode()` - Validate code syntax and function calls

**Customization**:
- Modify code templates in `bots/execTemplate.js` and `bots/lintTemplate.js`
- Add/remove exposed libraries in `_stageCode()` (line 186-191)
- Adjust retry logic and error handling

---

### 8. **modes.js** - Reactive Behavior System
**Purpose**: Defines reactive behaviors that trigger automatically based on world state.

**Available Modes**:
1. **self_preservation** - Responds to drowning, fire, low health
2. **unstuck** - Detects and resolves stuck situations
3. **cowardice** - Runs away from enemies
4. **self_defense** - Attacks nearby enemies
5. **hunting** - Hunts animals when idle
6. **item_collecting** - Picks up nearby items
7. **torch_placing** - Places torches in dark areas
8. **elbow_room** - Moves away from nearby players
9. **idle_staring** - Looks around when idle (animation)
10. **cheat** - Enables instant block placement/teleportation

**Key Features**:
- Modes run every tick (~300ms)
- Priority-based execution (first in list = highest priority)
- Can interrupt actions or run only when idle
- Configurable on/off state per mode

**Customization**:
- Add new modes to `modes_list` (line 24)
- Modify mode priorities by reordering the list
- Adjust mode parameters (distances, cooldowns, etc.)
- Change interrupt behavior via `interrupts` field

---

### 9. **npc/controller.js** - NPC Goal System
**Purpose**: Manages NPC-specific goals like building structures and collecting items.

**Key Features**:
- Manages construction goals (build houses, shelters)
- Handles item collection goals
- Tracks built structures and their positions
- Implements daily routines (work during day, sleep at night)
- Auto-sets goals using LLM when idle

**Key Classes**:
- `NPCContoller` - Main controller
- `ItemGoal` - Handles item collection
- `BuildGoal` - Handles construction

**Customization**:
- Add new construction templates in `npc/construction/`
- Modify goal setting logic in `setGoal()`
- Adjust routine timing in `executeNext()`
- Change home/building detection logic

---

### 10. **commands/** - Command System
**Purpose**: Defines actions and queries the agent can execute.

**Structure**:
- `index.js` - Command parsing and routing
- `actions.js` - Action commands (!newAction, !stop, !followPlayer, etc.)
- `queries.js` - Query commands (!inventory, !nearby, !stats, etc.)

**Key Features**:
- Commands use syntax: `!commandName(arg1, arg2)`
- Supports string, number, and boolean arguments
- Commands can be blacklisted via settings
- Some commands are unblockable (!stop, !stats, !inventory, !goal)

**Customization**:
- Add new commands in `actions.js` or `queries.js`
- Modify command parsing in `index.js`
- Add command validation or permission checks

---

### 11. **library/** - Action Primitives
**Purpose**: Provides low-level functions for agent actions.

**Key Modules**:
- `skills.js` - Action primitives (craft, mine, place blocks, attack, etc.)
- `world.js` - World query functions (find blocks, entities, paths, etc.)
- `lockdown.js` - Code sandboxing for generated code
- `skill_library.js` - Documentation generator for LLM

**Customization**:
- Add new skills in `skills.js`
- Extend world queries in `world.js`
- Modify sandbox permissions in `lockdown.js`

---

### 12. **tasks/** - Task System
**Purpose**: Defines and validates structured tasks for the agent.

**Key Files**:
- `tasks.js` - Main task class and validation
- `construction_tasks.js` - Building/construction task validation
- `cooking_tasks.js` - Cooking task validation

**Key Features**:
- Tasks define objectives and success criteria
- Validates task completion
- Tracks task progress
- Can block certain actions during tasks

**Customization**:
- Add new task types
- Modify validation logic
- Add custom scoring mechanisms

---

### 13. **vision/** - Visual Perception
**Purpose**: Enables the agent to "see" the world using vision models.

**Key Files**:
- `vision_interpreter.js` - Main vision interface
- `camera.js` - Screenshot capture
- `browser_viewer.js` - 3D visualization

**Key Features**:
- Captures screenshots from bot's perspective
- Sends images to vision-capable LLMs for analysis
- Can look at players or positions
- Provides block information at cursor

**Customization**:
- Adjust screenshot frequency/quality
- Modify vision prompts
- Add new vision queries

---

### 14. **settings.js** - Configuration
**Purpose**: Lightweight settings object shared across modules.

**Usage**: Imported and populated from main settings file.

---

### 15. **connection_handler.js** - Connection Management
**Purpose**: Handles bot connection, disconnection, and error logging.

**Key Features**:
- Validates bot names
- Logs connection events
- Handles disconnection gracefully
- Manages spawn timeouts

---

### 16. **speak.js** - Text-to-Speech
**Purpose**: Converts agent messages to speech (if enabled).

---

### 17. **mindserver_proxy.js** - Server Communication
**Purpose**: Communicates with the mindserver for multi-agent coordination.

---

## How to Customize Agentic Features

### 1. **Modify Agent Behavior (Modes)**
Edit `modes.js` to:
- Enable/disable specific reactive behaviors
- Adjust behavior parameters (distances, cooldowns)
- Add new reactive behaviors
- Change behavior priorities

**Example**: Make agent more aggressive
```javascript
// In modes.js, modify self_defense mode
update: async function (agent) {
    const enemy = world.getNearestEntityWhere(agent.bot, entity => mc.isHostile(entity), 16); // Increased from 8
    // ...
}
```

---

### 2. **Customize Self-Prompting**
Edit `self_prompter.js` to:
- Change prompt frequency (`cooldown`)
- Adjust failure tolerance (`MAX_NO_COMMAND`)
- Modify idle detection logic
- Add custom prompt templates

**Example**: Make agent more proactive
```javascript
this.cooldown = 1000; // Prompt every 1 second instead of 2
```

---

### 3. **Add New Commands**
Create new commands in `commands/actions.js` or `commands/queries.js`:

```javascript
// In actions.js
{
    name: '!myCustomAction',
    description: 'Does something custom',
    execute: async function(agent, args) {
        // Your custom logic here
        return "Action completed!";
    }
}
```

---

### 4. **Extend Skills Library**
Add new action primitives in `library/skills.js`:

```javascript
export async function myCustomSkill(bot, param1, param2) {
    // Your skill implementation
    log(bot, `Executing custom skill with ${param1} and ${param2}`);
    // ... skill logic
}
```

---

### 5. **Modify Memory System**
Edit `history.js` to:
- Change context window size
- Adjust memory compression frequency
- Modify memory summarization prompts

---

### 6. **Customize NPC Goals**
Edit `npc/controller.js` to:
- Add new construction templates
- Modify goal-setting logic
- Change daily routine behavior
- Add custom goal types

---

### 7. **Add New Reactive Modes**
In `modes.js`, add to `modes_list`:

```javascript
{
    name: 'my_custom_mode',
    description: 'Does something when condition is met',
    interrupts: ['action:followPlayer'], // What it can interrupt
    on: true, // Enable/disable
    active: false,
    update: async function (agent) {
        // Check conditions
        if (/* condition */) {
            execute(this, agent, async () => {
                // Perform action
            });
        }
    }
}
```

---

### 8. **Modify Conversation Behavior**
Edit `conversation.js` to:
- Adjust response timing
- Change conversation timeout logic
- Add custom conversation rules
- Modify multi-agent coordination

---

### 9. **Customize Code Generation**
Edit `coder.js` to:
- Modify code templates
- Change exposed libraries
- Adjust retry logic
- Add custom validation

---

### 10. **Profile-Based Customization & System Prompts**

**Where System Prompts Are Located:**

The system prompts for LLM prompting are stored in **JSON profile files** in the `profiles/` directory. The prompt system uses a hierarchical inheritance structure:

1. **`profiles/defaults/_default.json`** - Base default prompts (lowest priority)
2. **`profiles/defaults/{base_profile}.json`** - Base profile prompts (survival, assistant, creative, god_mode)
3. **Individual profile files** - Specific agent profiles (highest priority, overrides all)

**How It Works:**

The `Prompter` class (`src/models/prompter.js`) loads profiles in this order:
1. Loads `_default.json` as the base
2. Loads a base profile (e.g., `survival.json`) and merges it with defaults
3. Loads the individual profile and merges it with the base profile
4. Individual profile values override base profile values

**Key System Prompt Fields:**

Each profile contains these prompt templates (with placeholders):

- **`conversing`** - Main conversation/system prompt for chat interactions
- **`coding`** - Prompt for code generation tasks
- **`saving_memory`** - Prompt for memory compression/summarization
- **`bot_responder`** - Prompt for deciding whether to respond during actions
- **`image_analysis`** - Prompt for vision/visual analysis
- **`goal_setting`** - Prompt for autonomous goal setting (deprecated)

**Prompt Placeholders:**

The prompts use placeholders that are replaced at runtime:
- `$NAME` - Agent's name
- `$SELF_PROMPT` - Current self-prompting goal (if active)
- `$MEMORY` - Compressed memory summary
- `$STATS` - Current stats (health, position, etc.)
- `$INVENTORY` - Current inventory
- `$COMMAND_DOCS` - Available command documentation
- `$CODE_DOCS` - Relevant skill/library documentation
- `$EXAMPLES` - Similar conversation examples
- `$TO_SUMMARIZE` - Messages to summarize
- `$ACTION` - Current action label
- `$LAST_GOALS` - Recent goal completion status
- `$BLUEPRINTS` - Available construction blueprints

**Example Profile Structure:**

```json
{
    "name": "MyCustomAgent",
    "model": "gpt-4",
    "conversing": "You are an AI Minecraft bot named $NAME...\n$SELF_PROMPT\n$STATS\n$INVENTORY\n$COMMAND_DOCS\n$EXAMPLES\nConversation Begin:",
    "coding": "You are an intelligent mineflayer bot $NAME...\n$SELF_PROMPT\n$CODE_DOCS\n$EXAMPLES\nConversation:",
    "saving_memory": "You are a minecraft bot named $NAME...\nOld Memory: '$MEMORY'\nRecent conversation:\n$TO_SUMMARIZE\n...",
    "npc": {
        "goals": [...],
        "do_set_goal": true,
        "do_routine": true
    },
    "modes": {
        "hunting": false,
        "self_defense": true
    }
}
```

**How to Customize System Prompts:**

1. **Edit existing profile**: Modify a profile in `profiles/` directory
2. **Create new profile**: Create a new JSON file in `profiles/` with your custom prompts
3. **Override base profile**: Set `base_profile` in settings to use a different base
4. **Modify default**: Edit `profiles/defaults/_default.json` to change defaults for all agents

**Prompt Processing:**

The `replaceStrings()` method in `src/models/prompter.js` (line 136) handles placeholder replacement. Prompts are processed before being sent to the LLM via methods like:
- `promptConvo()` - For conversation (line 213)
- `promptCoding()` - For code generation (line 263)
- `promptMemSaving()` - For memory compression (line 279)
- `promptVision()` - For image analysis (line 302)

---

## Key Configuration Points

1. **settings.js** (main) - Global settings (max_commands, chat_ingame, etc.)
2. **profiles/** - Agent personality and behavior profiles
3. **modes.js** - Reactive behavior configuration
4. **self_prompter.js** - Autonomous behavior timing
5. **commands/** - Available actions and queries
6. **library/skills.js** - Action primitives

---

## Best Practices

1. **Test incrementally** - Make small changes and test thoroughly
2. **Use profiles** - Create different profiles for different agent types
3. **Monitor logs** - Check console output and history files
4. **Backup states** - Agent states are saved in `bots/{name}/memory.json`
5. **Use modes wisely** - Too many active modes can cause conflicts
6. **Command safety** - Validate inputs in custom commands
7. **Code sandboxing** - Generated code runs in a sandbox, but be careful with exposed APIs

---

## Common Customization Scenarios

### Make Agent More Aggressive
- Enable `self_defense` mode, disable `cowardice`
- Reduce enemy detection distance in `cowardice` mode
- Increase attack range in `self_defense` mode

### Make Agent More Passive
- Disable `hunting` and `self_defense` modes
- Enable `cowardice` mode
- Increase self-preservation thresholds

### Make Agent More Autonomous
- Enable self-prompting with a goal
- Reduce self-prompt cooldown
- Enable NPC goal system (`do_set_goal: true`)

### Make Agent More Conversational
- Adjust conversation timing in `conversation.js`
- Modify response scheduling logic
- Enable more verbose chat output

---

This architecture provides a flexible foundation for creating diverse agentic NPCs with varying behaviors, capabilities, and personalities.

