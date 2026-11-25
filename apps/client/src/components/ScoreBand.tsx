import { scoreBand } from "@hw/core";
import { UI } from "../i18n/zh-TW";

export function ScoreBand({ score }: { score: number }) {
  const band = scoreBand(score);
  return (
    <span className={`score-band band-${band}`}>
      <span className="score-value">{score}</span>
      <span className="score-label">{UI.bands[band]}</span>
    </span>
  );
}
