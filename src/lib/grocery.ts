// Grocery vs eating out. A balanced home meal = 1 carb + 1 protein + 1 produce serving.
// Prices are typical US grocery prices (estimates) for a prototype — not live data.

export type Category = "carb" | "protein" | "produce";
export type Diet = "vegetarian" | "vegan" | "gluten-free" | "dairy-free";

export interface GroceryItem {
  name: string;
  price: number;
  servings: number; // meal-sized servings
  category: Category;
  diets: Diet[]; // diets this item fits
}

const ALL: Diet[] = ["vegetarian", "vegan", "gluten-free", "dairy-free"];
const VEG_NOT_VEGAN: Diet[] = ["vegetarian", "gluten-free"];

export const CATALOG: GroceryItem[] = [
  { name: "White rice (2 lb)", price: 2.5, servings: 10, category: "carb", diets: ALL },
  { name: "Rolled oats (42 oz)", price: 4.5, servings: 15, category: "carb", diets: ALL },
  { name: "Potatoes (5 lb)", price: 4.0, servings: 10, category: "carb", diets: ALL },
  { name: "Pasta (1 lb)", price: 1.5, servings: 4, category: "carb", diets: ["vegetarian", "vegan", "dairy-free"] },
  { name: "Flour tortillas (10)", price: 2.5, servings: 5, category: "carb", diets: ["vegetarian", "vegan", "dairy-free"] },
  { name: "Bread loaf", price: 2.5, servings: 8, category: "carb", diets: ["vegetarian", "vegan", "dairy-free"] },
  { name: "Dried black beans (1 lb)", price: 1.6, servings: 6, category: "protein", diets: ALL },
  { name: "Lentils (1 lb)", price: 1.8, servings: 6, category: "protein", diets: ALL },
  { name: "Eggs (dozen)", price: 3.5, servings: 6, category: "protein", diets: ["vegetarian", "gluten-free", "dairy-free"] },
  { name: "Peanut butter (16 oz)", price: 2.5, servings: 8, category: "protein", diets: ALL },
  { name: "Tofu (14 oz)", price: 2.2, servings: 3, category: "protein", diets: ALL },
  { name: "Chicken thighs (2 lb)", price: 5.0, servings: 5, category: "protein", diets: ["gluten-free", "dairy-free"] },
  { name: "Canned tuna (3 cans)", price: 3.0, servings: 3, category: "protein", diets: ["gluten-free", "dairy-free"] },
  { name: "Shredded cheese (8 oz)", price: 2.8, servings: 6, category: "protein", diets: VEG_NOT_VEGAN },
  { name: "Frozen mixed vegetables (1 lb)", price: 1.8, servings: 4, category: "produce", diets: ALL },
  { name: "Frozen spinach (12 oz)", price: 1.5, servings: 3, category: "produce", diets: ALL },
  { name: "Carrots (2 lb)", price: 1.7, servings: 6, category: "produce", diets: ALL },
  { name: "Bananas (6)", price: 1.5, servings: 6, category: "produce", diets: ALL },
  { name: "Cabbage (1 head)", price: 2.0, servings: 6, category: "produce", diets: ALL },
  { name: "Pasta sauce (jar)", price: 2.2, servings: 4, category: "produce", diets: ["vegetarian", "vegan", "gluten-free", "dairy-free"] },
];

export interface GroceryPlan {
  items: { item: GroceryItem; qty: number }[];
  total: number;
  meals: number;
  costPerMeal: number;
  servings: Record<Category, number>;
}

/**
 * Greedy plan that maximizes balanced meals within `budget`: keep buying the
 * cheapest-per-serving item in whichever category is running lowest.
 * Up to 2 of any item so the list stays varied. Stops once `mealsTarget` meals are covered.
 */
export function planGroceries(budget: number, diets: Diet[] = [], mealsTarget = Infinity, maxPerItem = 2): GroceryPlan {
  const allowed = CATALOG.filter((it) => diets.every((d) => it.diets.includes(d)));
  const qty = new Map<GroceryItem, number>();
  const servings: Record<Category, number> = { carb: 0, protein: 0, produce: 0 };
  let total = 0;

  for (;;) {
    if (Math.min(servings.carb, servings.protein, servings.produce) >= mealsTarget) break;
    const order = (Object.keys(servings) as Category[]).sort((a, b) => servings[a] - servings[b]);
    let bought = false;
    for (const cat of order) {
      const pick = allowed
        .filter((it) => it.category === cat && (qty.get(it) ?? 0) < maxPerItem && total + it.price <= budget + 1e-9)
        .sort((a, b) => a.price / a.servings - b.price / b.servings || (qty.get(a) ?? 0) - (qty.get(b) ?? 0))[0];
      if (pick) {
        qty.set(pick, (qty.get(pick) ?? 0) + 1);
        servings[cat] += pick.servings;
        total += pick.price;
        bought = true;
        break;
      }
    }
    if (!bought) break;
  }

  const meals = Math.min(servings.carb, servings.protein, servings.produce);
  total = Math.round(total * 100) / 100;
  return {
    items: [...qty.entries()].map(([item, q]) => ({ item, qty: q })).sort((a, b) => a.item.category.localeCompare(b.item.category)),
    total,
    meals,
    costPerMeal: meals ? total / meals : 0,
    servings,
  };
}

/** Weekly savings from cooking instead of eating out for `mealsSwapped` meals. */
export function weeklySavings(mealsSwapped: number, costOut: number, costHome: number): number {
  return Math.max(0, mealsSwapped * (costOut - costHome));
}
