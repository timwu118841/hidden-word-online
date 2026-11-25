import { useEffect, useState } from "react";

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function Timer({ deadline, clockOffset }: { deadline: number | null; clockOffset: number }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (deadline === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [deadline]);

  if (deadline === null) return null;

  const remaining = Math.max(0, deadline - (now + clockOffset));
  const urgent = remaining <= 10_000;
  return (
    <div className={`timer${urgent ? " timer-urgent" : ""}`} data-testid="timer" role="timer">
      {formatRemaining(remaining)}
    </div>
  );
}
