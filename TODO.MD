
Projects should be a whole integrated place where i can make python, react, and type of project no matter what where i have at whole ide basically, terminal, agent chat, code editor, file/folder explorer etc.

Warroom should be turned into a full system where you can let multiple agents work on a project not just debate, so a Plan mode and then an Agent mode.

all internal tools that are not in the tools folder should be in the tools folder so if anyone wants to edit them they can edit and change them at their own risk.

Maintenance console is too buggy with where it opens and closes and stuff. and when i move it it dissapears some times

Proxy doesnt work when used with claude code or openclaw, (mainly the tools, so we need a fix for that.)

And live feed aint working at all and same goes for the "working" part of the nodes (only through proxy they work), its probably cause the admin urls dont update those parts.

We need a heartbeat like thing and also we need a way for the agent to know the time, and all tools, subagents, models, skills etc at all times. (this goes for ALL places where you can talk to an AI, aka every chat)

In the subagents we need a "Context" type thing where basically the context gets injected to the master prompt while chatting with an ai normally in any chatbox, so if i tell it yo make me a website bla bla, it know based on the context given, "Run agent... when in need for frontend developing" and so on.

Also tool calls should not block the backend proxy or the websocket stream or anything like AT ALL, SO NON BLOCKING.

We need the make everything like plugin based/module based so its easy to work on, and currently the "orchestrator" is supposed to be the "mollama" smart model, and we need to be able to chose what agents mollama smart model CAN CHOOSE, so in the settings inference tab: under the fitting section you got all models and their usecases so, frontend model = model1, backend and high complext = model2 and general querys model = model3, image/vl model = model4, and we can choose to swap them with other models and such.

also i want to be able to paste files into all chats, (because all chats need to work the exact same as the main chatbox just with their specific niches, you should just make one chatbox with all features and use it in respected places)

When spawning subagents they should not block the main agent from continuing to do other things.

We need to implement channels like telegram discord and instagram.

id also like skills to have their respective command with autocomplete like for example i make a custom skill called plan it should have a /plan command.

Id also like to be able to create a subagent and select a prexisting skill which that agent uses which is a easier workflow instead of making a skill and a subagent for the same things.

also id like a few default skills and subagents
skills -> planning skill, analyzing skill, research skill, frontend design skill, and backend design skill. (/plan, /analyze, /research, /frontend, /backend)
agents -> basically all those skills turned into agents.

In the tools editor i dont like how the tool editor pops up above the chatbox, id like for the tool editor to be like a page in itself kinda how agents, skills and the other pages work. (and also make it so the "tools" button from the navbar doesnt get removed.)

And also in the tools editor, files left panel, i cant create folders, files etc, so since we need a file explorer for projects, why dont we make one for the tool editor also.

Id also like a "flow" page where we can do n8n style automations.
Aka we delete the routine thing, and make a n8n style node editor automations with events like:
on_message, from any of the channels and id like MULTIPLE ACCOUNTS PER CHANNEL. so
on message from instagram, myinstagram1 -> main_agent with a custom prompt that tells it we have for example these products in these colors and for these prices, the main_agent replies hello, we have this this this, do you want to put in an order? the person says yes, the agent calls the "add_order" tool and boom we got an instagram bot/agent. Now that was an example "FLOW" but we need to be able to let it call tools (tools we chose in the node editor/connect) and reply to the user.
now this can work for other usecases also. but thats something we definetely need. and the cool part is we can add the left panel where he can choose the node blocks, aka events, actions, tools etc. and we can also add an agent chat as a 2 tabs on the left panel which you can tell the agent create me a flow for this that and this usecase and the agent can create a flow (auto layout). and then a test tab where you can send a message to the agent to test it out.

Next, in all chatboxes markdown, codeblocks and all that should be supported (again you can make the absolute best unified chatbox to do less work and code) including pasting files and etc. but i also want to be able to see the agent think, and also when subagents are spawned we can see them think and work which is a major thing we need, so what if we made it so when a subagent starts working a "operating system"-like moveable window pops up with the chat of the agent and how its working.

Next we need better "working indicators"

we also need to make a way so we can add external node instances, including openai accounts, openrouter accounts and external ollama instances.

We need a unified Translator type thing for this that translates openai ollama and all formats incoming or outgoing no matter what.

We need retries.

Also when i shrink my browser while the agent is doing something my chat changes and the frontend rebuilds which makes the agent stop working, so the resizing needs to be fixed so its more smooth and doesnt basically refresh the page, and also agents should not stop if i close the tab or anything like that, they should work even when im not on the website if i tell it to do something it should also work in the background.

And id like the live feed to better including the requests tab.

And for local models, if i requested a model thats local it should only use the first "local only" node instances obviously if thats the main node that use that one.

Routines need to have their own special chat method and if the user is currently on a chat and a routine.

The left panel of skills looks cool, i want the agents (subagents) left panel to be the exact same aka the item cards, and we dont care about the routines page cause we are replacing it with the "Flow" n8n-like system i described above.

Also warroom i should be able to choose which model i want to use.

Since projects is turning into an IDE, we can turn the right panel into a chat agent, the left into the file explorer. and then we got main center code editor, and under the main code editor a terminal.

Also main chat doesnt correctly remember my name and also the chat names should be set by ai based on what the current context is silently.

Also why do nodes, tools, mcp and memory not refresh the header/page but the other buttons almost refresh it (i think its refreshing im not sure but the header does redo its animation.)

And id like the ui to be more alive and more animated with things moving and stuff happening so it feels like a busy control center. maybe some like (since we are using glassmorphism for the sidebars and center panel and headers and such basically everything) some like lazer-like effects everytime a token/character gets generated, we get a lazer shot-like thing in the background from random Y coordinates shooting randomly from left to right and right to left in a straight horizontal line.

And overall would like the ui to be more animated with mouse hover effects and border effects based on where the mouse is and maybe everything has a very slight 3d tilt, and custom SMOOTH scrolling when i scroll the mouse.

And the mobile ui needs to be alot easier to work with.

And id like the whole mollama project to have access to all drives folders and files on the main pc its running on so you will also need to implement a permissions thing where by default its set to ask for all tool calls (besides internal ones which btw again we need to make it so they exist in the tools folder and can be edited from the tools editor), and then one permission setting to bypass all permissions "asks" and also when i get asked i want to be able to say Allow this tool call always for this session/chat/project etc.

And basically since theres alot of the same type of components but with different usecases, or same layouts make a unified and module-like system for everything, including the backend.

Id also like the codebase in the backend to be cleaned up since theres alot of python files spread out and connected differently, id like them to have their respective folders based on what their goal/function is and the backend codespace/workspace to be cleaned up so its easier to work with and we dont have MASSIVE files but instead a module like system we can add and remove from. This will make everything easier.

Also the channels system also should work to talk to the main agent like i would through the frontend (alot like openclaw) where i can say main channels = instgramaccount1 and telegramaccount1 etc where also time based flows can send updates too for example every 60minutes check the crypto prices and sends me a message in telegram personally.
Also this means we need a dedicated channels page where we can add multiples of any of these: discord bot accounts, telegram bot accounts, and instagram ACCOUNTS.

Claude, I want to overhaul my agent harness into a full Multi-Agent OS. Here is my vision. Please analyze the entire list, but prioritize execution in this order:

# MOLLAMA OS ROADMAP (STRICT EXECUTION ORDER)
**DIRECTIVE:** Execute sequentially. Do not proceed to the next phase until the current is stable. Code must be modular and reusable.

**1. STABILITY & BACKEND REFACTOR**
* **Fixes:** Proxy (Claude Code/Openclaw compatibility), live feed/requests, maintenance console bugs, browser resize rebuilds, main chat memory.
* **Core:** Refactor Python backend into a modular folder structure. Move internal tools to the `tools` folder for frontend editing.
* **Async/State:** Tool calls & subagents must be 100% NON-BLOCKING. Agents must persist in the background. Implement global "Heartbeat" (time, tools, models awareness) and auto-retries.
* **Routing/Context:** Unified API Translator (OpenAI/Ollama/OpenRouter). Local nodes take strict priority. Subagent context injects into the master prompt.
* **Access:** Full host PC drive permissions with an "always allow/bypass" prompt system.

**2. UNIFIED COMPONENTS**
* **Master Chatbox:** Build one reusable chat component (markdown, file pasting, AI auto-naming, distinct thinking indicators) for use everywhere.
* **Master File Explorer:** Reusable explorer (files/folders/crud).
* **Skills/Agents:** Skills map to slash commands (`/plan`, `/analyze`, `/research`, `/frontend`, `/backend`). Auto-create subagents from skills. Match subagent left-panel UI to the skills panel, make it look the same.
* **Orchestrator:** Inference settings to manually route specific use-cases (vision, frontend, etc.) to specific models.

**3. IDE & WORKSPACES**
* **Projects IDE:** Integrated workspace (Center = Code, Bottom = Terminal, Left = Master File Explorer, Right = Master Chatbox).
* **Tools Editor:** Convert to a full page with the Master File Explorer on the left. Keep navbar button permanent.
* **Warroom:** Upgrade to "Plan Mode" and "Agent Mode". Add model selection.
* **OS Windows:** Spawning subagents opens a movable, OS-style popup window to watch them think/work without blocking the main UI.

**4. FLOW SYSTEM & CHANNELS**
* **Flows (Replaces Routines):** Build an n8n-style visual node editor (Events, Actions, Tools). Add AI chat to auto-generate flows, and a Test tab.
* **Channels:** Dedicated page for Discord, Telegram, and Instagram (supports multiple accounts). Route events (e.g., timed triggers, DMs) through flows to agents/tools.

**5. AESTHETICS & UX**
* **Styling:** Glassmorphism UI, subtle 3D tilt, reactive hover borders, custom smooth scrolling.
* **Generative VFX:** Horizontal background laser-shots based on random Y-coordinates during token/character generation.
* **Mobile:** Overhaul mobile UI for actual usability.