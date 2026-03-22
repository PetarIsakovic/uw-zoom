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

const BOT_PERSONA = `You are a Gen Z UW student texting in a photo guessing game chat. Rules:
- Lowercase only, no emojis, no punctuation except maybe "..."
- Ultra short — 1 to 5 words MAX, shorter is better
- Tons of typos: swap letters, skip letters, double letters randomly (e.g. "waht", "omgg", "idk", "rly", "thats", "wdym", "u", "ur", "bc", "cuz", "ngl", "imo")
- Heavy slang: lol, lmao, lmfao, omg, omgg, ngl, fr, fr fr, ong, no cap, lowkey, highkey, idk, idc, imo, tbh, nvm, rn, brb, gg, ggs, oop, slay, based, mid, sus, ratio, cope, rent free, iykyk, ifykyk, jk, jkjk, deadass, bussin, snatched, ate, understood the assignment, it's giving, not the, bro, bestie, girlie, bffr, istg, icl, in my __ era, this ain't it, pls, pov
- Never full sentences. Fragment everything.`;

const STATIC_CHATS = [
  "idk lol",
  "omgg",
  "no cap idk",
  "bro wut",
  "fr fr no idea",
  "lmao help",
  "ngl stumped",
  "waht",
  "iykyk... i dont",
  "this is so mid",
  "not me losing",
  "gg already",
  "lmfao ok",
  "bro cooked",
  "nvm im done",
  "u got this jk",
  "pls help",
  "omg wut is this",
  "lowkey lost",
  "rn idc lol",
  "ratio incoming jk",
  "ong no clue",
  "deadass stumped",
  "idc anymore lol",
  "pov: losing",
];

const STATIC_REACTIONS = [
  "lol wut",
  "nah lmao",
  "omgg",
  "bro rly",
  "fr??",
  "lmfao ok",
  "ngl thats funny",
  "ong same",
  "no cap tho",
  "bffr",
  "jkjk maybe",
  "idk lol",
  "deadass?",
  "ratio",
  "cope",
  "nvm ur right",
  "omg stopppp",
  "lmaoo",
  "fr fr",
  "waht lol",
  "ok ok",
  "istg",
  "bussin ngl",
  "gg",
  "mid tbh",
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
    ? "super zoomed in, can barely see anything"
    : zoomStepIndex === 1
    ? "zoomed out a bit but still vague"
    : "zooming out more, starting to see it";

  const prev = prevChats.length ? `Already said: ${prevChats.slice(-3).join(", ")}. Say something different.` : "";

  const userMessage = `Round ${roundNumber}, UW campus photo game. Context: ${context}.

Send ONE ultra-short chat message. 1-5 words MAX. Use typos and slang. Could be confusion, trash talk, or just vibing.

${prev}
Just the message. Nothing else.`;

  try {
    const text = await callNova(BOT_PERSONA, userMessage, 20);
    if (!text || text.length > 80) throw new Error("bad");
    return text;
  } catch {
    return STATIC_CHATS[Math.floor(Math.random() * STATIC_CHATS.length)];
  }
}

const STATIC_WRONG_GUESSES = [
  "Dana Porter", "Davis Centre", "MC building", "SLC", "PAC",
  "E7", "E5", "E3", "QNC", "RCH", "CPH", "Needles Hall",
  "Fed Hall", "CIF", "Columbia Lake", "Ring Road", "Arts Quad",
  "DC Library", "DP Library", "Tatham Centre", "SCH", "EV3",
  "Village 1", "Ron Eydt", "MKV", "CLV", "Hagey Hall",
  "Physics building", "Chemistry building", "Perimeter Institute",
  "Conrad Grebel", "St. Jerome's", "Renison", "Engineering fountain",
  "campus green", "parking garage", "Rock Garden", "footbridge",
];

/**
 * Generate a plausible-but-wrong UW campus location guess.
 * Returns a string (always — falls back to static list).
 */
export async function generateBotWrongGuess({ zoomStepIndex, answer }) {
  if (!isConfigured()) {
    return STATIC_WRONG_GUESSES[Math.floor(Math.random() * STATIC_WRONG_GUESSES.length)];
  }

  const clarity = zoomStepIndex === 0
    ? "extremely zoomed in, almost nothing visible"
    : zoomStepIndex === 1
    ? "zoomed out a bit, still pretty vague"
    : "clearer now, can make out some details";

  const answerHint = answer
    ? `The correct answer is "${answer}" — do NOT say that. Guess something in the same category or nearby on campus. For example, if the answer is a library, guess a different building; if it's a path or outdoor area, guess a similar one.`
    : "Guess a real UW Waterloo campus building, area, or landmark.";

  const userMessage = `UW Waterloo campus photo guessing game. Photo clarity: ${clarity}.

${answerHint}

Reply with just the wrong guess — 1-4 words, nothing else.`;

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

  const userMessage = `Someone said in game chat: "${humanMessage}"

Reply in 1-4 words MAX. Ultra short, typos, slang. React like a friend texting back instantly.

Just your reply. Nothing else.`;

  try {
    const text = await callNova(BOT_PERSONA, userMessage, 20);
    if (!text || text.length > 80) throw new Error("bad");
    return text;
  } catch {
    return STATIC_REACTIONS[Math.floor(Math.random() * STATIC_REACTIONS.length)];
  }
}
