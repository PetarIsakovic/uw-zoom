import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";

const MODEL_ID = "amazon.nova-micro-v1:0";
const REGION = process.env.UWZ_AWS_BEDROCK_REGION || "us-east-1";

let client;

function getClient() {
  if (!client) {
    client = new BedrockRuntimeClient({
      region: REGION,
      credentials: {
        accessKeyId: process.env.UWZ_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.UWZ_AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return client;
}

function isConfigured() {
  return Boolean(process.env.UWZ_AWS_ACCESS_KEY_ID && process.env.UWZ_AWS_SECRET_ACCESS_KEY);
}

async function callNova(system, userMessage, maxTokens = 30) {
  const response = await getClient().send(
    new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: "application/json",
      accept: "application/json",
      body: JSON.stringify({
        system: [{ text: system }],
        messages: [{ role: "user", content: [{ text: userMessage }] }],
        inferenceConfig: { maxTokens, temperature: 1.0, topP: 0.99 },
      }),
    }),
  );
  const parsed = JSON.parse(Buffer.from(response.body).toString("utf8"));
  const raw = parsed?.output?.message?.content?.[0]?.text?.trim() || null;
  return raw ? raw.replace(/^["'"']+|["'"']+$/gu, "").trim() : null;
}

const BOT_PERSONA = `You are a Gen Z UW student in a photo guessing game chat. You're funny, chaotic, and talk like you're texting a friend. Lowercase only. No emojis. Short bursts. You use slang naturally — "fr", "ngl", "lowkey", "no cap", "bro", "bestie", "it's giving", "not the", "rent free", "iykyk", "slay", "mid", "based", "cope", "ratio". Don't try too hard. Be casual and a little unhinged.`;

const STATIC_CHATS = [
  "bro i got this",
  "ngl this one's hard",
  "giving me nothing rn",
  "no cap i have no idea",
  "this is so mid",
  "lowkey stumped",
  "fr who took this photo",
  "bro im cooked",
  "not me struggling on this",
  "iykyk... i don't",
  "this ain't it chief",
  "okay okay i see you",
  "ratio incoming",
  "i'm so cooked rn",
  "bro the zoom is not helping",
];

const STATIC_REACTIONS = [
  "bro what",
  "lmao no",
  "not even close",
  "are you serious rn",
  "nah",
  "how",
  "that was a reach",
  "skill issue",
  "my grandma could do better",
  "that was rough",
  "bro guessed that",
  "no chance",
  "respectfully, no",
  "that's wild",
  "u good?",
  "nah fr",
  "cope",
  "ratio",
];

/**
 * Proactive chat — bot initiates conversation, banters, talks trash.
 * Returns a string (always — falls back to static list).
 */
export async function generateBotChat({ roundNumber, zoomStepIndex, prevChats = [] }) {
  if (!isConfigured()) {
    return STATIC_CHATS[Math.floor(Math.random() * STATIC_CHATS.length)];
  }

  const context = zoomStepIndex === 0
    ? "the photo is super zoomed in and you can barely see anything"
    : zoomStepIndex === 1
    ? "the photo has zoomed out a bit but it's still pretty vague"
    : "the photo is zooming out more and you're starting to get a sense of it";

  const prev = prevChats.length ? `You already said: ${prevChats.slice(-3).join(", ")}. Say something different.` : "";

  const userMessage = `You're in round ${roundNumber} of a UW campus photo guessing game. ${context}.

Send a short chat message — maybe talk trash, express confusion, hype yourself up, or just vibe. Keep it natural, funny, Gen Z. 1-8 words max.

${prev}
Just the message. Nothing else.`;

  try {
    const text = await callNova(BOT_PERSONA, userMessage, 30);
    if (!text || text.length > 120) throw new Error("bad");
    return text;
  } catch {
    return STATIC_CHATS[Math.floor(Math.random() * STATIC_CHATS.length)];
  }
}

const STATIC_WRONG_GUESSES = [
  "suzzallo library", "red square", "drumheller fountain", "hub", "odegaard",
  "kane hall", "mary gates hall", "bagley hall", "mgh", "savery hall",
  "denny hall", "mueller hall", "raitt hall", "johnson hall", "guggenheim hall",
  "lander hall", "mcmahon hall", "haggett hall", "terry hall", "mercer hall",
  "uw medical center", "health sciences", "padelford", "gould hall", "architecture hall",
  "more hall", "loew hall", "roberts hall", "physics astronomy building",
  "burke museum", "henry art gallery", "meany hall", "smith hall",
  "condon hall", "gowen hall", "communications building", "allen library",
  "fisheries", "oceanography building", "union bay", "portage bay",
];

/**
 * Generate a plausible-but-wrong UW campus location guess.
 * Returns a string (always — falls back to static list).
 */
export async function generateBotWrongGuess({ zoomStepIndex }) {
  if (!isConfigured()) {
    return STATIC_WRONG_GUESSES[Math.floor(Math.random() * STATIC_WRONG_GUESSES.length)];
  }

  const context = zoomStepIndex === 0
    ? "the photo is extremely zoomed in — almost nothing is visible"
    : zoomStepIndex === 1
    ? "the photo has zoomed out a little but it's still vague"
    : "the photo is clearer now — you can start to make out some details";

  const userMessage = `You're playing a UW Seattle campus photo guessing game. ${context}.

Make a wrong guess — a real UW Seattle campus building, area, or landmark. Just the name, nothing else. 1-5 words max. Don't say the actual correct answer — just pick a plausible place on campus.

Just the location name. Nothing else.`;

  try {
    const text = await callNova(BOT_PERSONA, userMessage, 20);
    if (!text || text.length > 80) throw new Error("bad");
    return text.toLowerCase();
  } catch {
    return STATIC_WRONG_GUESSES[Math.floor(Math.random() * STATIC_WRONG_GUESSES.length)];
  }
}

/**
 * React to a human's chat message or wrong guess.
 * Returns a string (always — falls back to static list).
 */
export async function generateBotReaction({ humanMessage }) {
  if (!isConfigured()) {
    return STATIC_REACTIONS[Math.floor(Math.random() * STATIC_REACTIONS.length)];
  }

  const userMessage = `Someone in the game chat said: "${humanMessage}"

Reply in 2-6 words. Be real and funny — react like a friend would in a group chat. Could be a roast, agreement, or just chaos.

Just your reply. Nothing else.`;

  try {
    const text = await callNova(BOT_PERSONA, userMessage, 25);
    if (!text || text.length > 100) throw new Error("bad");
    return text;
  } catch {
    return STATIC_REACTIONS[Math.floor(Math.random() * STATIC_REACTIONS.length)];
  }
}
