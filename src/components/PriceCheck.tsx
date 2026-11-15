import { Camera, Clock, ImageUp, Lightbulb, PiggyBank, RotateCcw, Tag, Wallet } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatMoney, hoursOfWork, projectedDate, whatIfSpend } from "../lib/finance";
import type { BankSnapshot, MoneyGoal, Profile } from "../lib/types";
import { type LogDecision, MoneyWhatIf, type WhatIfItem } from "./MoneyWhatIf";
import { Button, Card, NumberField, Notice, TextField } from "./ui";

/** Shrink photos before upload: faster, cheaper, and converts HEIC to JPEG in Safari. */
async function toJpegDataUrl(file: File, maxSide = 1568): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

interface ScanResponse {
  kind: "single_item" | "cart" | "no_price_found";
  items: { name: string; price: number; estimated: boolean }[];
  total: number | null;
  cheaper_alternative: { description: string; price: number } | null;
  note: string;
}

interface Checked extends WhatIfItem {
  estimated: boolean;
  lines?: { name: string; price: number }[]; // cart line items
  note?: string;
}

/**
 * "At the store" flow: snap a price tag (or type the price), then see what the
 * item costs each of your savings goals before you buy it.
 */
export function PriceCheck({
  moneyGoals,
  profile,
  bank,
  onUpdateGoal,
  onLog,
  onNewGoal,
  onSettings,
}: {
  moneyGoals: MoneyGoal[];
  profile: Profile;
  bank?: BankSnapshot;
  onUpdateGoal: (g: MoneyGoal) => void;
  onLog: (goal: MoneyGoal, d: LogDecision) => void;
  onNewGoal: () => void;
  onSettings: () => void;
}) {
  const uploadRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState<number | "">("");
  const [item, setItem] = useState<Checked | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [goalId, setGoalId] = useState(moneyGoals[0]?.id ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [version, setVersion] = useState(0); // resets the What-If when the item changes
  const [dragging, setDragging] = useState(false); // a file is being dragged over the drop zone

  const goal = moneyGoals.find((g) => g.id === goalId) ?? moneyGoals[0];

  function show(next: Checked) {
    setItem(next);
    setMessage(null);
    setVersion((v) => v + 1);
    setTimeout(() => document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function reset() {
    setItem(null);
    setPreview(null);
    setError(null);
    setName("");
    setPrice("");
    setMessage(null);
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setItem(null);
    setLoading(true);
    try {
      const image = await toJpegDataUrl(file);
      setPreview(image);
      const res = await fetch("/api/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image }) });
      const body = await res.json().catch(() => ({ error: "The price reader isn't responding. Is the server running?" }));
      if (!res.ok) throw new Error(body.error ?? "Couldn't read that photo.");
      const r = body as ScanResponse;
      if (r.kind === "no_price_found" || !r.items.length) throw new Error("We couldn't find a price in that photo. Try a closer shot of the tag, or type the price below.");
      const lines = r.items.map((i) => ({ name: i.name, price: i.price }));
      setPicked(lines.map(() => true));
      const isCart = r.kind === "cart" && lines.length > 1;
      const total = r.total ?? lines.reduce((s, l) => s + l.price, 0);
      setName(isCart ? "Your cart" : lines[0].name);
      setPrice(Math.round((isCart ? total : lines[0].price) * 100) / 100);
      show({
        label: isCart ? "your cart" : lines[0].name,
        price: isCart ? total : lines[0].price,
        alternative: r.cheaper_alternative,
        estimated: r.items.some((i) => i.estimated),
        lines: isCart ? lines : undefined,
        note: r.note || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that photo.");
    } finally {
      setLoading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  function handleDroppedFiles(files: FileList) {
    const file = files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("That file isn't a photo. Drop an image like a JPG, PNG or screenshot, or type the price below.");
      return;
    }
    void handleFile(file);
  }

  // A photo dropped just outside the drop zone would otherwise open in the browser tab and leave the app.
  useEffect(() => {
    const block = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  function toggleLine(i: number) {
    if (!item?.lines) return;
    const next = picked.map((v, j) => (j === i ? !v : v));
    setPicked(next);
    const total = item.lines.reduce((s, l, j) => (next[j] ? s + l.price : s), 0);
    setPrice(Math.round(total * 100) / 100);
    setItem({ ...item, price: total });
    setVersion((v) => v + 1);
  }

  const money = (n: number) => formatMoney(n, n % 1 !== 0);

  return (
    <section id="goal-price-check" className="goal-price-check space-y-4 scroll-mt-28" aria-labelledby="goal-price-check-title">
      <div>
        <h2 id="goal-price-check-title" className="text-3xl font-bold text-ink"><Tag aria-hidden="true" /> Check a purchase</h2>
        <p className="mt-1 text-stone-600">See how a price changes your goal timeline.</p>
      </div>

      {/* 1. Capture */}
      <Card className="purchase-check-entry">
        <details className="goals-photo-option">
        <summary><Camera size={18} aria-hidden="true" /> Use a photo instead</summary>
        <div className="relative w-full rounded-2xl bg-brand-600 px-18 py-4 text-center text-white shadow-[0_5px_0_0_rgb(59_7_100/0.25)]">
          {/* Icon sits on the left edge; the text is centred across the whole box, independent of the icon. */}
          <span className="absolute top-1/2 left-4 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-2xl bg-white/15"><Camera className="h-6 w-6" aria-hidden="true" /></span>
          <span className="block">
            <span className="block font-display text-lg font-bold">Snap the price tag</span>
            <span className="block text-sm text-brand-100">Add a photo below. We'll read the item and price.</span>
          </span>
        </div>
        <button
          onClick={() => uploadRef.current?.click()}
          disabled={loading}
          onDragEnter={(e) => { e.preventDefault(); if (!loading) setDragging(true); }}
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = loading ? "none" : "copy"; }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            if (!loading) handleDroppedFiles(e.dataTransfer.files);
          }}
          className={`mt-3 flex min-h-12 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-3 text-sm font-bold transition-colors duration-200 disabled:opacity-60 pointer-fine:min-h-28 ${
            dragging ? "border-brand-500 bg-brand-50 text-brand-700" : "border-stone-300 bg-stone-100 text-stone-800 hover:bg-stone-200"
          }`}
        >
          <span className="flex items-center gap-2">
            <ImageUp className="h-4 w-4" aria-hidden="true" />
            <span className="pointer-fine:hidden">Take or upload a photo</span>
            <span className="hidden pointer-fine:inline">{dragging ? "Drop it here to read the price" : "Drag a photo or cart screenshot here"}</span>
          </span>
          <span className="hidden text-xs font-semibold text-stone-500 pointer-fine:block">or click to browse your files</span>
        </button>
        <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />

        {(preview || loading) && (
          <div className="mt-4 overflow-hidden rounded-2xl bg-stone-100">
            {preview && <img src={preview} alt="Your photo" className={`max-h-64 w-full object-contain ${loading ? "opacity-60" : ""}`} />}
            {loading && (
              <div className="flex items-center gap-2 p-3 text-sm font-semibold text-brand-700" role="status">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" /> Reading the price tag…
              </div>
            )}
          </div>
        )}
        {error && (
          <div className="mt-3" role="alert">
            <Notice tone="warn">{error}</Notice>
          </div>
        )}

        </details>
        <div className="grid grid-cols-[1fr_8rem] gap-2">
          <TextField label="What is it?" value={name} onChange={setName} placeholder="AirPods" />
          <NumberField label="How much?" value={price} onChange={setPrice} />
        </div>
        <Button
          className="purchase-check-compare mt-3 w-full"
          disabled={!price}
          onClick={() => show({ label: name.trim() || "this item", price: Number(price), alternative: item?.label === (name.trim() || "this item") ? item.alternative : null, estimated: false })}
        >
          <span className="inline-flex items-center gap-2"><Tag className="h-4 w-4" aria-hidden="true" /> Compare with my goals</span>
        </Button>
      </Card>

      {/* 2. Result */}
      {item && (
        <div id="price-result" className="scroll-mt-20 space-y-4">
          <Card>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-stone-500">You're looking at</p>
                <h2 className="truncate text-2xl font-bold capitalize text-ink">{item.label}</h2>
              </div>
              <button onClick={reset} className="flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-stone-500 hover:bg-stone-100" aria-label="Start over">
                <RotateCcw className="h-4 w-4" aria-hidden="true" /> New
              </button>
            </div>
            <p className="mt-1 font-display text-5xl font-bold text-ink">{money(item.price)}</p>
            {item.estimated && <p className="mt-1 text-xs font-semibold text-amber-700">Estimated price: no tag was visible. Edit it above if you know it.</p>}

            {item.lines && (
              <ul className="mt-3 space-y-1 rounded-2xl bg-stone-50 p-3 text-sm">
                {item.lines.map((l, i) => (
                  <li key={i}>
                    <label className="flex min-h-9 items-center gap-2">
                      <input type="checkbox" checked={picked[i]} onChange={() => toggleLine(i)} className="h-4 w-4 accent-brand-600" />
                      <span className="flex-1">{l.name}</span>
                      <span className="font-semibold">{money(l.price)}</span>
                    </label>
                  </li>
                ))}
                <li className="pt-1 text-xs text-stone-500">Untick anything you're not buying.</li>
              </ul>
            )}

            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              <div className="flex items-center gap-3 rounded-2xl bg-brand-50 p-3">
                <Clock className="h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />
                {profile.hourlyWage ? (
                  <p className="text-sm text-stone-700">
                    That's <strong>{formatHours(hoursOfWork(item.price, profile.hourlyWage))}</strong> of work at {money(profile.hourlyWage)}/hr.
                  </p>
                ) : (
                  <p className="text-sm text-stone-700">
                    <button onClick={onSettings} className="font-bold text-brand-700 underline">Add your pay</button> to see how many hours of work this is.
                  </p>
                )}
              </div>
              {item.alternative && item.alternative.price < item.price && (
                <div className="flex items-center gap-3 rounded-2xl bg-emerald-50 p-3">
                  <Lightbulb className="h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
                  <p className="text-sm text-stone-700">
                    Cheaper idea: <strong>{item.alternative.description}</strong>, about {money(item.alternative.price)}.
                  </p>
                </div>
              )}
            </div>
            {bank && (
              <div className="mt-2 flex items-center gap-3 rounded-2xl bg-sky-50 p-3">
                <Wallet className="h-5 w-5 shrink-0 text-sky-600" aria-hidden="true" />
                <p className="text-sm text-stone-700">
                  Your cash: <strong>{formatMoney(bank.cash)}</strong> → <strong className={bank.cash - item.price < 0 ? "text-red-700" : ""}>{formatMoney(bank.cash - item.price)}</strong> after this
                  {bank.cash - item.price < 0 ? ". That's more than you have in checking and savings." : "."}
                </p>
              </div>
            )}
            {item.note && <p className="mt-2 text-xs text-stone-500">{item.note}</p>}
          </Card>

          {message && (
            <Notice tone="good">
              <div className="flex items-start justify-between gap-2">
                <span>{message}</span>
                <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
              </div>
            </Notice>
          )}

          {moneyGoals.length === 0 ? (
            <Card className="text-center">
              <PiggyBank className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
              <h3 className="mt-2 text-xl font-bold text-ink">See how this moves a goal</h3>
              <p className="mx-auto mt-1 max-w-sm text-sm text-stone-600">Add something you're saving for, and NorthStar will show how many days this purchase pushes it back.</p>
              <Button className="mt-4" onClick={onNewGoal}>Start a savings goal</Button>
            </Card>
          ) : (
            <>
              <Card>
                <h3 className="text-lg font-bold text-ink">What it costs your goals</h3>
                <p className="text-sm text-stone-600">Choose which goal would fund the purchase. Each row is a separate scenario, not a combined deduction from every goal.</p>
                <ul className="mt-3 space-y-2" role="radiogroup" aria-label="Choose a goal">
                  {moneyGoals.map((g) => {
                    const w = whatIfSpend(g.target, g.saved, g.weekly, item.price);
                    const on = g.id === goal?.id;
                    return (
                      <li key={g.id}>
                        <button
                          role="radio"
                          aria-checked={on}
                          onClick={() => {
                            setGoalId(g.id);
                            setVersion((v) => v + 1);
                          }}
                          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 text-left ring-1 transition-colors duration-200 ${on ? "bg-brand-50 ring-2 ring-brand-500" : "bg-white ring-stone-200 hover:bg-stone-50"}`}
                        >
                          <span className="font-semibold text-ink">{g.name}</span>
                          <span className={`font-display text-lg font-bold ${w.delayDays > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                            {isFinite(w.delayDays) ? (w.delayDays > 0 ? `+${w.delayDays.toFixed(1)} days` : "no delay") : "—"}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>

              {goal && (
                <Card className="purchase-verdict">
                  <h3>Trade-off for {goal.name}</h3>
                  <p>{(() => {
                    const impact = whatIfSpend(goal.target, goal.saved, goal.weekly, item.price);
                    const finish = projectedDate(impact.newWeeks);
                    const baseline = projectedDate(impact.originalWeeks);
                    if (goal.weekly <= 0) return "Set a weekly savings amount before deciding: there isn’t enough information to estimate how long recovery would take.";
                    if (!Number.isFinite(impact.delayDays)) return "A timeline cannot be calculated with the current goal settings.";
                    if (goal.deadline && finish && finish > goal.deadline) return `${baseline && baseline > goal.deadline ? "Your plan already misses its target date. This purchase would delay it further" : "This purchase would push your goal past its target date"} to ${finish}. Consider skipping it or choosing a cheaper option if that deadline matters most.`;
                    if (impact.delayDays <= 0) return "This scenario adds no delay to this goal. That alone doesn’t establish whether the purchase fits your overall budget.";
                    return `The trade-off is ${impact.delayDays.toFixed(1)} extra days of saving${finish ? `, reaching this goal around ${finish}` : ""}${goal.deadline ? ", still within your target date" : ""}. It may be worth it if the purchase matters more to you than that wait; skipping it protects your current timeline.`;
                  })()}</p>
                  <p className="wealth-note">Assumes the full price comes from this goal’s savings and weekly contributions stay unchanged. This is a planning comparison, not a guarantee of affordability.</p>
                </Card>
              )}
              {goal && (
                <MoneyWhatIf
                  key={`${goal.id}-${version}`}
                  goal={goal}
                  initial={item}
                  hideInputs
                  onApply={(changes, msg, decision) => {
                    onUpdateGoal({ ...goal, ...changes });
                    if (decision) onLog(goal, decision);
                    setMessage(msg);
                    setVersion((v) => v + 1);
                    document.getElementById("price-result")?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              )}
              <p className="text-center text-xs text-stone-500">Typed prices work without AI. Photo reading uses Claude and may need a moment.</p>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return mins ? `${whole}h ${mins}m` : `${whole} hour${whole === 1 ? "" : "s"}`;
}
