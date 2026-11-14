import { useEffect, useState } from "react";
import { ArrowRight, Check, Leaf } from "lucide-react";
import { completeMission, MISSION_KEY, treeStage, weeklyMissions, weekStart, type Completion, type MoneyMission } from "../lib/missions";

function readCompletions(): Completion[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(MISSION_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    const unique = new Map<string, Completion>();
    for (const item of saved) {
      if (typeof item?.week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.week) || typeof item?.mission !== "string") continue;
      if (weeklyMissions(item.week).some(m => m.id === item.mission)) unique.set(`${item.week}:${item.mission}`, item);
    }
    return [...unique.values()];
  } catch { return []; }
}
export function useMoneyGarden() {
  const [records, setRecords] = useState<Completion[]>(readCompletions);
  const [week, setWeek] = useState(weekStart);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const refresh = () => setWeek(weekStart());
    const timer = window.setInterval(refresh, 60000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  useEffect(() => { try { localStorage.setItem(MISSION_KEY, JSON.stringify(records)); setStorageError(false); } catch { setStorageError(true); } }, [records]);
  const missions = weeklyMissions(week);
  const done = missions.filter(m => records.some(r => r.week === week && r.mission === m.id)).map(m => m.id);
  return { records, missions, done, storageError, complete: (id: string) => setRecords(r => completeMission(r, weekStart(), id)) };
}
type Garden = ReturnType<typeof useMoneyGarden>;

/** Simple vector illustration: growth comes from learning, independent of account value. */
function GrowingTree({ count }: { count: number }) {
  const stage = treeStage(count);
  return <svg viewBox="0 0 220 170" className="garden-tree" role="img" aria-label={`Your money tree: ${stage.name}. ${count} ${count === 1 ? "lesson" : "lessons"} completed.`}>
    <ellipse cx="110" cy="148" rx="66" ry="8" fill="#e8eee6" />
    <path d="M62 146 Q110 134 158 146" fill="none" stroke="#c5d3bf" strokeWidth="2" strokeLinecap="round" />
    {stage.level === 0 ? <><ellipse cx="110" cy="137" rx="8" ry="10" fill="#9d7758" transform="rotate(25 110 137)" /><path d="M109 136l3-6" stroke="#c9a27e" strokeWidth="2" strokeLinecap="round" /></> : <>
      <path d={stage.level === 1 ? "M110 143 Q105 118 111 100" : "M109 144 Q113 110 108 65"} fill="none" stroke="#9b7c5c" strokeWidth={stage.level >= 3 ? 9 : 5} strokeLinecap="round" />
      {stage.level === 1 ? <><path d="M110 120 Q79 121 84 99 Q110 96 110 120" fill="#a9c69b" /><path d="M110 109 Q138 108 136 88 Q112 85 110 109" fill="#719a73" /></> : <>
        <path d="M110 112L86 88M111 98L136 75" stroke="#9b7c5c" strokeWidth="4" strokeLinecap="round" />
        <ellipse cx="86" cy="84" rx="26" ry="27" fill="#a8c59b" /><ellipse cx="136" cy="72" rx="29" ry="30" fill="#8aad81" /><ellipse cx="108" cy="57" rx="29" ry="33" fill="#759b73" />
        {stage.level >= 3 && <><ellipse cx="64" cy="76" rx="23" ry="26" fill="#bed1ae" /><ellipse cx="156" cy="88" rx="23" ry="27" fill="#a5bd92" /><ellipse cx="109" cy="90" rx="35" ry="24" fill="#96b789" /></>}
        {stage.level >= 4 && <><circle cx="91" cy="71" r="5" fill="#dec18b" /><circle cx="139" cy="94" r="5" fill="#dec18b" /><circle cx="127" cy="47" r="5" fill="#dec18b" /></>}
      </>}
    </>}
  </svg>;
}
export function GardenSummary({ garden, onLearn }: { garden: Garden; onLearn: () => void }) {
  const stage = treeStage(garden.records.length);
  const next = garden.missions.find(m => !garden.done.includes(m.id));
  return <section className="garden-summary" aria-labelledby="garden-heading"><div className="garden-summary-tree"><GrowingTree count={garden.records.length} /><span>{stage.name} · {garden.records.length} {garden.records.length === 1 ? "lesson" : "lessons"} learned</span></div><div className="garden-summary-copy"><span className="garden-kicker"><Leaf size={15} /> A LITTLE EACH WEEK</span><h2 id="garden-heading">Grow your money confidence.</h2><p>Complete a short lesson to help your tree grow. It keeps its progress, even when you take a break.</p><div className="garden-week-progress"><span>{garden.done.length} of 3 weekly missions complete</span><div role="progressbar" aria-label="Weekly missions completed" aria-valuemin={0} aria-valuemax={3} aria-valuenow={garden.done.length}><i style={{ width: `${garden.done.length / 3 * 100}%` }} /></div></div><button className="wealth-primary" onClick={onLearn}>{next ? "Try a 2-minute mission" : "View this week’s lessons"}<ArrowRight size={16} /></button></div></section>;
}
export function MoneyGarden({ garden, onNavigate }: { garden: Garden; onNavigate: (destination: MoneyMission["destination"]) => void }) {
  const firstIncomplete = garden.missions.find(m => !garden.done.includes(m.id));
  const [opened, setOpened] = useState(firstIncomplete?.id || garden.missions[0].id);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState<Record<string, boolean>>({});
  const stage = treeStage(garden.records.length);
  return <div className="learning-layout"><aside className="wealth-card garden-detail"><GrowingTree count={garden.records.length} /><h2>Your money tree</h2><p className="garden-stage">{stage.name}</p><p>{garden.records.length} {garden.records.length === 1 ? "lesson" : "lessons"} completed</p><p className="wealth-note">{stage.next ? `${stage.next - garden.records.length} more ${stage.next - garden.records.length === 1 ? "lesson" : "lessons"} until your tree’s next stage.` : "Your tree is thriving. Keep learning at your own pace."}</p><div className="garden-detail-note"><Leaf size={18} /><p>Your tree grows with learning, not your account balance. Missing a week never takes progress away.</p></div></aside><section className="wealth-stack"><div className="learning-heading"><h2>This week’s money missions</h2><p>Three small lessons. About 2 minutes each. Missions refresh every Monday.</p><span>{garden.done.length} of 3 complete</span></div>{garden.storageError && <p role="status" className="wealth-note">Your browser cannot save progress. Your tree will keep growing during this session.</p>}{garden.missions.map((mission, i) => {
    const completed = garden.done.includes(mission.id);
    const expanded = opened === mission.id;
    return <article className={`wealth-card learning-mission ${completed ? "completed" : ""}`} key={mission.id}><button className="learning-mission-toggle" aria-expanded={expanded} aria-controls={`lesson-${mission.id}`} onClick={() => setOpened(expanded ? "" : mission.id)}><span className="learning-step">{completed ? <Check size={18} /> : i + 1}</span><span><h3>{mission.title}</h3><small>{completed ? "Completed" : "2-minute lesson"}</small></span><span className="learning-open-label">{expanded ? "Close" : "Open"}</span></button>{expanded && <div className="learning-lesson" id={`lesson-${mission.id}`}><p>{mission.lesson}</p><fieldset disabled={completed}><legend>{mission.question}</legend>{mission.answers.map((answer, n) => <label className="learning-answer" key={answer}><input type="radio" name={`quiz-${mission.id}`} checked={answers[mission.id] === n || (completed && n === mission.correct)} onChange={() => { setAnswers(a => ({ ...a, [mission.id]: n })); setFeedback(f => ({ ...f, [mission.id]: false })); }} /><span>{answer}</span></label>)}</fieldset>{!completed && <button className="wealth-primary" disabled={answers[mission.id] === undefined} onClick={() => { setFeedback(f => ({ ...f, [mission.id]: true })); if (answers[mission.id] === mission.correct) garden.complete(mission.id); }}>Check my answer <ArrowRight size={16} /></button>}<div aria-live="polite">{(completed || feedback[mission.id]) && <div className={`learning-feedback ${completed ? "correct" : ""}`}><strong>{completed ? "Nice work. Your tree has grown." : "Not quite. Try once more."}</strong><p>{completed ? mission.explanation : "Take another look at the short lesson above, then choose another answer."}</p></div>}</div>{completed && <button className="wealth-text-button" onClick={() => onNavigate(mission.destination)}>{mission.action}<ArrowRight size={16} /></button>}</div>}</article>;
  })}<p className="wealth-note">Lessons and progress are saved on this device. Completing a mission does not move money or change your financial plan.</p></section></div>;
}
