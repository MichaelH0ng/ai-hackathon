// Polaris → Check a purchase hand-off. Polaris may ask before Check a purchase is on screen (it mounts
// when My goals opens), so the request waits here until it's taken, and an event covers the case
// where it's already open.
export interface PriceCheckRequest { item: string; price: number }

const EVENT = "northstar:price-check-request";
let pending: PriceCheckRequest | null = null;

export function requestPriceCheck(request: PriceCheckRequest) {
  pending = request;
  window.dispatchEvent(new Event(EVENT));
}

/** Returns the waiting request (once), or null. */
export function takePriceCheckRequest(): PriceCheckRequest | null {
  const next = pending;
  pending = null;
  return next;
}

export function onPriceCheckRequest(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
