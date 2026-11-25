import type {
  ClientToServerEvents,
  CreateRoomBody,
  ErrorCode,
  JoinRoomBody,
  RoomInfo,
  ServerToClientEvents,
  SessionInfo,
  SocketAuth,
} from "@hw/core";
import { io, type Socket } from "socket.io-client";

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A rejected REST call carrying the server's allow-listed error code. */
export class ApiError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode) {
    super(code);
    this.name = "ApiError";
    this.code = code;
  }
}

export function errorCodeOf(error: unknown): ErrorCode | null {
  return error instanceof ApiError ? error.code : null;
}

function errorCodeFromBody(body: unknown): ErrorCode | null {
  if (typeof body === "object" && body !== null && "error" in body) {
    const { error } = body as { error?: unknown };
    if (typeof error === "string") return error as ErrorCode;
  }
  return null;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const code = errorCodeFromBody(body);
    if (code === null) throw new Error(`HTTP ${res.status} ${path}`);
    throw new ApiError(code);
  }
  if (body === null || typeof body !== "object") throw new Error(`HTTP ${res.status} ${path}`);
  return body as T;
}

export function apiCreateRoom(b: CreateRoomBody): Promise<SessionInfo> {
  return request<SessionInfo>("/api/rooms", { method: "POST", body: JSON.stringify(b) });
}

export function apiJoinRoom(roomCode: string, b: JoinRoomBody): Promise<SessionInfo> {
  return request<SessionInfo>(`/api/rooms/${encodeURIComponent(roomCode)}/join`, {
    method: "POST",
    body: JSON.stringify(b),
  });
}

export function apiRoomInfo(roomCode: string): Promise<RoomInfo> {
  return request<RoomInfo>(`/api/rooms/${encodeURIComponent(roomCode)}`);
}

/** Opens the room socket on the page's origin (Vite proxies /socket.io to the game server). */
export function openSocket(auth: SocketAuth): GameSocket {
  const socket = io({
    auth,
    reconnection: true,
    reconnectionDelay: 500,
    reconnectionDelayMax: 4_000,
  });
  // socket.io-client's `io()` factory is not generic; the wire contract lives in @hw/core.
  return socket as unknown as GameSocket;
}
