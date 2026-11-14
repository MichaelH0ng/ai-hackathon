import { useState } from "react";
import { daysBetween, formatWeekday, todayISO } from "../lib/dates";
import { freeHours, recommendedFor, replan, whatIfActivity, type StudyActivity } from "../lib/study";
import type { StudyGoal } from "../lib/types";
import type { LogDecision } from "./MoneyWhatIf";
import { BackButton, Button, Card, Chip, NumberField, Notice, Progress, Stat, TextField } from "./ui";

interface ActivityPreset {
  chip: string;
  label: string;
  hours: number;
  value: string;
  extraStudy?: boolean; // positive choice: adds study time instead of using it
}

const PRESETS: ActivityPreset[] = [
  { chip: "🎬 Movie", label: "Watch a movie", hours: 2, value: "a movie night" },
  { chip: "🍕 Friends", label: "Hang out with friends", hours: 3, value: "time with friends" },
  { chip: "💼 Extra shift", label: "Pick up an extra shift", hours: 4, value: "the extra money" },
  { chip: "🎮 Gaming", label: "Play games", hours: 1.5, value: "a break" },
  { chip: "📖 Extra study hour", label: "Study an extra hour", hours: 1, value: "", extraStudy: true },
];

const h = (n: number) => `${n % 1 === 0 ? n : n.toFixed(1)}h`;

export function StudyGoalView({
  goal,
  onChange,
  onLog,
  onDelete,
  onBack,
}: {
  goal: StudyGoal;
  onChange: (g: StudyGoal) => void;
  onLog: (d: LogDecision & { hours?: number }) => void;
  onDelete: () => void;
  onBack: () => void;
}) {
  const today = todayISO();
  const upcoming = goal.plan.filter((d) => d.date >= today);
  const [message, setMessage] = useState<string | null>(null);
  const [quiz, setQuiz] = useState<number | "">("");
  const [act, setAct] = useState<ActivityPreset>(PRESETS[0]);
  const [actDay, setActDay] = useState(upcoming[0]?.date ?? today);

  const rec = recommendedFor(goal);
  const free = freeHours(goal);
  const planned = goal.plan.reduce((s, d) => s + d.hours, 0);
  const doneHours = goal.plan.filter((d) => d.done).reduce((s, d) => s + d.hours, 0);
  const daysLeft = daysBetween(today, goal.examDate);
  const examOver = daysLeft < 0;
  const spare = Math.max(0, free - rec);

  const activity: StudyActivity = { label: act.label, hours: act.hours, date: actDay };
  const w = act.hours > 0 && !act.extraStudy ? whatIfActivity(goal, activity) : null;
  const extra = act.extraStudy && act.hours > 0 ? { freeAfter: free + act.hours, coversGap: free + act.hours >= rec } : null;

  function update(next: StudyGoal, msg?: string) {
    onChange(next);
    if (msg) {
      setMessage(msg);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  return (
    <div className="space-y-3">
      <BackButton onClick={onBack} label="All goals" />

      {message && (
        <Notice tone="good">
          <div className="flex items-start justify-between gap-2">
            <span>{message}</span>
            <button onClick={() => setMessage(null)} aria-label="Dismiss">✕</button>
          </div>
        </Notice>
      )}

      <Card>
        <p className="text-sm text-stone-500">📚 Preparing for</p>
        <h2 className="text-2xl font-bold text-stone-900">{goal.name}</h2>
        <p className="text-sm text-stone-600">
          {examOver ? "Exam date has passed" : daysLeft === 0 ? "Exam is today. Good luck!" : `In ${daysLeft} day${daysLeft === 1 ? "" : "s"}`} · aiming for at least a {goal.targetGrade}
        </p>
        <div className="mt-3">
          <Progress value={planned ? doneHours / planned : 0} />
          <p className="mt-1 text-sm text-stone-700">{h(doneHours)} of {h(planned)} studied</p>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Stat label="Suggested study" value={h(rec)} sub={goal.quizScores.length ? `from your ${goal.quizScores.at(-1)}% quiz` : `from your ${goal.confidence}% confidence`} />
          <Stat label="Free time for studying" value={h(free)} sub={`of ${h(goal.hoursAvailable)} available`} tone={free < rec ? "warn" : "good"} />
        </div>
        {free < rec && <p className="mt-2 text-sm text-amber-800">Your plan uses the {h(free)} you have, {h(rec - free)} less than suggested.</p>}
        {spare > 0 && <p className="mt-2 text-sm text-emerald-800">🎉 You have {h(spare)} beyond your study plan, free for other activities.</p>}
      </Card>

      {!examOver && goal.quizScores.length === 0 && daysLeft >= 2 && (
        <Notice tone="info">📝 Tip: take a practice quiz after your first session. Your score tunes how much more you need to study.</Notice>
      )}

      <Card>
        <h3 className="text-lg font-bold text-stone-900">Your schedule</h3>
        <ul className="mt-2 divide-y divide-stone-100">
          {goal.plan.map((d, i) => {
            const acts = goal.activities.filter((a) => a.date === d.date);
            return (
              <li key={d.date} className="flex items-center gap-3 py-2">
                <input
                  type="checkbox"
                  checked={d.done}
                  disabled={d.hours === 0}
                  onChange={() => update({ ...goal, plan: goal.plan.map((p, j) => (j === i ? { ...p, done: !p.done } : p)) })}
                  className="h-5 w-5 accent-brand-600"
                  aria-label={`Mark ${formatWeekday(d.date)} done`}
                />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${d.done ? "text-stone-400 line-through" : "text-stone-900"}`}>
                    {formatWeekday(d.date)}
                    {d.date === today && <span className="ml-1 text-xs text-emerald-700">(today)</span>}
                  </p>
                  {d.topic && d.hours > 0 && <p className="truncate text-xs text-stone-600">Focus: {d.topic}</p>}
                  {acts.map((a, k) => (
                    <p key={k} className="text-xs text-stone-500">+ {a.label} ({h(a.hours)})</p>
                  ))}
                </div>
                <span className="text-sm font-semibold text-stone-800">{d.hours ? `${h(d.hours)} study` : "Free"}</span>
              </li>
            );
          })}
        </ul>
      </Card>

      {!examOver && (
        <Card>
          <h3 className="text-lg font-bold text-stone-900">Took a practice quiz?</h3>
          <p className="text-sm text-stone-600">Enter your score and we'll adjust your study hours.</p>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-end gap-2">
            <NumberField label="Score" value={quiz} onChange={setQuiz} prefix="" suffix="%" />
            <Button
              disabled={quiz === "" || quiz > 100}
              onClick={() => {
                const before = rec;
                const next = { ...goal, quizScores: [...goal.quizScores, Number(quiz)] };
                const after = recommendedFor(next);
                update(
                  { ...next, plan: replan(next) },
                  after === before
                    ? `Got it. ${quiz}% keeps your suggested study at ${h(after)}.`
                    : after < before
                      ? `Nice work! Based on your ${quiz}% quiz, suggested study went from ${h(before)} to ${h(after)}. That's ${h(before - after)} back for other things.`
                      : `Based on your ${quiz}% quiz, suggested study went from ${h(before)} to ${h(after)}. Your schedule is updated.`,
                );
                setQuiz("");
              }}
            >
              Update plan
            </Button>
          </div>
          {goal.quizScores.length > 0 && <p className="mt-2 text-xs text-stone-500">Past quizzes: {goal.quizScores.map((s) => `${s}%`).join(", ")}</p>}
        </Card>
      )}

      {!examOver && upcoming.length > 0 && (
        <Card>
          <h3 className="text-lg font-bold text-stone-900">What if I…</h3>
          <p className="text-sm text-stone-600">See what a plan does to your study time.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <Chip key={p.chip} active={act.chip === p.chip} onClick={() => setAct(p)}>{p.chip}</Chip>
            ))}
            <Chip active={act.chip === "custom"} onClick={() => setAct({ chip: "custom", label: "", hours: 1, value: "it" })}>✏️ Something else</Chip>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_6rem] gap-2">
            <TextField label="Activity" value={act.label} onChange={(v) => setAct({ ...act, label: v })} />
            <NumberField label="Hours" value={act.hours} onChange={(v) => setAct({ ...act, hours: Number(v || 0) })} prefix="" />
          </div>
          {!act.extraStudy && (
            <label className="mt-2 block">
              <span className="mb-1 block text-sm font-medium text-stone-700">When?</span>
              <select value={actDay} onChange={(e) => setActDay(e.target.value)} className="w-full rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-300">
                {upcoming.map((d) => (
                  <option key={d.date} value={d.date}>{formatWeekday(d.date)}</option>
                ))}
              </select>
            </label>
          )}

          {extra && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Study time" value={h(extra.freeAfter)} sub={`was ${h(free)}`} tone="good" />
                <Stat label="Suggested study" value={h(rec)} sub={extra.coversGap ? "fully covered" : `${h(rec - extra.freeAfter)} still short`} tone={extra.coversGap ? "good" : "warn"} />
              </div>
              <Notice tone="good">
                💪 An extra {h(act.hours)} gives you more room to prepare{free < rec ? `, closing ${h(Math.min(act.hours, rec - free))} of your gap` : ""}.
                <span className="mt-1 block text-xs">This shows your time, not your grade.</span>
              </Notice>
              <Button
                className="w-full"
                onClick={() => {
                  const next = { ...goal, hoursAvailable: goal.hoursAvailable + act.hours };
                  update({ ...next, plan: replan(next) }, `Added ${h(act.hours)} of study time. Schedule updated.`);
                  onLog({ label: `Added ${h(act.hours)} of study for ${goal.name}`, hours: act.hours });
                }}
              >
                Add it to my schedule
              </Button>
            </div>
          )}

          {w && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Study time left" value={h(w.freeAfter)} sub={`was ${h(w.freeBefore)}`} tone={w.shortBy > 0 ? "warn" : "good"} />
                <Stat label="Suggested study" value={h(w.recommended)} sub={w.shortBy > 0 ? `${h(w.shortBy)} short` : "still fits"} tone={w.shortBy > 0 ? "warn" : "good"} />
              </div>

              {w.moved.length > 0 && (
                <div className="rounded-xl bg-stone-50 p-3 text-sm">
                  <p className="font-medium text-stone-800">What you'd reschedule:</p>
                  <ul className="mt-1 space-y-0.5">
                    {w.moved.map((m) => (
                      <li key={m.date} className="flex justify-between">
                        <span>{formatWeekday(m.date)}</span>
                        <span className={m.to > m.from ? "text-emerald-800" : "text-amber-800"}>{h(m.from)} → {h(m.to)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <Notice tone="info">
                💬{" "}
                {w.shortBy > 0
                  ? `${act.label || "This"} leaves you ${h(w.freeAfter)} to study, ${h(w.shortBy)} less than suggested. `
                  : `${act.label || "This"} still leaves ${h(w.freeAfter)} to study, enough for your ${h(w.recommended)} plan. `}
                If {act.value} is important to you, go for it. Your study time just shifts to the other days.
                <span className="mt-1 block text-xs text-sky-800">This shows your time, not your grade. Nobody can promise exactly how it changes your score.</span>
              </Notice>

              <div className="grid gap-2">
                <Button
                  disabled={!act.label}
                  onClick={() => {
                    const next = { ...goal, activities: [...goal.activities, activity] };
                    update({ ...next, plan: replan(next) }, `Added "${act.label}". Your schedule is updated. Enjoy!`);
                    onLog({ label: `${act.label} (${goal.name})`, hours: -act.hours });
                  }}
                >
                  Do it and update my schedule
                </Button>
                <Button variant="ghost" onClick={() => setMessage(`Skipped "${act.label}". Your plan stays the same.`)}>Skip it</Button>
              </div>
            </div>
          )}

          {goal.activities.length > 0 && (
            <div className="mt-4 border-t border-stone-200 pt-3">
              <p className="text-sm font-medium text-stone-700">Plans you've added</p>
              <ul className="mt-1 space-y-1 text-sm">
                {goal.activities.map((a, i) => (
                  <li key={i} className="flex items-center justify-between">
                    <span>{a.label} · {formatWeekday(a.date)} · {h(a.hours)}</span>
                    <button
                      className="text-xs text-stone-500 hover:text-red-700"
                      onClick={() => {
                        const next = { ...goal, activities: goal.activities.filter((_, j) => j !== i) };
                        update({ ...next, plan: replan(next) }, `Removed "${a.label}". Schedule updated.`);
                      }}
                    >
                      remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}

      <Button variant="ghost" className="w-full text-red-700" onClick={onDelete}>Delete this goal</Button>
    </div>
  );
}
