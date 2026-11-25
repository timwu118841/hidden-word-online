import { useEffect, useState, type FormEvent } from "react";
import { MODE_PRESETS, NAME_MAX, type GameMode, type RoomInfo } from "@hw/core";
import { errorMessage, UI } from "../i18n/zh-TW";
import { apiRoomInfo, errorCodeOf } from "../net/client";
import { isValidRoomCode, store, useStore } from "../store";

function modeLabel(mode: GameMode): string {
  return mode === "quick"
    ? UI.home.modeQuick(MODE_PRESETS.quick.rounds)
    : UI.home.modeFull(MODE_PRESETS.full.rounds);
}

export function Home() {
  const { busy } = useStore();
  const [name, setName] = useState("");
  const [mode, setMode] = useState<GameMode>("quick");

  const handleCreate = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length === 0) {
      store.showToast(UI.home.invalidName);
      return;
    }
    void store.createRoom(trimmed, mode);
  };

  return (
    <div className="page">
      <header className="brand">
        <h1>{UI.common.appName}</h1>
        <p className="brand-tagline">{UI.home.tagline}</p>
        <p className="brand-intro muted">{UI.home.intro}</p>
      </header>

      <section className="card">
        <h2 className="card-title">{UI.home.createTitle}</h2>
        <form className="form" onSubmit={handleCreate}>
          <label className="field">
            <span className="field-label">{UI.home.nickname}</span>
            <input
              className="input"
              data-testid="name-input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={UI.home.nicknamePlaceholder}
              maxLength={NAME_MAX}
              autoComplete="nickname"
              required
            />
          </label>
          <div className="field">
            <span className="field-label">{UI.home.mode}</span>
            <div className="mode-row">
              <button
                type="button"
                className={`btn mode-btn${mode === "quick" ? " mode-btn-active" : ""}`}
                data-testid="mode-quick"
                aria-pressed={mode === "quick"}
                onClick={() => setMode("quick")}
              >
                {modeLabel("quick")}
              </button>
              <button
                type="button"
                className={`btn mode-btn${mode === "full" ? " mode-btn-active" : ""}`}
                data-testid="mode-full"
                aria-pressed={mode === "full"}
                onClick={() => setMode("full")}
              >
                {modeLabel("full")}
              </button>
            </div>
          </div>
          <button type="submit" className="btn btn-primary" data-testid="create-room" disabled={busy}>
            {UI.home.create}
          </button>
        </form>
      </section>

      <JoinForm />
    </div>
  );
}

export function JoinForm({ initialCode = "" }: { initialCode?: string }) {
  const { busy } = useStore();
  const [code, setCode] = useState(initialCode);
  const [joinName, setJoinName] = useState("");
  const [info, setInfo] = useState<RoomInfo | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const normalized = code.toUpperCase();

  useEffect(() => {
    if (!isValidRoomCode(normalized)) {
      setInfo(null);
      setInfoError(null);
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    apiRoomInfo(normalized)
      .then((room) => {
        if (cancelled) return;
        setInfo(room);
        setInfoError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setInfo(null);
        const code = errorCodeOf(error);
        setInfoError(code === null ? UI.common.networkError : errorMessage(code));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [normalized]);

  const handleJoin = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidRoomCode(normalized)) {
      store.showToast(UI.home.invalidCode);
      return;
    }
    const trimmed = joinName.trim();
    if (trimmed.length === 0) {
      store.showToast(UI.home.invalidName);
      return;
    }
    void store.joinRoom(normalized, trimmed);
  };

  return (
    <section className="card">
      <h2 className="card-title">{UI.home.joinTitle}</h2>
      <form className="form" onSubmit={handleJoin}>
        <label className="field">
          <span className="field-label">{UI.home.roomCode}</span>
          <input
            className="input input-code"
            data-testid="join-code-input"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder={UI.home.roomCodePlaceholder}
            maxLength={6}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="field">
          <span className="field-label">{UI.home.nickname}</span>
          <input
            className="input"
            data-testid="join-name-input"
            value={joinName}
            onChange={(event) => setJoinName(event.target.value)}
            placeholder={UI.home.joinNamePlaceholder}
            maxLength={NAME_MAX}
            autoComplete="nickname"
          />
        </label>
        <div className="room-status" aria-live="polite">
          {checking ? <p className="muted">{UI.home.loadingRoom}</p> : null}
          {infoError !== null ? <p className="form-error">{infoError}</p> : null}
          {info !== null ? (
            <p className={info.joinable ? "muted" : "form-error"}>
              {UI.home.roomSummary(
                info.players,
                info.maxPlayers,
                modeLabel(info.mode),
              )}
              {info.joinable ? "" : ` · ${UI.home.roomNotJoinable}`}
            </p>
          ) : null}
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          data-testid="join-room"
          disabled={busy || (info !== null && !info.joinable)}
        >
          {UI.home.join}
        </button>
      </form>
    </section>
  );
}
