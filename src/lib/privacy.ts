import { useSyncExternalStore } from "react";

/**
 * Hide amounts: one switch that masks every dollar amount NorthStar shows ("$•••••"), for a shared
 * screen or a demo. It only changes what's displayed; saved data, Polaris's answers, and what is
 * sent to Polaris keep the real numbers. Remembered in this browser.
 */
const KEY = "northstar.hideBalances";
const MASK = "•••••";
let hidden = read();
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function moneyHidden(): boolean {
  return hidden;
}

export function setMoneyHidden(next: boolean): void {
  hidden = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    // Private browsing: the switch still works until the page reloads.
  }
  if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-hide-money", next);
  for (const listener of listeners) listener();
}

export const toggleMoneyHidden = () => setMoneyHidden(!hidden);

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Re-renders when amounts are hidden or shown. */
export function useMoneyHidden(): boolean {
  return useSyncExternalStore(subscribe, moneyHidden, () => false);
}

/** The masked form of an amount; keeps a minus sign so "you owe" still reads as owing. */
export function maskedAmount(formatted: string): string {
  return `${/^[−-]/.test(formatted) ? "−" : ""}$${MASK}`;
}

/** Masks dollar amounts inside free text (Polaris answers, tips), e.g. "spent $1,204.50 on food". */
export function maskMoneyText(text: string): string {
  return hidden ? text.replace(/[−-]?\$\s?\d[\d,]*(?:\.\d+)?(?:\s?[kKmM]\b)?/g, (m) => maskedAmount(m)) : text;
}

if (typeof document !== "undefined") document.documentElement.toggleAttribute("data-hide-money", hidden);
