import { useEffect, useState } from "react";
import { CircleCheck, X } from "lucide-react";
import { onToast, type ToastMessage } from "../lib/toast";

/** Shows one toast at a time at the bottom of the screen; it fades after a few seconds. */
export function Toast() {
  const [message, setMessage] = useState<(ToastMessage & { key: number }) | null>(null);
  useEffect(() => onToast((m) => setMessage({ ...m, key: Date.now() })), []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 6000);
    return () => window.clearTimeout(timer);
  }, [message]);
  return (
    <div className="app-toast-region" role="status" aria-live="polite">
      {message && (
        <div className="app-toast" key={message.key}>
          <CircleCheck size={20} aria-hidden="true" />
          <div>
            <strong>{message.title}</strong>
            {message.detail && <span>{message.detail}</span>}
          </div>
          <button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}><X size={16} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  );
}
