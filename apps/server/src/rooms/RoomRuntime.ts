import {
  reduce,
  viewFor,
  type ClientToServerEvents,
  type Effect,
  type ErrorCode,
  type GameEvent,
  type GameState,
  type Phase,
  type PlayerId,
  type PlayerView,
  type RoomInfo,
  type RuleConfig,
  type ServerToClientEvents,
} from "@hw/core";
import type { Socket } from "socket.io";
import { ScorerError, type Scorer } from "../scoring/Scorer";

export type RoomSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export interface RoomRuntimeOptions {
  state: GameState;
  scorer: Scorer;
  now?: () => number;
}

/**
 * One live room: owns the authoritative state, runs the pure reducer, executes
 * its effects (scoring calls, timers) and pushes a freshly redacted view to every
 * connected player after each successful dispatch.
 */
export class RoomRuntime {
  private state: GameState;
  private readonly scorer: Scorer;
  private readonly now: () => number;

  private readonly sockets = new Map<PlayerId, RoomSocket>();
  private readonly awayTimers = new Map<PlayerId, NodeJS.Timeout>();
  private phaseTimer: NodeJS.Timeout | undefined;

  private idleSinceMs: number | null;
  private finishedAtMs: number | null = null;
  private disposed = false;

  constructor({ state, scorer, now = Date.now }: RoomRuntimeOptions) {
    this.state = state;
    this.scorer = scorer;
    this.now = now;
    this.idleSinceMs = now();
  }

  get code(): string {
    return this.state.roomCode;
  }

  get phase(): Phase {
    return this.state.phase;
  }

  get rules(): RuleConfig {
    return this.state.rules;
  }

  get connectedCount(): number {
    return this.sockets.size;
  }

  /** Timestamp of the last transition to zero connected sockets, if currently empty. */
  get idleSince(): number | null {
    return this.idleSinceMs;
  }

  /** Timestamp the game reached `final`, if it has. */
  get finishedAt(): number | null {
    return this.finishedAtMs;
  }

  hasPlayer(playerId: PlayerId): boolean {
    return this.state.players.some((player) => player.id === playerId);
  }

  playerIdsBySeat(): PlayerId[] {
    return [...this.state.players].sort((a, b) => a.seat - b.seat).map((player) => player.id);
  }

  socketFor(playerId: PlayerId): RoomSocket | undefined {
    return this.sockets.get(playerId);
  }

  /** Registers a socket as the player's current connection; returns the replaced one. */
  attach(playerId: PlayerId, socket: RoomSocket): RoomSocket | undefined {
    const previous = this.sockets.get(playerId);
    this.sockets.set(playerId, socket);
    this.idleSinceMs = null;
    return previous;
  }

  /** Detaches the player's socket, unless `socket` is given and is no longer current. */
  detach(playerId: PlayerId, socket?: RoomSocket): void {
    const current = this.sockets.get(playerId);
    if (current === undefined) return;
    if (socket !== undefined && current !== socket) return;
    this.sockets.delete(playerId);
    if (this.sockets.size === 0) this.idleSinceMs = this.now();
  }

  info(): RoomInfo {
    const maxPlayers = this.state.rules.maxPlayers;
    return {
      roomCode: this.state.roomCode,
      mode: this.state.mode,
      phase: this.state.phase,
      players: this.state.players.length,
      maxPlayers,
      joinable: this.state.phase === "lobby" && this.state.players.length < maxPlayers,
    };
  }

  /**
   * Applies one event. Invalid intents leave the state untouched and return the
   * reducer's error code; successful dispatches broadcast every player's view.
   */
  dispatch(event: GameEvent): ErrorCode | undefined {
    if (this.disposed) return "room_not_found";

    const result = reduce(this.state, event, this.now());
    if (result.error !== undefined) return result.error;

    this.state = result.state;
    this.applyEffects(result.effects);
    if (this.state.phase === "final" && this.finishedAtMs === null) {
      this.finishedAtMs = this.now();
    }
    this.broadcast();
    return undefined;
  }

  broadcast(): void {
    const serverNow = Date.now();
    for (const [playerId, socket] of this.sockets) {
      if (!this.hasPlayer(playerId)) continue;
      const view: PlayerView = { ...viewFor(this.state, playerId), serverNow };
      socket.emit("view", view);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPhaseTimer();
    for (const timer of this.awayTimers.values()) clearTimeout(timer);
    this.awayTimers.clear();
    this.sockets.clear();
  }

  private applyEffects(effects: readonly Effect[]): void {
    for (const effect of effects) {
      switch (effect.type) {
        case "scoreHint":
          void this.runScoreHint(effect);
          break;
        case "setTimer":
          this.schedulePhaseTimer(effect.phaseSeq, effect.deadline);
          break;
        case "clearTimer":
          this.clearPhaseTimer();
          break;
        case "setAwayTimer":
          this.scheduleAwayTimer(effect.playerId, effect.connSeq, effect.deadline);
          break;
        case "gameOver":
          if (this.finishedAtMs === null) this.finishedAtMs = this.now();
          break;
      }
    }
  }

  private async runScoreHint(effect: Extract<Effect, { type: "scoreHint" }>): Promise<void> {
    try {
      const result = await this.scorer.score(effect.hidden, effect.hint);
      this.dispatch({
        type: "HINT_SCORED",
        hintId: effect.hintId,
        score: result.score,
        isNoun: result.isNoun,
      });
    } catch (error) {
      const reason = error instanceof ScorerError ? error.reason : "scorer_error";
      this.dispatch({ type: "HINT_FAILED", hintId: effect.hintId, reason });
    }
  }

  private schedulePhaseTimer(phaseSeq: number, deadline: number): void {
    this.clearPhaseTimer();
    const delay = Math.max(0, deadline - this.now());
    const timer = setTimeout(() => {
      this.phaseTimer = undefined;
      this.dispatch({ type: "TIMEOUT", phaseSeq, rand: Math.random() });
    }, delay);
    timer.unref();
    this.phaseTimer = timer;
  }

  private clearPhaseTimer(): void {
    clearTimeout(this.phaseTimer);
    this.phaseTimer = undefined;
  }

  private scheduleAwayTimer(playerId: PlayerId, connSeq: number, deadline: number): void {
    clearTimeout(this.awayTimers.get(playerId));

    const delay = Math.max(0, deadline - this.now());
    const timer = setTimeout(() => {
      this.awayTimers.delete(playerId);
      this.dispatch({ type: "AWAY_TIMEOUT", playerId, connSeq });
    }, delay);
    timer.unref();
    this.awayTimers.set(playerId, timer);
  }
}
