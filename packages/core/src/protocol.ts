import { z } from "zod";
import type { ErrorCode, PlayerView } from "./types";

/**
 * Wire protocol.
 *
 * HTTP (JSON):
 *   POST /api/rooms              body CreateRoomBody  -> SessionInfo | ApiError
 *   POST /api/rooms/:code/join   body JoinRoomBody    -> SessionInfo | ApiError
 *   GET  /api/rooms/:code                             -> RoomInfo | ApiError
 *
 * Socket.IO (path "/socket.io"):
 *   handshake auth: SocketAuth
 *   C2S  "intent" (Intent, ack: (res: IntentAck) => void)
 *   S2C  "view"   (PlayerView)          full per-player view on every change and on connect
 *   S2C  "fatal"  ({ code: ErrorCode }) e.g. room_not_found / kicked; client returns home
 */

export const NAME_MAX = 12;

export const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(NAME_MAX)
  .regex(/^[\p{L}\p{N}_ ]+$/u);

export const roomCodeSchema = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);

export const createRoomBody = z.object({
  name: nameSchema,
  mode: z.enum(["quick", "full"]),
});
export type CreateRoomBody = z.infer<typeof createRoomBody>;

export const joinRoomBody = z.object({ name: nameSchema });
export type JoinRoomBody = z.infer<typeof joinRoomBody>;

export interface SessionInfo {
  roomCode: string;
  playerId: string;
  sessionToken: string;
}

export interface RoomInfo {
  roomCode: string;
  mode: "quick" | "full";
  phase: PlayerView["phase"];
  players: number;
  maxPlayers: number;
  joinable: boolean;
}

export interface ApiError {
  error: ErrorCode;
}

export const socketAuth = z.object({
  roomCode: roomCodeSchema,
  sessionToken: z.string().min(16).max(128),
});
export type SocketAuth = z.infer<typeof socketAuth>;

/** Raw user text; the server normalizes and validates content rules. */
const word = z.string().min(1).max(32);

export const intentSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("ready"), ready: z.boolean() }),
  z.object({ t: z.literal("kick"), target: z.string().min(1).max(64) }),
  z.object({ t: z.literal("start") }),
  z.object({ t: z.literal("pick"), word }),
  z.object({ t: z.literal("hint"), word }),
  z.object({ t: z.literal("stopHints") }),
  /** [] = pass; 2 entries spends a Piece. */
  z.object({ t: z.literal("guess"), words: z.array(word).max(2) }),
  z.object({ t: z.literal("leave") }),
]);
export type Intent = z.infer<typeof intentSchema>;

export type IntentAck = { ok: true } | { ok: false; code: ErrorCode };

export interface ServerToClientEvents {
  view: (view: PlayerView) => void;
  fatal: (payload: { code: ErrorCode | "kicked" }) => void;
}

export interface ClientToServerEvents {
  intent: (intent: Intent, ack: (res: IntentAck) => void) => void;
}
