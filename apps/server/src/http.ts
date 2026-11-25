import { readFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { extname, resolve, sep } from "node:path";
import {
  createRoomBody,
  joinRoomBody,
  roomCodeSchema,
  type ApiError,
  type ErrorCode,
  type SessionInfo,
} from "@hw/core";
import {
  FixedWindowLimiter,
  ROOM_CREATE_PER_MINUTE,
  ROOM_JOIN_PER_MINUTE,
  clientIp,
} from "./limits";
import { RoomError, type RoomManager } from "./rooms/RoomManager";

const JSON_BODY_LIMIT_BYTES = 4 * 1024;

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json",
};

export interface HttpServerOptions {
  rooms: RoomManager;
  clientDist?: string;
  now?: () => number;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
  ) {
    super(code);
    this.name = "HttpError";
  }
}

/**
 * REST + static client server (plain `node:http`). Socket.IO attaches to the
 * returned server separately; its path is handled before this listener runs.
 */
export function createHttpServer({ rooms, clientDist, now = Date.now }: HttpServerOptions): Server {
  const createLimiter = new FixedWindowLimiter(ROOM_CREATE_PER_MINUTE, 60_000, now);
  const joinLimiter = new FixedWindowLimiter(ROOM_JOIN_PER_MINUTE, 60_000, now);
  const trustProxy = process.env.TRUST_PROXY === "1";
  const dist = clientDist === undefined ? null : resolve(clientDist);

  return createServer((request, response) => {
    handleRequest(request, response, {
      rooms,
      createLimiter,
      joinLimiter,
      trustProxy,
      dist,
    }).catch((error: unknown) => {
      if (error instanceof HttpError) {
        sendApiError(response, error.status, error.code);
        return;
      }
      console.error("[http] 未預期的錯誤", error);
      if (!response.headersSent) {
        response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        response.end("Internal Server Error");
      } else {
        response.destroy();
      }
    });
  });
}

interface RequestContext {
  rooms: RoomManager;
  createLimiter: FixedWindowLimiter;
  joinLimiter: FixedWindowLimiter;
  trustProxy: boolean;
  dist: string | null;
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: RequestContext,
): Promise<void> {
  const method = request.method ?? "GET";
  const url = new URL(request.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/api/rooms") {
    if (method !== "POST") {
      sendApiError(response, 405, "bad_request");
      return;
    }
    if (!context.createLimiter.allow(clientIp(request, context.trustProxy))) {
      sendApiError(response, 429, "rate_limited");
      return;
    }
    const parsed = createRoomBody.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendApiError(response, 400, "bad_request");
      return;
    }
    const { session } = context.rooms.create(parsed.data.name, parsed.data.mode);
    sendJson<SessionInfo>(response, 201, session);
    return;
  }

  const joinMatch = /^\/api\/rooms\/([^/]+)\/join$/.exec(pathname);
  if (joinMatch !== null) {
    if (method !== "POST") {
      sendApiError(response, 405, "bad_request");
      return;
    }
    const roomCode = decodeSegment(joinMatch[1] ?? "");
    if (!roomCodeSchema.safeParse(roomCode).success) {
      sendApiError(response, 404, "room_not_found");
      return;
    }
    if (!context.joinLimiter.allow(clientIp(request, context.trustProxy))) {
      sendApiError(response, 429, "rate_limited");
      return;
    }
    const parsed = joinRoomBody.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      sendApiError(response, 400, "bad_request");
      return;
    }
    try {
      const { session } = context.rooms.join(roomCode, parsed.data.name);
      sendJson<SessionInfo>(response, 200, session);
    } catch (error) {
      if (!(error instanceof RoomError)) throw error;
      sendApiError(response, statusForCode(error.code), error.code);
    }
    return;
  }

  const infoMatch = /^\/api\/rooms\/([^/]+)$/.exec(pathname);
  if (infoMatch !== null) {
    if (method !== "GET") {
      sendApiError(response, 405, "bad_request");
      return;
    }
    const roomCode = decodeSegment(infoMatch[1] ?? "");
    if (!roomCodeSchema.safeParse(roomCode).success) {
      sendApiError(response, 404, "room_not_found");
      return;
    }
    const room = context.rooms.get(roomCode);
    if (room === undefined) {
      sendApiError(response, 404, "room_not_found");
      return;
    }
    sendJson(response, 200, room.info());
    return;
  }

  if (pathname === "/api" || pathname.startsWith("/api/")) {
    sendApiError(response, 404, "room_not_found");
    return;
  }

  if (method !== "GET" && method !== "HEAD") {
    response.writeHead(405, { "content-type": "text/plain; charset=utf-8", allow: "GET, HEAD" });
    response.end("Method Not Allowed");
    return;
  }

  await serveClient(response, method, pathname, context.dist);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += buffer.byteLength;
    if (size > JSON_BODY_LIMIT_BYTES) throw new HttpError(413, "bad_request");
    chunks.push(buffer);
  }

  if (size === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new HttpError(400, "bad_request");
  }
}

async function serveClient(
  response: ServerResponse,
  method: string,
  pathname: string,
  dist: string | null,
): Promise<void> {
  if (dist === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  const target = resolveWithin(dist, pathname);
  if (target !== null) {
    const file = await asFile(target);
    if (file) {
      await sendFile(response, method, file, pathname.startsWith("/assets/"));
      return;
    }
  } else if (pathname !== "/") {
    // Traversal attempts never fall back to the SPA shell.
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  const indexFile = await asFile(resolve(dist, "index.html"));
  if (indexFile === null) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }
  await sendFile(response, method, indexFile, false);
}

/** Resolves a URL path under `root`, returning null when it escapes the root. */
function resolveWithin(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;

  const relative = decoded.replace(/^\/+/, "");
  const target = resolve(root, relative);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return target;
}

async function asFile(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? path : null;
  } catch {
    return null;
  }
}

async function sendFile(
  response: ServerResponse,
  method: string,
  file: string,
  immutable: boolean,
): Promise<void> {
  let body: Buffer;
  try {
    body = await readFile(file);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  const contentType = MIME_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
  response.writeHead(200, {
    "content-type": contentType,
    "content-length": body.byteLength,
    "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : body);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function statusForCode(code: ErrorCode): number {
  switch (code) {
    case "room_not_found":
      return 404;
    case "room_full":
    case "game_started":
      return 409;
    case "rate_limited":
      return 429;
    default:
      return 400;
  }
}

function sendJson<T>(response: ServerResponse, status: number, body: T): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  response.end(payload);
}

function sendApiError(response: ServerResponse, status: number, code: ErrorCode): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const body: ApiError = { error: code };
  sendJson(response, status, body);
}
