export function getClientIp(event) {
  return normalizeIp(
    firstHeaderValue(
      event.headers["x-nf-client-connection-ip"] ||
        event.headers["X-Nf-Client-Connection-Ip"] ||
        event.headers["client-ip"] ||
        event.headers["Client-Ip"] ||
        event.headers["x-forwarded-for"] ||
        event.headers["X-Forwarded-For"] ||
        event.headers["cf-connecting-ip"] ||
        event.headers["Cf-Connecting-Ip"] ||
        "",
    ),
  );
}

export function normalizeIp(value) {
  const normalized = String(value || "")
    .split(",")[0]
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^::ffff:/i, "")
    .slice(0, 80);

  return normalized || "Unknown";
}

function firstHeaderValue(value) {
  return Array.isArray(value) ? value[0] || "" : value;
}
