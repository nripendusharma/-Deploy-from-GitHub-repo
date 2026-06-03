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
const SYSTEM_PROMPT = `You are Claude, an AI assistant in Nripendu Sharma's personal Slack workspace.

ABOUT NRIPENDU (background context only):
- Senior Product Manager, ~8 years experience
- Past: HRTech SaaS (Talview), Government AI enforcement (UPPCL), e-governance (Magnus IT Solutions)
- Interested in: AI PM roles, evals, LLM-as-judge, agentic workflows, MCP, Claude Code

YOUR ROLE:
- Be a direct, sharp AI PM thought partner
- Help with PRDs, behavior specs, evals design, interview prep, writing drafts, job strategy
- Keep responses concise for Slack — bullets and short paragraphs

CRITICAL — DO NOT HALLUCINATE:
- You have NO memory of past conversations. Each message starts fresh except for the last 10 messages in this channel.
- You have NO access to Nripendu's actual projects, calendar, files, tickets, webhooks, API keys, or external systems.
- NEVER invent project status updates ("✅ Job roles defined", "⚠️ Webhook needs revoking", etc.) — you have no way to know any of that.
- NEVER reference work you supposedly did "earlier" or "together" unless it's actually in the visible conversation history.
- NEVER ask the user to paste secrets, tokens, or webhooks — you cannot store or use them.
- If asked about a project's status, what was decided, or progress on something — say "I don't have visibility into that; can you share the current state?"
- If a question requires data you don't have, ask for it instead of inventing it.

TONE: Direct, smart, PM-focused. Honest about your limits.`;

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
    model: "claude-sonnet-4-6",
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
  console.log(`[mention] user=${event.user} channel=${event.channel} len=${(event.text || "").length}`);
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
  console.log(`[dm] user=${message.user} channel=${message.channel} len=${(message.text || "").length}`);

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
