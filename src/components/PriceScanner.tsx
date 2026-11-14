import { useRef, useState } from "react";

export interface ScanPick {
  label: string;
  price: number;
  alternative: { description: string; price: number } | null;
}

interface ScanResponse {
  kind: "single_item" | "cart" | "no_price_found";
  items: { name: string; price: number; estimated: boolean }[];
  total: number | null;
  cheaper_alternative: { description: string; price: number } | null;
  note: string;
}

/** Shrink photos before upload: faster, cheaper, and converts HEIC to JPEG in Safari. */
export async function toJpegDataUrl(file: File, maxSide = 1568): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

/** Camera / screenshot → price (and a cheaper alternative) via the scan API. */
export function PriceScanner({ onResult }: { onResult: (pick: ScanPick) => void }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<{ loading: boolean; error?: string; note?: string }>({ loading: false });

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setStatus({ loading: true });
    try {
      const image = await toJpegDataUrl(file);
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image }),
      });
      const body = await res.json().catch(() => ({ error: "The scan server isn't responding. Is it running?" }));
      if (!res.ok) throw new Error(body.error ?? "Scan failed.");
      const r = body as ScanResponse;
      if (r.kind === "no_price_found" || r.items.length === 0) throw new Error("No price found. Type it in instead.");
      const price = r.total ?? r.items.reduce((s, it) => s + it.price, 0);
      const label = r.kind === "cart" ? `your cart (${r.items.length} items)` : `buying ${r.items[0].name}`;
      onResult({ label, price, alternative: r.cheaper_alternative });
      const estimated = r.items.some((it) => it.estimated);
      setStatus({ loading: false, note: [estimated ? "Price is an estimate." : "", r.note].filter(Boolean).join(" ") });
    } catch (e) {
      setStatus({ loading: false, error: e instanceof Error ? e.message : "Scan failed." });
    } finally {
      if (cameraRef.current) cameraRef.current.value = "";
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  return (
    <div>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={status.loading}
          onClick={() => cameraRef.current?.click()}
          className="flex-1 rounded-xl bg-stone-100 px-3 py-2 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-200"
        >
          📷 Snap it
        </button>
        <button
          type="button"
          disabled={status.loading}
          onClick={() => uploadRef.current?.click()}
          className="flex-1 rounded-xl bg-stone-100 px-3 py-2 text-sm font-medium ring-1 ring-stone-300 hover:bg-stone-200"
        >
          🖼️ Cart screenshot
        </button>
      </div>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      <input ref={uploadRef} type="file" accept="image/*" hidden onChange={(e) => handleFile(e.target.files?.[0])} />
      {status.loading && <p className="mt-2 animate-pulse text-sm text-stone-600">Reading the price…</p>}
      {status.error && <p className="mt-2 text-sm text-red-700">{status.error}</p>}
      {status.note && <p className="mt-2 text-xs text-stone-500">{status.note}</p>}
    </div>
  );
}
