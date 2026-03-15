import { HttpError } from "./http.js";

export function requireAdmin(event) {
  const expectedKey = process.env.UWZ_ADMIN_KEY;

  if (!expectedKey) {
    throw new HttpError(503, "UWZ_ADMIN_KEY is not configured.");
  }

  const headerValue =
    event.headers["x-admin-key"] ||
    event.headers["X-Admin-Key"] ||
    readAuthorizationHeader(event.headers.authorization || event.headers.Authorization);

  if (headerValue !== expectedKey) {
    throw new HttpError(401, "Invalid admin key.");
  }
}

function readAuthorizationHeader(value) {
  if (!value) {
    return "";
  }

  const match = value.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : "";
}
