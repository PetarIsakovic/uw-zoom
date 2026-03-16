export const WORD_BANK = buildWordBank([
  "camera",
  "photography camera",
  "coffee",
  "coffee mug",
  "mug",
  "backpack",
  "bag",
  "school bag",
  "headphones",
  "headset",
  "laptop",
  "keyboard",
  "mouse",
  "textbook",
  "notebook",
  "calculator",
  "water bottle",
  "hoodie",
  "lanyard",
  "beaker",
  "microscope",
  "lab coat",
  "whiteboard",
  "projector",
  "bike",
  "bus",
  "snow",
  "squirrel",
  "University of Waterloo",
  "Waterloo",
  "UW",
  "UWaterloo",
  "goose",
  "geese",
  "gosling",
  "WatCard",
  "Quest",
  "Learn",
  "co-op",
  "coop",
  "engineering ring",
  "iron ring",
  "pink tie",
  "Dana Porter Library",
  "Dana Porter",
  "DP Library",
  "Davis Centre",
  "DC",
  "Student Life Centre",
  "SLC",
  "Mathematics and Computer",
  "MC",
  "Physics",
  "PHY",
  "Quantum Nano Centre",
  "QNC",
  "Carl Pollock Hall",
  "CPH",
  "Tatham Centre",
  "TC",
  "South Campus Hall",
  "SCH",
  "Needles Hall",
  "Hagey Hall",
  "Arts Quad",
  "PAC",
  "CIF",
  "E7",
  "E5",
  "E3",
  "E2",
  "EV3",
  "RCH",
  "Village 1",
  "V1",
  "CMH",
  "Claudette Millar Hall",
  "UWP",
  "MKV",
  "REV",
  "Ron Eydt Village",
  "Conrad Grebel",
  "Renison",
  "United College",
  "St. Jerome's",
  "MathSoc",
  "EngSoc",
  "WUSA",
  "Bomber",
  "Lazeez",
  "shawarma",
  "bubble tea",
  "boba",
  "Tim Hortons",
  "ION",
  "GRT bus",
  "GO bus",
  "midterm",
  "exam",
  "convocation",
  "orientation",
  "frosh",
  "black and gold",
  "Golden Hawk",
  "Warrior",
  "Goose statue",
  "DC Library",
  "SLC/PAC",
  "Turnkey Desk",
  "ring road",
  "campus pizza",
  "study room",
  "lecture hall",
]);

const WORD_BANK_INDEX = createWordBankIndex(WORD_BANK);

export function normalizeWordBankValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function resolveWordBankEntry(value) {
  return WORD_BANK_INDEX.get(normalizeWordBankValue(value)) || null;
}

export function isWordBankEntry(value) {
  return Boolean(resolveWordBankEntry(value));
}

export function searchWordBank(query, limit = 8) {
  return searchInWordBank(WORD_BANK, query, limit);
}

export function createWordBankIndex(values) {
  return new Map(values.map((entry) => [normalizeWordBankValue(entry), entry]));
}

export function resolveInWordBank(values, value) {
  return createWordBankIndex(values).get(normalizeWordBankValue(value)) || null;
}

export function searchInWordBank(values, query, limit = 8) {
  const normalizedQuery = normalizeWordBankValue(query);

  if (!normalizedQuery) {
    return [];
  }

  const startsWith = [];
  const includes = [];

  for (const entry of values) {
    const normalizedEntry = normalizeWordBankValue(entry);

    if (normalizedEntry.startsWith(normalizedQuery)) {
      startsWith.push(entry);
      continue;
    }

    if (normalizedEntry.includes(normalizedQuery)) {
      includes.push(entry);
    }
  }

  return [...startsWith, ...includes].slice(0, limit);
}

function buildWordBank(values) {
  const seen = new Set();
  const unique = [];

  for (const value of values) {
    const trimmed = String(value || "").trim();
    const normalized = normalizeWordBankValue(trimmed);

    if (!trimmed || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    unique.push(trimmed);
  }

  return unique;
}
