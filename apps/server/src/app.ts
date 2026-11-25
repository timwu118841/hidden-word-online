import { once } from "node:events";
import type { Server as HttpServer } from "node:http";
import type { Server as IOServer } from "socket.io";
import type { ClientToServerEvents, ServerToClientEvents } from "@hw/core";
import { createHttpServer } from "./http";
import { attachSocketServer } from "./net/socket";
import { RoomManager, type RulesOverride } from "./rooms/RoomManager";
import type { Scorer } from "./scoring/Scorer";

export interface CreateAppOptions {
  scorer: Scorer;
  words: readonly string[];
  clientDist?: string;
  rulesOverride?: RulesOverride;
  now?: () => number;
}

export interface CreatedApp {
  httpServer: HttpServer;
  io: IOServer<ClientToServerEvents, ServerToClientEvents>;
  rooms: RoomManager;
  close(): Promise<void>;
}

/**
 * Wires the room manager, HTTP API/static server and Socket.IO namespace into
 * one process. The caller owns `listen`; tests bind port 0.
 */
export function createApp(options: CreateAppOptions): CreatedApp {
  const rooms = new RoomManager({
    scorer: options.scorer,
    rulesOverride: options.rulesOverride,
    now: options.now,
  });
  const httpServer = createHttpServer({
    rooms,
    clientDist: options.clientDist,
    now: options.now,
  });
  const io = attachSocketServer(httpServer, rooms, options.words);

  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    rooms.dispose();
    await io.close();
    if (httpServer.listening) {
      const closedEvent = once(httpServer, "close");
      httpServer.close();
      await closedEvent;
    }
  }

  return { httpServer, io, rooms, close };
}
