import { useEffect } from "react";
import { UI } from "./i18n/zh-TW";
import { Lobby } from "./screens/Lobby";
import { Pick } from "./screens/Pick";
import { Turn } from "./screens/Turn";
import { Final } from "./screens/Final";
import { Home, JoinForm } from "./screens/Home";
import { PlayerStrip } from "./components/PlayerStrip";
import { RulesSheet } from "./components/RulesSheet";
import { Toast } from "./components/Toast";
import { loadSession, store, useStore } from "./store";

export function App() {
  const { route } = useStore();

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, []);

  return (
    <div className="app">
      {route.kind === "home" ? <Home /> : <Room code={route.code} />}
      <ReconnectBanner />
      <Toast />
    </div>
  );
}

function Room({ code }: { code: string }) {
  const state = useStore();

  useEffect(() => {
    store.openRoom(code);
  }, [code]);

  if (loadSession(code) === null) {
    return (
      <div className="page">
        <header className="brand">
          <h1>{UI.common.appName}</h1>
          <p className="brand-tagline">{UI.home.tagline}</p>
        </header>
        <JoinForm initialCode={code} />
        <button type="button" className="btn btn-ghost" onClick={() => store.navigate("/")}>
          {UI.common.home}
        </button>
      </div>
    );
  }

  const view = state.view;
  if (view === null) {
    return (
      <div className="page center-panel">
        <p className="muted">{UI.common.connecting}</p>
      </div>
    );
  }

  return (
    <div className="game-shell">
      <PlayerStrip view={view} />
      <main className="game-main">
        {view.phase === "lobby" ? <Lobby view={view} /> : null}
        {view.phase === "pick" ? <Pick view={view} /> : null}
        {view.phase === "hint" || view.phase === "guess" || view.phase === "result" ? <Turn view={view} /> : null}
        {view.phase === "final" ? <Final view={view} /> : null}
      </main>
      <RulesSheet rules={view.rules} />
    </div>
  );
}

function ReconnectBanner() {
  const { route, connection, view } = useStore();
  const visible =
    route.kind === "room" && (connection === "disconnected" || (connection === "connecting" && view !== null));
  if (!visible) return null;
  return (
    <div className="reconnect-banner" data-testid="reconnect-banner" role="status">
      {UI.common.reconnecting}
    </div>
  );
}
