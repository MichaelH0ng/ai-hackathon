# TradeOff

**See what today's choices cost tomorrow.**

A personalized opportunity cost calculator for students. It combines budgeting, time management and what-if scenarios so every choice shows what it costs, or gains, toward your goals. It's a decision assistant, not a scolding budget coach.

> Set a Goal → Generate a Plan → Test a Decision → Calculate Opportunity Cost → Update the Timeline

## Run it

```bash
npm install
npm run dev              # app on http://localhost:5173 (+ API on :8787)
```

On first visit, tap **Try the demo example** for the hoodie, stats exam, $40 food budget and spring break trip, or build your own goals.

Optional:
- **AI features** (photo/cart scanning, meal ideas): `cp .env.example .env`, add an Anthropic API key, then restart. Everything else works without a key.
- **On your phone** (same Wi-Fi): `npm run dev:phone` and open the "Network" URL.
- **Tests**: `npm test`

## Demo script

1. **Welcome**: "What are you working toward?" → **Saving for something**.
2. **Set a goal**: New hoodie, $150 total, $60 saved, $15/week, 🎄 Christmas → **6.0 weeks**, 40% already saved.
3. **What if I…** → 🍔 Eat out, $20.
   - **Compare your options** timeline: A go out → Jan 4 (+9.3 days), B cook for $5 → +2.3 days, C avoid spending → no delay.
   - Original **6.0** → new **7.3 weeks**.
4. **Recommendation**: *"Going out to eat will delay your new hoodie goal by about 9 days. Cooking at home for $5 instead would reduce that delay to about 2 days. However, if spending time with friends is important to you, you can still choose dinner out and adjust your savings plan."*
5. **Is it worth it to you?** Enjoyment, importance and urgency give **73/100, worth it for you**. Not every decision is purely financial.
6. **Decide**: go and save $3.33 more/week to keep the date, accept the new date, cook instead, or skip.
   - 🌱 **Make it a habit**: cook at home 2×/week → hoodie weeks sooner.
7. **Study**: Statistics, exam in 5 days, 60% confident, at least a B, 8 hours, topics.
   - ~7h schedule, hardest topics first, last day is review.
   - 🎬 Movie 2h → 6h left and what to reschedule.
   - Practice quiz → hours go up or down.
   - The app never promises a grade.
8. **Food budget**: $40/week → cheapest balanced grocery list, cost per meal vs $15 eating out.
   - Swap 2 meals out → savings/week → "hoodie 29 days sooner" → add it to the hoodie plan.
9. **Home**: all goals side by side, plus **Your choices** (days gained toward goals, money kept, study tradeoffs).

## Features (mapped to the brainstorm)

| Brainstorm | In the app |
|---|---|
| 1. Smart goal planner | Money, exam and food-budget goals, each with a personalized plan |
| 2. Opportunity cost calculator | What-If for purchases (presets, custom, 📷 scan) and for time (movie, friends, shift, extra study hour) |
| 3. Interactive progress dashboard | Progress bars, a visual timeline comparing options against your date, a multi-goal home screen |
| 4. Confidence-based planning | Exam confidence and quiz scores set study hours; "how sure are you that you want it?" suggests a waiting period when unsure |
| 5. Grocery vs eating out | Weekly budget → cheapest balanced grocery list (diet filters), cost per meal, savings, effect on goals, ✨ AI meal ideas |
| 6. Decision score | Score from money cost, enjoyment, importance, urgency and goal confidence, with reasons |
| 7. Positive opportunity cost | "Cook at home instead" gains, plus "Make it a habit" showing cumulative weekly and monthly savings and days sooner |
| 8. Adaptive recommendations | Behind your date → one tap updates your weekly savings; spending → "save $X more/week to keep my date" |
| Priority 3: AI recommendations, habit insights, multiple goals | AI scan and meal ideas, a "Your choices" log, side-by-side goals |
| Extra | Hours of work (set pay in ⚙️ Settings); "where could this money grow?" for longer goals (educational only) |

## Code map

| | |
|---|---|
| `src/lib/finance.ts` | Weeks to goal, what-if delay, keep-my-date amount, habit impact, decision score, certainty advice, recommendation text, growth |
| `src/lib/study.ts` | Suggested hours, schedule, topic prioritization, replanning, activity what-if |
| `src/lib/grocery.ts` | Grocery catalog (estimated prices) + meal-maximizing planner |
| `src/lib/storage.ts` | Browser storage (localStorage) + demo data |
| `src/components/` | `Welcome`, `Home`, `Money*`, `Study*`, `Food*`, `Timeline`, `PriceScanner`, `Settings`, `ui` |
| `server/index.ts` | `/api/scan` (image → prices + cheaper option) and `/api/meals` (grocery list → meal ideas), via Claude |

**Formulas**
- Weeks to goal = (goal − saved) ÷ weekly savings.
- Delay = cost ÷ weekly savings × 7. This assumes the cost comes from savings.
- Suggested study hours grow with the gap between readiness (confidence or latest quiz) and target grade. It's a rough estimate, not a grade prediction.
- A grocery meal is one carb, one protein and one produce serving. The planner buys the cheapest serving in whichever category is lowest.
