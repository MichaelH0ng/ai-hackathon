// Free, on-device clean-up for voice input. The browser's speech recognition doesn't know your
// goal names, merchants, or money words, and it often writes numbers out. This fixes the
// near-misses ("wrath IRA" → "Roth IRA", "a corns" → "Acorns", "my care fund" → "my Car fund")
// and turns spoken amounts into numbers ("eighty dollars" → "$80").

/** Finance words people say to Polaris that speech recognition tends to mangle. */
export const FINANCE_TERMS = ["Roth IRA", "traditional IRA", "401(k)", "index fund", "emergency fund", "high-yield savings", "credit score", "credit card", "Polaris", "NorthStar", "Venmo", "Zelle", "Plaid", "dividend", "brokerage"];

/** Everyday words that must never be "corrected" into a name on their own. */
const COMMON = new Set(("a about after all also am an and any are as at be because been before but by can car care could day did do does done down each even every few find for from get give go going good got had has have he her here him his how i if in into is it its just know last less like look make many me might money month more most much must my need new next no not now of off on one only or other our out over own pay put really said same save saw say see shall she should show since so some spend spent still such sure take than that the their them then there these they thing this those through time to too two up us use very want was way we week well went were what when where which while who why will with would year yes yet you your").split(" "));

const letters = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A rough sound-alike key: similar-sounding words share it ("wrath"/"roth", "care"/"car"). */
export function soundKey(word: string): string {
  let s = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return "";
  s = s.replace(/^wr/, "r").replace(/^kn/, "n").replace(/^ps/, "s").replace(/ph/g, "f").replace(/ck/g, "k")
    .replace(/c(?=[eiy])/g, "s").replace(/c/g, "k").replace(/q/g, "k").replace(/x/g, "ks").replace(/z/g, "s")
    .replace(/gh/g, "").replace(/([^aeiou])h/g, "$1");
  return (s[0] + s.slice(1).replace(/[aeiouyhw]/g, "")).replace(/(.)\1+/g, "$1");
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** How well a run of spoken words matches a known name (0 = no match). */
function matchScore(spoken: string[], name: string): number {
  const said = letters(spoken.join(""));
  const target = letters(name);
  if (said.length < 4 || target.length < 5) return 0;
  if (Math.abs(said.length - target.length) > Math.max(2, target.length * 0.4)) return 0;
  // One ordinary word ("care", "shall") is never swapped for a name.
  if (spoken.length === 1 && COMMON.has(said)) return 0;
  const sim = similarity(said, target);
  if (said === target) return 2; // only the spacing differs: "a corns" → "Acorns"
  const soundsAlike = soundKey(spoken.join("")) === soundKey(name.replace(/\s+/g, ""));
  return (soundsAlike && sim >= 0.7) || sim >= 0.9 ? sim : 0;
}

/** Replaces near-misses of your own names and finance terms with the right spelling. */
export function correctNames(text: string, names: string[]): string {
  const vocab = [...new Set(names.map((n) => n.trim()).filter((n) => letters(n).length >= 5))];
  if (!vocab.length) return text;
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < words.length; ) {
    let best: { name: string; size: number; score: number } | null = null;
    for (const name of vocab) {
      const n = name.split(/\s+/).length;
      for (let size = Math.min(n + 1, words.length - i); size >= Math.max(1, n - 1); size--) {
        const spoken = words.slice(i, i + size);
        // Already right apart from capitals: leave the user's words alone.
        if (spoken.join(" ").toLowerCase().replace(/[.,!?;:]+$/, "") === name.toLowerCase()) continue;
        const score = matchScore(spoken.map((w) => w.replace(/[^\w'-]/g, "")), name);
        if (score && (!best || score > best.score || (score === best.score && size > best.size))) best = { name, size, score };
      }
    }
    if (best) {
      const trailing = words[i + best.size - 1].match(/[.,!?;:]+$/)?.[0] ?? "";
      out.push(best.name + trailing);
      i += best.size;
    } else {
      out.push(words[i]);
      i += 1;
    }
  }
  return out.join(" ");
}

/** Of the recognizer's guesses, the one that mentions the most of your names (ties: its first guess). */
export function bestAlternative(alternatives: string[], names: string[]): string {
  const lowered = names.map((n) => n.toLowerCase());
  let best = alternatives[0] ?? "";
  let bestHits = -1;
  for (const alt of alternatives) {
    const text = alt.toLowerCase();
    const hits = lowered.filter((n) => n.length >= 3 && text.includes(n)).length;
    if (hits > bestHits) { best = alt; bestHits = hits; }
  }
  return best;
}

const ONES: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1_000, million: 1_000_000 };
const NUMBER_WORD = new RegExp(`^(${[...Object.keys(ONES), ...Object.keys(TENS), ...Object.keys(SCALES), "a", "and"].join("|")})$`);

/** Reads a run of number words ("a hundred and twenty") or returns null. */
function wordsToNumber(words: string[]): number | null {
  let total = 0;
  let current = 0;
  let seen = false;
  for (const [i, raw] of words.entries()) {
    const w = raw.toLowerCase();
    if (w === "and") continue;
    if (w === "a") { if (!SCALES[words[i + 1]?.toLowerCase()]) return null; current = 1; continue; }
    if (w in ONES) { current += ONES[w]; seen = true; }
    else if (w in TENS) { current += TENS[w]; seen = true; }
    else if (w === "hundred") { current = (current || 1) * 100; seen = true; }
    else if (w in SCALES) { total += (current || 1) * SCALES[w]; current = 0; seen = true; }
    else return null;
  }
  return seen ? total + current : null;
}

/**
 * Spoken amounts as numbers: "eighty dollars" → "$80", "a hundred and twenty bucks" → "$120",
 * "fifteen hundred" → "1500", "$80 dollars" → "$80", "5 dollars and 50 cents" → "$5.50".
 * Small lone numbers ("which one") are left as words.
 */
export function spokenAmounts(text: string): string {
  const tokens = text.split(/(\s+)/);
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i].toLowerCase().replace(/-/g, " ");
    // Collect a run of number words (hyphenated "twenty-five" counts too).
    const nextWord = tokens.slice(i + 1).find((t) => t.trim())?.toLowerCase() ?? "";
    const startsRun = word === "a" ? nextWord in SCALES : word !== "and";
    if (word.trim() && word.split(" ").every((w) => NUMBER_WORD.test(w)) && startsRun) {
      const run: string[] = [];
      let j = i;
      let trailing = "";
      while (j < tokens.length) {
        if (!tokens[j].trim()) { j++; continue; }
        const clean = tokens[j].toLowerCase().replace(/[.,!?;:]+$/, "");
        const parts = clean.replace(/-/g, " ").split(" ");
        if (!parts.every((w) => NUMBER_WORD.test(w))) break;
        run.push(...parts);
        trailing = tokens[j].slice(clean.length);
        j++;
        if (trailing) break;
      }
      while (run.length && (run[run.length - 1] === "and" || run[run.length - 1] === "a")) run.pop();
      const value = wordsToNumber(run);
      const next = tokens.slice(j).find((t) => t.trim())?.toLowerCase() ?? "";
      const money = /^(dollars?|bucks?|cents?)\b/.test(next);
      if (value !== null && (value >= 10 || money || run.some((w) => w in SCALES))) {
        out.push(String(value) + trailing);
        // Rejoin with the rest, keeping the whitespace that followed the run.
        i = j - 1;
        continue;
      }
    }
    out.push(tokens[i]);
  }
  return out.join("")
    .replace(/\$?(\d[\d,]*)(?:\s+(?:dollars?|bucks?))?\s+and\s+(\d{1,2})\s+cents?\b/gi, (_, d: string, c: string) => `$${d}.${c.padStart(2, "0")}`)
    .replace(/\$?(\d[\d,]*(?:\.\d+)?)\s*(?:dollars?|bucks?|usd)\b/gi, (_, n: string) => `$${n}`)
    .replace(/\b(\d{1,2})\s+cents?\b/gi, (_, c: string) => `$0.${c.padStart(2, "0")}`);
}

/** Everything above, in the order that works best. */
export function fixVoiceText(text: string, names: string[]): string {
  return spokenAmounts(correctNames(text, [...names, ...FINANCE_TERMS]));
}
