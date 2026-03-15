export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
  }
}

export function withErrorHandling(handler) {
  return async (event) => {
    try {
      return await handler(event);
    } catch (error) {
      const statusCode = error instanceof HttpError ? error.statusCode : 500;
      const message =
        error instanceof HttpError ? error.message : "Something went wrong on the server.";

      if (!(error instanceof HttpError)) {
        console.error(error);
      }

      return json(statusCode, { error: message });
    }
  };
}

export function handleOptions(event, allowedMethods) {
  if (event.httpMethod !== "OPTIONS") {
    return null;
  }

  return {
    statusCode: 204,
    headers: {
      Allow: allowedMethods.join(", "),
      "Cache-Control": "no-store",
    },
  };
}

export function ensureMethod(event, allowedMethods) {
  if (!allowedMethods.includes(event.httpMethod)) {
    throw new HttpError(405, `Method not allowed. Use ${allowedMethods.join(" or ")}.`);
  }
}

export function parseJsonBody(event) {
  if (!event.body) {
    return {};
  }

  try {
    return JSON.parse(event.body);
  } catch {
    throw new HttpError(400, "Invalid JSON body.");
  }
}

export function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

export function getOrigin(event) {
  const proto =
    event.headers["x-forwarded-proto"] ||
    event.headers["X-Forwarded-Proto"] ||
    "https";
  const host = event.headers.host || event.headers.Host;

  if (!host) {
    throw new HttpError(500, "Unable to determine the request host.");
  }

  return `${proto}://${host}`;
}
