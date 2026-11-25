import { randomBytes, randomInt } from "node:crypto";
import {
  createGame,
  type ErrorCode,
  type GameMode,
  type RuleConfig,
  type SessionInfo,
  type SocketAuth,
} from "@hw/core";
import type { Scorer } from "../scoring/Scorer";
import { RoomRuntime } from "./RoomRuntime";

/** Unambiguous room-code alphabet, matching `roomCodeSchema` in the wire protocol. */
const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_LENGTH = 6;

/** Rooms are collected after 30 minutes empty or 30 minutes in `final`. */
const ROOM_IDLE_MS = 30 * 60_000;
const GC_INTERVAL_MS = 60_000;

/** 8 random bytes; the opaque player id is never trusted from the client. */
const PLAYER_ID_BYTES = 8;
/** 192 bits of entropy, rendered as 48 hex characters (socketAuth allows 16–128). */
const SESSION_TOKEN_BYTES = 24;

export type RulesOverride = Omit<Partial<RuleConfig>, "timers"> & {
  timers?: Partial<RuleConfig["timers"]>;
};

export interface RoomSession {
  room: RoomRuntime;
  session: SessionInfo;
}

export interface RoomManagerOptions {
  scorer: Scorer;
  rulesOverride?: RulesOverride;
  now?: () => number;
}

interface Session {
  roomCode: string;
  playerId: string;
}

/** Thrown by `create` / `join` when the room or reducer rejects the operation. */
export class RoomError extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
    this.name = "RoomError";
  }
}

/**
 * Owns the in-memory rooms and their session tokens. Sessions are keyed by the
 * opaque token handed to the browser; the socket layer never trusts a playerId
 * from the client.
 */
export class RoomManager {
  private readonly rooms = new Map<string, RoomRuntime>();
  private readonly sessions = new Map<string, Session>();
  private readonly scorer: Scorer;
  private readonly rulesOverride: RulesOverride | undefined;
  private readonly now: () => number;
  private readonly gcTimer: NodeJS.Timeout;

  constructor({ scorer, rulesOverride, now = Date.now }: RoomManagerOptions) {
    this.scorer = scorer;
    this.rulesOverride = rulesOverride;
    this.now = now;
    this.gcTimer = setInterval(() => this.sweep(), GC_INTERVAL_MS);
    this.gcTimer.unref();
  }

  create(name: string, mode: GameMode): RoomSession {
    const roomCode = this.uniqueCode();
    const playerId = randomBytes(PLAYER_ID_BYTES).toString("hex");
    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("hex");

    const state = createGame(roomCode, mode, { id: playerId, name }, this.now());
    state.rules = mergeRules(state.rules, this.rulesOverride);
    // The host was created by createGame with the preset piece count; align it with the override.
    const host = state.players[0];
    if (host !== undefined) host.pieces = state.rules.startingPieces;

    const room = new RoomRuntime({ state, scorer: this.scorer, now: this.now });
    this.rooms.set(roomCode, room);
    this.sessions.set(sessionToken, { roomCode, playerId });
    return { room, session: { roomCode, playerId, sessionToken } };
  }

  join(rawCode: string, name: string): RoomSession {
    const roomCode = rawCode.toUpperCase();
    const room = this.rooms.get(roomCode);
    if (room === undefined) throw new RoomError("room_not_found");

    const playerId = randomBytes(PLAYER_ID_BYTES).toString("hex");
    const sessionToken = randomBytes(SESSION_TOKEN_BYTES).toString("hex");
    const error = room.dispatch({ type: "JOIN", playerId, name });
    if (error !== undefined) throw new RoomError(error);

    this.sessions.set(sessionToken, { roomCode, playerId });
    return { room, session: { roomCode, playerId, sessionToken } };
  }

  get(rawCode: string): RoomRuntime | undefined {
    return this.rooms.get(rawCode.toUpperCase());
  }

  /** Resolves a socket handshake to a live room and player, or null when stale. */
  resolveConnection(auth: SocketAuth): { room: RoomRuntime; playerId: string } | null {
    const session = this.sessions.get(auth.sessionToken);
    if (session === undefined || session.roomCode !== auth.roomCode) return null;
    const room = this.rooms.get(session.roomCode);
    if (room === undefined || !room.hasPlayer(session.playerId)) return null;
    return { room, playerId: session.playerId };
  }

  /** Drops every token for one player (kick, lobby leave, GC). */
  dropPlayerSessions(roomCode: string, playerId: string): void {
    for (const [token, session] of this.sessions) {
      if (session.roomCode === roomCode && session.playerId === playerId) {
        this.sessions.delete(token);
      }
    }
  }

  /** Test/ops hook: runs one idle-room collection pass. */
  sweep(): void {
    const current = this.now();
    for (const [roomCode, room] of this.rooms) {
      const finishedAt = room.finishedAt;
      const idleSince = room.idleSince;
      const expired =
        (finishedAt !== null && current - finishedAt >= ROOM_IDLE_MS) ||
        (room.connectedCount === 0 && idleSince !== null && current - idleSince >= ROOM_IDLE_MS);
      if (!expired) continue;

      room.dispose();
      this.rooms.delete(roomCode);
      for (const [token, session] of this.sessions) {
        if (session.roomCode === roomCode) this.sessions.delete(token);
      }
    }
  }

  dispose(): void {
    clearInterval(this.gcTimer);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
    this.sessions.clear();
  }

  private uniqueCode(): string {
    let code = generateRoomCode();
    while (this.rooms.has(code)) code = generateRoomCode();
    return code;
  }
}

function generateRoomCode(): string {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_ALPHABET.charAt(randomInt(ROOM_ALPHABET.length));
  }
  return code;
}

/** Shallow rule overrides plus a deep merge for phase timers. */
function mergeRules(base: RuleConfig, override: RulesOverride | undefined): RuleConfig {
  if (override === undefined) return base;
  return {
    ...base,
    ...override,
    timers: { ...base.timers, ...override.timers },
  };
}
