import { useState } from "react";
import type { Diet } from "../lib/grocery";
import type { FoodGoal, MoneyGoal } from "../lib/types";
import { BackButton, Button, Card, Chip, NumberField } from "./ui";

export const DIETS: Diet[] = ["vegetarian", "vegan", "gluten-free", "dairy-free"];

export function FoodGoalForm({
  moneyGoals,
  onCreate,
  onBack,
}: {
  moneyGoals: MoneyGoal[];
  onCreate: (g: FoodGoal) => void;
  onBack: () => void;
}) {
  const [budget, setBudget] = useState<number | "">(40);
  const [meals, setMeals] = useState<number | "">(14);
  const [out, setOut] = useState<number | "">(3);
  const [costOut, setCostOut] = useState<number | "">(15);
  const [diets, setDiets] = useState<Diet[]>([]);
  const [linked, setLinked] = useState(moneyGoals[0]?.id ?? "");

  return (
    <div>
      <BackButton onClick={onBack} />
      <Card>
        <h2 className="text-xl font-bold text-stone-900">Weekly food budget</h2>
        <p className="text-sm text-stone-600">Compare eating out with cooking, and get a cheap grocery list.</p>
        <div className="mt-4 space-y-4">
          <NumberField label="Weekly grocery budget" value={budget} onChange={setBudget} />
          <NumberField label="Meals you want to cook at home each week" value={meals} onChange={setMeals} prefix="" suffix="meals" />
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Times you eat out a week" value={out} onChange={setOut} prefix="" />
            <NumberField label="Typical cost per meal out" value={costOut} onChange={setCostOut} />
          </div>
          <div>
            <span className="mb-1 block text-sm font-medium text-stone-700">Preferences</span>
            <div className="flex flex-wrap gap-2">
              {DIETS.map((d) => (
                <Chip key={d} active={diets.includes(d)} onClick={() => setDiets((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))}>
                  {d}
                </Chip>
              ))}
            </div>
          </div>
          {moneyGoals.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-stone-700">Put savings toward</span>
              <select value={linked} onChange={(e) => setLinked(e.target.value)} className="w-full rounded-xl bg-stone-50 px-3 py-2.5 ring-1 ring-stone-300">
                <option value="">No goal</option>
                {moneyGoals.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </Card>
      <Button
        className="mt-3 w-full"
        disabled={!budget || !meals}
        onClick={() =>
          onCreate({
            kind: "food",
            id: crypto.randomUUID(),
            name: "Weekly food budget",
            weeklyBudget: Number(budget),
            mealsPerWeek: Number(meals),
            mealsOutPerWeek: Number(out || 0),
            costPerMealOut: Number(costOut || 0),
            swapPerWeek: Math.min(2, Number(out || 0)),
            diets,
            linkedGoalId: linked || undefined,
          })
        }
      >
        Create my food plan
      </Button>
    </div>
  );
}
