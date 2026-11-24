// Any screen can hand Polaris a question: it opens the chat and asks it, as if you had typed it.
const EVENT = "northstar:ask-polaris";

export function askPolaris(question: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: question }));
}

export function onAskPolaris(listener: (question: string) => void): () => void {
  const handler = (event: Event) => {
    const text = (event as CustomEvent<string>).detail;
    if (typeof text === "string" && text.trim()) listener(text);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
