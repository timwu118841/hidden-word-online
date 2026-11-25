import { useStore } from "../store";

export function Toast() {
  const { toast } = useStore();
  if (toast === null) return null;
  return (
    <div className="toast" data-testid="toast" role="status" aria-live="polite" key={toast.id}>
      {toast.text}
    </div>
  );
}
