import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import {
  intentSchema,
  socketAuth,
  type ClientToServerEvents,
  type ErrorCode,
  type IntentAck,
  type ServerToClientEvents,
} from "@hw/core";
import { TokenBucket } from "../limits";
import type { RoomManager } from "../rooms/RoomManager";
import type { RoomSocket } from "../rooms/RoomRuntime";
import { drawEnvelopes } from "../words/envelope";

export type GameSocket = RoomSocket;

/**
 * Validates the handshake against a live session, then maps zod-validated
 * intents onto reducer events. The socket id is never identity: a reconnect
 * with the same session token replaces the previous socket.
 */
export function attachSocketServer(
  httpServer: HttpServer,
  rooms: RoomManager,
  words: readonly string[],
): Server<ClientToServerEvents, ServerToClientEvents> {
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    serveClient: false,
  });

  io.on("connection", (socket) => {
    const auth = socketAuth.safeParse(socket.handshake.auth);
    const resolved = auth.success ? rooms.resolveConnection(auth.data) : null;
    if (resolved === null) {
      rejectSocket(socket, "room_not_found");
      return;
    }

    const { room, playerId } = resolved;
    const replaced = room.attach(playerId, socket);
    if (replaced !== undefined && replaced !== socket) replaced.disconnect(true);

    const bucket = new TokenBucket();

    socket.on("intent", (rawIntent, ack) => {
      const respond = (result: IntentAck): void => {
        if (typeof ack === "function") ack(result);
      };

      if (!bucket.take()) {
        respond({ ok: false, code: "rate_limited" });
        return;
      }

      const parsed = intentSchema.safeParse(rawIntent);
      if (!parsed.success) {
        respond({ ok: false, code: "bad_request" });
        return;
      }
      const intent = parsed.data;

      let error: ErrorCode | undefined;
      switch (intent.t) {
        case "ready":
          error = room.dispatch({ type: "SET_READY", playerId, ready: intent.ready });
          break;

        case "kick": {
          const targetSocket = room.socketFor(intent.target);
          error = room.dispatch({ type: "KICK", by: playerId, target: intent.target });
          if (error === undefined) {
            rooms.dropPlayerSessions(room.code, intent.target);
            if (targetSocket !== undefined) {
              room.detach(intent.target, targetSocket);
              targetSocket.emit("fatal", { code: "kicked" });
              targetSocket.disconnect(true);
            }
          }
          break;
        }

        case "start": {
          const rules = room.rules;
          let envelopes: Record<string, string[][]>;
          try {
            envelopes = drawEnvelopes(
              room.playerIdsBySeat(),
              rules.rounds,
              rules.envelopeSize,
              words,
            );
          } catch (cause) {
            console.error("[socket] 無法發牌：", cause);
            respond({ ok: false, code: "bad_request" });
            return;
          }
          error = room.dispatch({ type: "START", by: playerId, envelopes });
          break;
        }

        case "pick":
          error = room.dispatch({ type: "PICK_WORD", playerId, word: intent.word });
          break;

        case "hint":
          error = room.dispatch({ type: "SUBMIT_HINT", playerId, word: intent.word });
          break;

        case "stopHints":
          error = room.dispatch({ type: "STOP_HINTS", playerId });
          break;

        case "guess":
          error = room.dispatch({ type: "SUBMIT_GUESS", playerId, words: intent.words });
          break;

        case "leave": {
          const wasLobby = room.phase === "lobby";
          error = room.dispatch({ type: "LEAVE", playerId });
          if (error !== undefined) break;
          if (wasLobby) rooms.dropPlayerSessions(room.code, playerId);
          respond({ ok: true });
          room.detach(playerId, socket);
          socket.disconnect(true);
          return;
        }
      }

      respond(error === undefined ? { ok: true } : { ok: false, code: error });
    });

    socket.on("disconnect", () => {
      if (room.socketFor(playerId) !== socket) return;
      room.detach(playerId, socket);
      room.dispatch({ type: "DISCONNECT", playerId });
    });

    const error = room.dispatch({ type: "CONNECT", playerId });
    if (error !== undefined) {
      room.detach(playerId, socket);
      rejectSocket(socket, error);
    }
  });

  return io;
}

function rejectSocket(socket: GameSocket, code: ErrorCode): void {
  socket.emit("fatal", { code });
  socket.disconnect(true);
}
