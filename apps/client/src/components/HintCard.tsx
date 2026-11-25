import { scoreBand, type HintView, type RuleConfig } from "@hw/core";
import { hintReason, UI } from "../i18n/zh-TW";
import { ScoreBand } from "./ScoreBand";

export function HintCard({ hint, rules }: { hint: HintView; rules: RuleConfig }) {
  const failed = hint.status === "rejected" || hint.status === "failed";
  const band = hint.score !== null ? scoreBand(hint.score) : null;
  return (
    <li
      className={`hint-card status-${hint.status}${band !== null ? ` band-${band}` : ""}`}
      data-testid="hint-card"
      data-status={hint.status}
      data-score={hint.score ?? ""}
    >
      <div className="hint-card-main">
        <span className="hint-word">{hint.word ?? "●●●"}</span>
        {hint.status === "pending" ? (
          <span className="spinner" aria-label={UI.hintStatus.pending} />
        ) : hint.score !== null ? (
          <ScoreBand score={hint.score} />
        ) : (
          <span className="hint-score muted">—</span>
        )}
      </div>
      <div className="hint-card-meta">
        <span className={`hint-status${failed ? " hint-status-bad" : ""}`}>{UI.hintStatus[hint.status]}</span>
        {hint.reason !== null ? (
          <span className="hint-reason">{hintReason(hint.reason, rules.maxWordLength)}</span>
        ) : null}
      </div>
    </li>
  );
}
