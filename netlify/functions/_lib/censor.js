const PROFANITY_PATTERNS = [
  /motherfucker/giu,
  /niggers?/giu,
  /niggas?/giu,
  /faggots?/giu,
  /retards?/giu,
  /assholes?/giu,
  /bitches?/giu,
  /bastards?/giu,
  /whores?/giu,
  /sluts?/giu,
  /puss(y|ies)/giu,
  /cunts?/giu,
  /dicks?/giu,
  /cocks?/giu,
  /fucks?/giu,
  /fucking/giu,
  /fucked/giu,
  /shits?/giu,
  /shitty/giu,
  /\bfag\b/giu,
];

export function censorProfanity(value, options = {}) {
  const maxLength = Number.isFinite(Number(options.maxLength))
    ? Math.max(0, Math.floor(Number(options.maxLength)))
    : Number.POSITIVE_INFINITY;
  const normalized = String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);

  return PROFANITY_PATTERNS.reduce(
    (result, pattern) => result.replace(pattern, (match) => "#".repeat(match.length)),
    normalized,
  );
}
