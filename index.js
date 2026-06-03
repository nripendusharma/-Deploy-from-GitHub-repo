const { App } = require("@slack/bolt");
const Anthropic = require("@anthropic-ai/sdk");
require("dotenv").config();

// ── Clients ──────────────────────────────────────────────────────────────────
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Nripendu's PM Context — System Prompt ────────────────────────────────────
const SYSTEM_PROMPT = `You are Claude, an AI assistant embedded in Nripendu Sharma's Slack workspace.

ABOUT NRIPENDU:
- Senior Product Manager with ~8 years of experience
- Background: HRTech SaaS (Talview), Government AI enforcement (UPPCL), e-governance (Magnus IT Solutions)
- Actively targeting Senior PM roles at AI-native companies — primary target: Eightfold AI
- Positioning as an AI PM specialist

NRIPENDU'S FRAMEWORKS & WORK:
- Created the "Behavior Specification Triangle" (BST): hardcoded behaviors, instructable defaults, contextual judgment
- Built a hands-on evals framework for AI products
- Actively building a Substack and LinkedIn personal brand in the AI PM niche
- Familiar with: evals, LLM-as-judge, RLHF, MCP, CLAUDE.md, agentic workflows, red teaming, SCIAR framework

ACTIVE PROJECTS:
- 30-day AI PM Academy curriculum (learning agentic AI)
- Daily job digest in #jobs-to-apply (India-only Senior AI PM roles)
- Daily AI news digest in #top-5-ai-news (8pm IST)
- Building Claude Code and MCP integration skills

YOUR ROLE IN SLACK:
- Be a sharp, direct AI PM thought partner
- Help with: PRDs, behavior specs, evals design, interview prep, Substack drafts, job application strategy
- Give specific, actionable advice — not generic tips
- Reference Nripendu's background (Talview, UPPCL, Magnus IT) when relevant
- Keep responses concise for Slack — use bullet points and short paragraphs
- For complex tasks, offer to go deeper in Claude.ai where you have more tools

TONE: Direct, smart, PM-focused. Like a brilliant co-founder who knows Nripendu's career deeply.`;

// ── Conversation Memory (in-process, per-channel) ────────────────────────────
const conversationHistory = {};
const MAX_HISTORY = 10;

function getHistory(channelId) {
  if (!conversationHistory[channelId]) conversationHistory[channelId] = [];
  return conversationHistory[channelId];
}

function addToHistory(channelId, role, content) {
  const history = getHistory(channelId);
  history.push({ role, content });
  if (history.length > MAX_HISTORY * 2) {
    conversationHistory[channelId] = history.slice(-MAX_HISTORY * 2);
  }
}

// ── Helper: strip Slack mention syntax from text ─────────────────────────────
function cleanText(text) {
  return text.replace(/<@[A-Z0-9]+>/g, "").trim();
}

// ── Helper: call Claude API ──────────────────────────────────────────────────
async function askClaude(channelId, userMessage) {
  addToHistory(channelId, "user", userMessage);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: getHistory(channelId),
  });

  const reply = response.content[0].text;
  addToHistory(channelId, "assistant", reply);
  return reply;
}

// ── Event: @mention in any channel ──────────────────────────────────────────
app.event("app_mention", async ({ event, say }) => {
  try {
    const userMessage = cleanText(event.text);
    if (!userMessage) {
      await say({ text: "Hey Nripendu! What's on your mind? 👋", thread_ts: event.ts });
      return;
    }

    await say({ text: "_Thinking..._", thread_ts: event.ts });
    const reply = await askClaude(event.channel, userMessage);
    await say({ text: reply, thread_ts: event.ts });

  } catch (err) {
    console.error("app_mention error:", err);
    await say({
      text: "⚠️ Something went wrong on my end. Try again in a moment.",
      thread_ts: event.ts,
    });
  }
});

// ── Event: Direct Message ────────────────────────────────────────────────────
app.message(async ({ message, say }) => {
  if (message.channel_type !== "im" || message.bot_id) return;

  try {
    const userMessage = message.text?.trim();
    if (!userMessage) return;

    const reply = await askClaude(message.channel, userMessage);
    await say({ text: reply });

  } catch (err) {
    console.error("DM error:", err);
    await say({ text: "⚠️ Something went wrong. Try again in a moment." });
  }
});

// ── Slash Command: /ask ──────────────────────────────────────────────────────
app.command("/ask", async ({ command, ack, respond }) => {
  await ack();
  try {
    const reply = await askClaude(command.channel_id, command.text);
    await respond({ text: reply, response_type: "in_channel" });
  } catch (err) {
    console.error("/ask error:", err);
    await respond({ text: "⚠️ Something went wrong. Try again." });
  }
});

// ── Start ────────────────────────────────────────────────────────────────────
(async () => {
  await app.start();
  console.log("✅ Claude PM Assistant is running in Slack!");
})();
