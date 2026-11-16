// A tiny app-wide toast: anything can announce a result, even from a panel that just closed.
const EVENT = "northstar:toast";

export interface ToastMessage { title: string; detail?: string }

export function showToast(message: ToastMessage) {
  window.dispatchEvent(new CustomEvent<ToastMessage>(EVENT, { detail: message }));
}

export function onToast(listener: (message: ToastMessage) => void) {
  const handler = (event: Event) => listener((event as CustomEvent<ToastMessage>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
