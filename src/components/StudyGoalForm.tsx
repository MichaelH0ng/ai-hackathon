import { useState } from "react";
import { addDays, daysBetween, todayISO } from "../lib/dates";
import { type Difficulty, type Grade, type Topic, recommendedHours, replan } from "../lib/study";
import type { StudyGoal } from "../lib/types";
import { PercentDial } from "./PercentDial";
import { BackButton, Button, Card, Chip, DateField, NumberField, TextField } from "./ui";

export function StudyGoalForm({ onCreate, onBack }: { onCreate: (g: StudyGoal) => void; onBack: () => void }) {
  const [name, setName] = useState("");
  const [examDate, setExamDate] = useState(addDays(todayISO(), 5));
  const [confidence, setConfidence] = useState(60);
  const [grade, setGrade] = useState<Grade>("B");
  const [hours, setHours] = useState<number | "">(8);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [topicName, setTopicName] = useState("");
  const [topicLevel, setTopicLevel] = useState<Difficulty>("hard");

  const days = Math.max(1, daysBetween(todayISO(), examDate));
  const rec = recommendedHours(grade, confidence);
  const available = Number(hours || 0);
  const ready = name.trim() && examDate > todayISO() && available > 0;

  function addTopic() {
    if (!topicName.trim()) return;
    setTopics((t) => [...t, { name: topicName.trim(), difficulty: topicLevel }]);
    setTopicName("");
  }

  return (
    <div>
      <BackButton onClick={onBack} />
      <Card>
        <h2 className="text-xl font-bold text-stone-900">Prepare for an exam</h2>
        <div className="mt-4 space-y-4">
          <TextField label="Subject" value={name} onChange={setName} placeholder="Statistics" />
          <DateField label="Exam date" value={examDate} onChange={setExamDate} min={addDays(todayISO(), 1)} />
          <div>
            <span className="block text-sm font-medium text-stone-700">How ready do you feel right now?</span>
            <div className="mt-1 flex flex-col items-center">
              <PercentDial value={confidence} onChange={setConfidence} label="Ready" caption={() => `~${recommendedHours(grade, confidence)}h to study`} />
              <p className="text-xs text-stone-500">Drag the dial. Less ready means more study hours.</p>
            </div>
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-stone-700">Desired grade (or higher)</span>
            <div className="flex gap-2">
              {(["A", "B", "C"] as Grade[]).map((g) => (
                <Chip key={g} active={grade === g} onClick={() => setGrade(g)}>{g}</Chip>
              ))}
            </div>
          </div>
          <NumberField label="Available study time before the exam" value={hours} onChange={setHours} prefix="" suffix="hours" />

          <div>
            <div className="grid grid-cols-[1fr_auto] items-end gap-2">
              <TextField label="Topics (optional): harder ones get more time" value={topicName} onChange={setTopicName} placeholder="Hypothesis tests" />
              <select aria-label="Topic difficulty" value={topicLevel} onChange={(e) => setTopicLevel(e.target.value as Difficulty)} className="h-[46px] rounded-xl bg-stone-50 px-2 ring-1 ring-stone-300">
                <option value="hard">Hard</option>
                <option value="medium">Medium</option>
                <option value="easy">Easy</option>
              </select>
            </div>
            <Button variant="secondary" className="mt-2 w-full" disabled={!topicName.trim()} onClick={addTopic}>
              + Add topic
            </Button>
            {topics.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm">
                {topics.map((t, i) => (
                  <li key={i} className="flex justify-between">
                    <span>{t.name} · <span className="text-stone-500">{t.difficulty}</span></span>
                    <button className="text-xs text-stone-500" onClick={() => setTopics((ts) => ts.filter((_, j) => j !== i))}>remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Card>

      <Card className="mt-3 bg-emerald-50 ring-emerald-200">
        <p className="text-sm font-medium text-emerald-900">Your starting study plan</p>
        <p className="mt-1 text-4xl font-extrabold text-emerald-900">~{Math.min(rec, available || rec)} hours</p>
        <p className="text-sm text-emerald-900">
          Spread over {days} day{days === 1 ? "" : "s"}. This is a rough first estimate. A practice quiz will adjust it.
        </p>
        {available > 0 && rec > available && (
          <p className="mt-2 text-sm text-amber-900">We'd suggest about {rec} hours, but you have {available}. We'll plan with what you have.</p>
        )}
        {available > rec && (
          <p className="mt-2 text-sm text-emerald-900">That leaves about <strong>{available - rec} hours free</strong> for other things. 🎉</p>
        )}
      </Card>

      <Button
        className="mt-3 w-full"
        disabled={!ready}
        onClick={() => {
          const g: StudyGoal = {
            kind: "study",
            id: crypto.randomUUID(),
            name: name.trim(),
            examDate,
            confidence,
            targetGrade: grade,
            hoursAvailable: available,
            quizScores: [],
            activities: [],
            plan: [],
            topics,
          };
          onCreate({ ...g, plan: replan(g) });
        }}
      >
        Create my plan
      </Button>
    </div>
  );
}
