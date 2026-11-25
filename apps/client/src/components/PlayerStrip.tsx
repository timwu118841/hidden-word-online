import type { PlayerView } from "@hw/core";
import { UI } from "../i18n/zh-TW";

export function PlayerStrip({ view }: { view: PlayerView }) {
  const setterId = view.turn?.setterId ?? null;
  return (
    <div className="player-strip" data-testid="player-strip">
      {view.players.map((player) => (
        <div
          key={player.id}
          className={`player-chip${player.id === view.me.id ? " player-chip-me" : ""}`}
          data-player-id={player.id}
        >
          <span className="player-chip-name">
            {player.name}
            {player.id === view.me.id ? <span className="player-chip-you">（{UI.common.you}）</span> : null}
          </span>
          <span className="player-chip-score">{player.score} 分</span>
          <span className="player-chip-pieces">{UI.turn.pieceHint(player.pieces)}</span>
          {player.id === setterId ? <span className="badge badge-setter">{UI.badges.setter}</span> : null}
          {player.away ? <span className="badge badge-away">{UI.badges.away}</span> : null}
          {!player.connected ? <span className="badge badge-offline">{UI.badges.offline}</span> : null}
        </div>
      ))}
    </div>
  );
}
