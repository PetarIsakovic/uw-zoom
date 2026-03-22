export const WORD_BANK = buildWordBank([
  // University identity
  "University of Waterloo",
  "Waterloo",
  "UW",
  "UWaterloo",
  "Waterloo Warriors",
  "Warriors",
  "black and gold",
  "WatCard",
  "Quest",
  "Learn",
  "Waterloo ID",
  "student ID",
  "co-op",
  "coop",
  "co-op term",
  "work term",
  "internship",
  "engineering ring",
  "iron ring",
  "pink tie",
  "convocation",
  "graduation",
  "orientation",

  // Mascot / wildlife
  "goose",
  "geese",
  "gosling",
  "Goose statue",
  "Canada goose",
  "duck",
  "squirrel",

  // Academic buildings
  "Dana Porter Library",
  "Dana Porter",
  "DP Library",
  "DP",
  "Davis Centre",
  "DC",
  "DC Library",
  "Mathematics and Computer Building",
  "Mathematics and Computer",
  "MC",
  "Physics building",
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
  "Environment 1",
  "Environment 2",
  "Environment 3",
  "EV1",
  "EV2",
  "EV3",
  "Engineering 2",
  "Engineering 3",
  "Engineering 5",
  "Engineering 7",
  "E2",
  "E3",
  "E5",
  "E7",
  "RCH",
  "Red Centre Hall",
  "Arts Quad",
  "Humanities Theatre",
  "HT",
  "Arts Lecture Hall",
  "ALH",
  "Modern Languages",
  "ML",
  "PAS",
  "Psychology Anthropology Sociology",
  "Optometry building",
  "OPT",
  "Biology 1",
  "Biology 2",
  "B1",
  "B2",
  "Chemistry building",
  "CHEM",
  "Earth Sciences",
  "ESC",
  "Federation Hall",
  "Fed Hall",
  "CIF",
  "Columbia Icefield",
  "Commissary",
  "Applied Health Sciences",
  "AHS",
  "Research Advancement Centre",
  "RAC",
  "Perimeter Institute",
  "IQC",
  "Institute for Quantum Computing",
  "Velocity",
  "Conrad Centre",
  "Waterloo International",

  // Student life buildings
  "Student Life Centre",
  "SLC",
  "Physical Activities Complex",
  "PAC",
  "SLC/PAC",
  "Campus Wellness",
  "Health Services",
  "Turnkey Desk",
  "Student Success Office",
  "SSO",
  "registrar",
  "Graduate House",

  // Residences
  "Village 1",
  "V1",
  "CMH",
  "Claudette Millar Hall",
  "UWP",
  "University of Waterloo Place",
  "MKV",
  "Mackenzie King Village",
  "REV",
  "Ron Eydt Village",
  "Ron Eydt",
  "Columbia Lake Village",
  "CLV",
  "Minota Hagey Residence",
  "MHR",
  "Velocity Residence",
  "student village",

  // Federated and affiliated
  "Conrad Grebel",
  "Conrad Grebel University College",
  "Renison",
  "Renison University College",
  "United College",
  "St. Jerome's University",
  "St. Jerome's",
  "St Jeromes",
  "St. Paul's University College",
  "St Pauls",

  // Student orgs & culture
  "MathSoc",
  "EngSoc",
  "WUSA",
  "Feds",
  "Bomber",
  "Bombshelter",
  "bomb shelter",
  "Science Society",
  "SciSoc",
  "Arts Student Union",
  "ASU",
  "Graduate Student Association",
  "GSA",
  "Imprint",
  "Math Endowment Fund",
  "MEF",
  "WaterlooWorks",
  "Jobmine",
  "hackathon",
  "Hack the North",
  "MathSoc lounge",
  "MC Comfy",
  "comfy",
  "DC Comfy",
  "Riddles",
  "Waterloo Chess Club",
  "student run cafe",
  "Campus bubble tea",
  "Subway",
  "Tim Hortons",
  "plaza",
  "plaza rink",

  // Transit & surroundings
  "ION",
  "ION train",
  "ION light rail",
  "LRT",
  "GRT bus",
  "GRT",
  "Ring Road",
  "University Avenue",
  "Columbia Street",
  "Phillip Street",
  "Lester Street",
  "Seagram Drive",
  "parking lot",
  "Columbia Lake",
  "Columbia Lake Trail",
  "Waterloo Park",
  "Silver Lake",
  "Laurel Creek",
  "Uptown Waterloo",
  "King Street",

  // Outdoor / landmarks
  "ring road",
  "fountain",
  "engineering fountain",
  "Davis Centre fountain",
  "campus green",
  "South Campus",
  "North Campus",
  "East Campus",
  "loading dock",
  "footbridge",
  "covered walkway",
  "tunnel",
  "Rock Garden",
  "Sculpture Garden",
  "flag poles",
  "parking garage",
  "Columbia Parking",

  // Faculty / departments
  "Faculty of Math",
  "Faculty of Engineering",
  "Faculty of Arts",
  "Faculty of Science",
  "Faculty of Environment",
  "Faculty of Health",
  "Stratford School of Interaction Design",
  "computer science",
  "CS",
  "software engineering",
  "SE",
  "electrical engineering",
  "EE",
  "systems design engineering",
  "SYDE",
  "mechanical engineering",
  "ME",
  "civil engineering",
  "CE",
  "chemical engineering",
  "CHE",
  "management engineering",
  "MSCI",
  "nanotechnology engineering",
  "nano",
  "biomedical engineering",
  "BME",
  "mathematics",
  "pure math",
  "applied math",
  "statistics",
  "actuarial science",
  "combinatorics and optimization",
  "C&O",
  "physics",
  "chemistry",
  "biology",
  "kinesiology",
  "recreation and leisure studies",
  "planning",
  "geography",
  "environment and resource studies",
  "psychology",
  "philosophy",
  "economics",
  "accounting",
  "finance",
  "AFM",
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
