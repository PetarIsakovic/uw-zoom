export const WORD_BANK = buildWordBank([
  "University of Waterloo",
  "Waterloo",
  "UW",
  "UWaterloo",
  "Waterloo Warriors",
  "Warriors",
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
  "DP",
  "Davis Centre",
  "DC",
  "DC Library",
  "Student Life Centre",
  "SLC",
  "Physical Activities Complex",
  "PAC",
  "SLC/PAC",
  "Mathematics and Computer",
  "Mathematics and Computer Building",
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
  "NH",
  "Hagey Hall",
  "HH",
  "Arts Quad",
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
  "St Jeromes",
  "MathSoc",
  "EngSoc",
  "WUSA",
  "Bomber",
  "ION",
  "ION train",
  "LRT",
  "GRT bus",
  "black and gold",
  "Goose statue",
  "Turnkey Desk",
  "ring road",
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
