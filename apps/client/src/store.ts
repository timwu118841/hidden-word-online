import { useSyncExternalStore } from "react";
import type { GameMode, Intent, PlayerView, SessionInfo } from "@hw/core";
import { errorMessage, UI } from "./i18n/zh-TW";
import { apiCreateRoom, apiJoinRoom, errorCodeOf, openSocket, type GameSocket } from "./net/client";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected";

export type Route = { kind: "home" } | { kind: "room"; code: string };

export interface ToastMessage {
  id: number;
  text: string;
}

export interface AppState {
  route: Route;
  view: PlayerView | null;
  connection: ConnectionStatus;
  clockOffset: number;
  toast: ToastMessage | null;
  busy: boolean;
}

/* ------------------------------------------------------------------ */
/* Session persistence (per room)                                      */
/* ------------------------------------------------------------------ */

const SESSION_PREFIX = "hw:session:";
const ROOM_ROUTE = /^\/r\/([A-HJ-NP-Z2-9]{6})\/?$/i;
const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/i;

const memorySessions = new Map<string, SessionInfo>();

function sessionKey(roomCode: string): string {
  return `${SESSION_PREFIX}${roomCode.toUpperCase()}`;
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Storage may be blocked (private mode); the in-memory map keeps this tab working.
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota or privacy failures fall back to memorySessions.
  }
}

function removeStorage(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing else to clean up.
  }
}

function parseSession(raw: string): SessionInfo | null {
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { roomCode, playerId, sessionToken } = value as {
    roomCode?: unknown;
    playerId?: unknown;
    sessionToken?: unknown;
  };
  if (typeof roomCode !== "string" || typeof playerId !== "string" || typeof sessionToken !== "string") {
    return null;
  }
  return { roomCode, playerId, sessionToken };
}

export function loadSession(roomCode: string): SessionInfo | null {
  const key = sessionKey(roomCode);
  const raw = readStorage(key);
  if (raw === null) return memorySessions.get(key) ?? null;
  const session = parseSession(raw);
  if (session === null) {
    clearSession(roomCode);
    return null;
  }
  memorySessions.set(key, session);
  return session;
}

export function saveSession(session: SessionInfo): void {
  const key = sessionKey(session.roomCode);
  memorySessions.set(key, session);
  writeStorage(key, JSON.stringify(session));
}

export function clearSession(roomCode: string): void {
  const key = sessionKey(roomCode);
  memorySessions.delete(key);
  removeStorage(key);
}

export function isValidRoomCode(code: string): boolean {
  return ROOM_CODE.test(code);
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

function parseRoute(pathname: string): Route {
  const match = ROOM_ROUTE.exec(pathname);
  const code = match?.[1];
  return code ? { kind: "room", code: code.toUpperCase() } : { kind: "home" };
}

class Store {
  private state: AppState;
  private listeners = new Set<() => void>();
  private socket: GameSocket | null = null;
  private socketRoom: string | null = null;
  private socketGen = 0;
  private toastSeq = 0;
  private toastTimer: number | null = null;
  private popstateHandler: (() => void) | null = null;

  constructor() {
    this.state = {
      route: typeof window === "undefined" ? { kind: "home" } : parseRoute(window.location.pathname),
      view: null,
      connection: "idle",
      clockOffset: 0,
      toast: null,
      busy: false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (): AppState => this.state;

  start(): void {
    if (this.popstateHandler !== null) return;
    this.popstateHandler = () => this.applyRoute(parseRoute(window.location.pathname));
    window.addEventListener("popstate", this.popstateHandler);
  }

  stop(): void {
    if (this.popstateHandler === null) return;
    window.removeEventListener("popstate", this.popstateHandler);
    this.popstateHandler = null;
  }

  navigate(path: string, replace = false): void {
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    this.applyRoute(parseRoute(path));
  }

  private applyRoute(route: Route): void {
    this.set({ route });
    if (route.kind === "home") this.leaveRoom();
  }

  private set(patch: Partial<AppState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  /* -------------------------- rooms / sockets -------------------------- */

  /** Called by the room screen on mount; connects when a stored session exists. */
  openRoom(rawCode: string): void {
    const code = rawCode.toUpperCase();
    const session = loadSession(code);
    if (session === null) {
      this.leaveRoom();
      return;
    }
    if (this.socketRoom === code && this.socket?.active) return;
    this.connect(code, session);
  }

  private connect(code: string, session: SessionInfo): void {
    this.disconnectSocket();
    const gen = ++this.socketGen;
    this.set({ connection: "connecting", view: null, clockOffset: 0 });

    const socket = openSocket({ roomCode: code, sessionToken: session.sessionToken });
    this.socket = socket;
    this.socketRoom = code;

    socket.on("view", (view) => {
      if (gen !== this.socketGen) return;
      this.set({
        view,
        connection: "connected",
        clockOffset: view.serverNow - Date.now(),
      });
    });

    socket.on("fatal", (payload) => {
      if (gen !== this.socketGen) return;
      clearSession(code);
      this.disconnectSocket();
      this.set({ view: null, clockOffset: 0 });
      this.navigate("/", true);
      this.showToast(errorMessage(payload.code));
    });

    socket.on("connect", () => {
      if (gen !== this.socketGen) return;
      this.set({ connection: "connected" });
    });

    socket.on("disconnect", () => {
      if (gen !== this.socketGen) return;
      this.set({ connection: "disconnected" });
    });

    socket.on("connect_error", () => {
      if (gen !== this.socketGen) return;
      this.set({ connection: "disconnected" });
    });
  }

  private disconnectSocket(): void {
    this.socketGen += 1;
    const socket = this.socket;
    this.socket = null;
    this.socketRoom = null;
    if (socket !== null) {
      socket.removeAllListeners();
      socket.disconnect();
    }
    if (this.state.connection !== "idle") this.set({ connection: "idle" });
  }

  private leaveRoom(): void {
    this.disconnectSocket();
    if (this.state.view !== null || this.state.clockOffset !== 0) {
      this.set({ view: null, clockOffset: 0 });
    }
  }

  /** Final screen → home; drops the stored session for the finished room. */
  exitHome(): void {
    const code =
      this.state.view?.roomCode ?? (this.state.route.kind === "room" ? this.state.route.code : null);
    if (code !== null) clearSession(code);
    this.disconnectSocket();
    this.set({ view: null, clockOffset: 0 });
    this.navigate("/");
  }

  /* ------------------------------ REST ------------------------------ */

  async createRoom(name: string, mode: GameMode): Promise<void> {
    this.set({ busy: true });
    try {
      const session = await apiCreateRoom({ name, mode });
      this.enterSession(session);
    } catch (error) {
      this.showToast(this.restMessage(error));
    } finally {
      this.set({ busy: false });
    }
  }

  async joinRoom(roomCode: string, name: string): Promise<void> {
    this.set({ busy: true });
    try {
      const session = await apiJoinRoom(roomCode.toUpperCase(), { name });
      this.enterSession(session);
    } catch (error) {
      this.showToast(this.restMessage(error));
    } finally {
      this.set({ busy: false });
    }
  }

  private enterSession(session: SessionInfo): void {
    saveSession(session);
    this.connect(session.roomCode, session);
    this.navigate(`/r/${session.roomCode}`);
  }

  private restMessage(error: unknown): string {
    const code = errorCodeOf(error);
    return code === null ? UI.common.networkError : errorMessage(code);
  }

  /* ---------------------------- intents ---------------------------- */

  async sendIntent(intent: Intent): Promise<boolean> {
    const socket = this.socket;
    if (socket === null || !socket.connected) {
      this.showToast(UI.common.offlineAction);
      return false;
    }
    return await new Promise<boolean>((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        this.showToast(UI.common.offlineAction);
        resolve(false);
      }, 10_000);
      socket.emit("intent", intent, (res) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (!res.ok) this.showToast(errorMessage(res.code));
        resolve(res.ok);
      });
    });
  }

  /* ----------------------------- toast ----------------------------- */

  showToast(text: string): void {
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    this.toastSeq += 1;
    this.set({ toast: { id: this.toastSeq, text } });
    this.toastTimer = window.setTimeout(() => {
      this.toastTimer = null;
      this.set({ toast: null });
    }, 3_500);
  }
}

export const store = new Store();

export function useStore(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
