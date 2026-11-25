import type { PlayerView } from "@hw/core";
import { UI } from "../i18n/zh-TW";
import { store } from "../store";

export function Lobby({ view }: { view: PlayerView }) {
  const me = view.me;
  const mePublic = view.players.find((player) => player.id === me.id);
  const ready = mePublic?.ready ?? false;
  const playerCount = view.players.length;
  const allReady = view.players.every((player) => player.ready);
  const canStart = allReady && playerCount >= view.rules.minPlayers;
  const inviteUrl = `${window.location.origin}/r/${view.roomCode}`;

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      store.showToast(UI.common.copied);
    } catch {
      store.showToast(UI.common.copyFailed);
    }
  };

  const kick = (playerId: string, name: string) => {
    if (!window.confirm(UI.lobby.kickConfirm(name))) return;
    void store.sendIntent({ t: "kick", target: playerId });
  };

  const startHint = !allReady
    ? UI.lobby.waitingAllReady
    : playerCount < view.rules.minPlayers
      ? UI.lobby.needPlayers(view.rules.minPlayers)
      : "";

  return (
    <section className="screen">
      <header className="screen-header">
        <div>
          <h1>{UI.lobby.title}</h1>
          <p className="room-code-line">
            <span className="muted">{UI.lobby.roomCodeLabel}</span>{" "}
            <strong className="room-code" data-testid="room-code">
              {view.roomCode}
            </strong>
          </p>
        </div>
      </header>

      <div className="invite-box">
        <span className="field-label">{UI.lobby.inviteLink}</span>
        <div className="invite-row">
          <a className="invite-link" data-testid="invite-link" href={inviteUrl}>
            {inviteUrl}
          </a>
          <button type="button" className="btn btn-ghost" onClick={() => void copyInvite()}>
            {UI.common.copy}
          </button>
        </div>
      </div>

      <h2 className="section-title">{UI.lobby.players}</h2>
      <ul className="player-list">
        {view.players.map((player) => (
          <li className="player-row" key={player.id} data-testid="player-row" data-player-id={player.id}>
            <span className="player-name">
              {player.name}
              {player.id === me.id ? <span className="player-chip-you">（{UI.common.you}）</span> : null}
            </span>
            <span className="player-tags">
              {player.isHost ? <span className="badge badge-host">{UI.lobby.host}</span> : null}
              {player.away ? <span className="badge badge-away">{UI.badges.away}</span> : null}
              {!player.connected ? <span className="badge badge-offline">{UI.badges.offline}</span> : null}
              <span className={`badge ${player.ready ? "badge-ready" : "badge-wait"}`}>
                {player.ready ? UI.lobby.ready : UI.lobby.notReady}
              </span>
            </span>
            {me.isHost && player.id !== me.id ? (
              <button type="button" className="btn btn-danger btn-small" onClick={() => kick(player.id, player.name)}>
                {UI.lobby.kick}
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="lobby-actions">
        <button
          type="button"
          className={`btn ${ready ? "btn-ghost" : "btn-primary"}`}
          data-testid="ready-toggle"
          onClick={() => void store.sendIntent({ t: "ready", ready: !ready })}
        >
          {ready ? UI.lobby.readyToggleOn : UI.lobby.readyToggleOff}
        </button>
        {me.isHost ? (
          <button
            type="button"
            className="btn btn-primary"
            data-testid="start-game"
            disabled={!canStart}
            onClick={() => void store.sendIntent({ t: "start" })}
          >
            {UI.lobby.start}
          </button>
        ) : (
          <p className="muted">{UI.lobby.waitingHost}</p>
        )}
      </div>
      {startHint.length > 0 && me.isHost ? <p className="muted">{startHint}</p> : null}
    </section>
  );
}
