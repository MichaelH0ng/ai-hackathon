import { formatMoney } from "./finance";
import { answerAccountEducation } from "./accountEducation";
import { answerInvestingFollowUp, type AssistantTurn } from "./investingConversation";

export interface MoneyAssistantContext {
  accounts: { name: string; kind: string; balance: number; isDebt: boolean }[];
  assets: number;
  debt: number;
  netWorth: number;
  goals: { name: string; target: number; saved: number; weekly: number }[];
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlyGoalContributions: number;
  retirementBalance: number;
  retirementEstimate: number | null;
  retirementAge: number | null;
}

const money = (amount: number) => formatMoney(amount, true);

export function answerMoneyQuestion(question: string, context: MoneyAssistantContext, history: AssistantTurn[] = []): string {
  const query = question.trim().toLowerCase();
  if (!query) return "Ask me about your accounts, net worth, goals, budget, or retirement estimate.";
  const followUp = answerInvestingFollowUp(question, history);
  if (followUp) return followUp;
  const accountEducation = answerAccountEducation(query);
  if (accountEducation) return accountEducation;

  // Advice intents precede balance lookups so “How should I invest my savings?”
  // does not get swallowed by the savings or account handlers.
  if (/\b(invest|investing|investment advice|investment strategy|diversif\w*|asset allocation|index funds?|etfs?|stocks?|bonds?|dollar.cost averaging)\b/.test(query)
    && !/\b(how much|balance|total|worth)\b/.test(query)) {
    const note = " Educational guidance, not a personalized investment recommendation.";
    if (/\b(stock|stocks|pick|buy|sell)\b/.test(query)) {
      return "For a stock or fund, compare what it owns, diversification, fees, and how it fits your time horizon. A single stock can lose most or all of its value; a broad fund spreads company-specific risk but can still fall. I don’t have live prices or enough information to pick a security for you. What are you investing for, and when will you need the money?" + note;
    }
    if (/\b(diversif\w*|asset allocation|risk|bonds?)\b/.test(query)) {
      return "Diversification spreads money across companies, industries, and asset types. Stocks offer growth potential with larger swings; bonds carry interest-rate and credit risk and can also lose value. Your mix depends on when you need the money and how much loss you could tolerate without selling. Keep near-term spending needs separate from volatile investments. What is your time horizon?" + note;
    }
    if (/\b(index funds?|etfs?|fees?|dollar.cost averaging)\b/.test(query)) {
      return "An index fund tracks a market index; an ETF is a fund structure that trades on an exchange. Many broad-market index funds offer diversified exposure at low cost, but narrow funds can be concentrated. Compare holdings, expense ratios, trading costs, and account fees. Regular contributions can build consistency, but do not prevent losses or guarantee better returns." + note;
    }
    const remaining = context.monthlyIncome - context.monthlyExpenses - context.monthlyGoalContributions;
    const budget = context.monthlyIncome > 0
      ? ` Your entered budget leaves ${money(Math.abs(remaining))} ${remaining < 0 ? "over budget" : "per month after spending and goal contributions"}. ${remaining <= 0 ? "Review that shortfall before adding investment contributions." : "That is a planning starting point, not an amount you should automatically invest; check irregular expenses and cash reserves first."}`
      : " Add income and expenses in Budget to estimate room for contributions.";
    return "Start with your goal and when you need the money. Build accessible emergency savings, review expensive debt, and check whether a workplace retirement plan offers a match. For long-term goals, compare diversified, low-cost funds and choose a stock/bond mix you can hold through downturns. Keep money needed soon in less volatile, accessible options." + budget + " When will you need this money, and how would you react to a substantial drop?" + note;
  }

  if (/\b(net worth|overall picture|financial picture)\b/.test(query)) {
    return `Your net worth is ${money(context.netWorth)}: ${money(context.assets)} in assets minus ${money(context.debt)} in debt.`;
  }

  if (/\b(what is|what's|explain)\b/.test(query) && !/\b(balance|how much|my)\b/.test(query)) {
    if (/\broth ira\b/.test(query)) return "A Roth IRA is a retirement account funded with after-tax money. Qualified withdrawals in retirement are generally tax-free. Rules and eligibility limits apply.";
    if (/\b(401\(k\)|401k)\b/.test(query)) return "A 401(k) is a workplace retirement savings plan. Contributions and tax treatment depend on the plan and whether contributions are traditional or Roth.";
    if (/\bbrokerage account\b/.test(query)) return "A brokerage account lets you buy and sell investments. Unlike retirement accounts, it generally has no retirement-specific contribution or withdrawal rules.";
    if (/\b(opportunity cost|trade.off)\b/.test(query)) return "Opportunity cost is what you give up by choosing one option over another. Here, the calculator compares a purchase with the time it could add to a savings goal.";
    if (/\bbudget\b/.test(query)) return "A budget is a plan for how income will cover expenses, savings, and other priorities.";
  }

  if (/\b(portfolio|investments|investment accounts)\b/.test(query)) {
    const investmentAccounts = context.accounts.filter(account => /\b(brokerage|invest|ira|roth|401\(k\)|retirement)\b/i.test(`${account.name} ${account.kind}`));
    const total = investmentAccounts.reduce((sum, account) => sum + (account.isDebt ? 0 : account.balance), 0);
    return investmentAccounts.length
      ? `Your investment accounts total ${money(total)} across ${investmentAccounts.map(account => account.name).join(", ")}.`
      : "There are no brokerage or retirement accounts on your dashboard yet. Add one in Accounts to include it here.";
  }

  if (/\b(assets|total assets)\b/.test(query)) {
    return `Your dashboard shows ${money(context.assets)} in assets and ${money(context.debt)} in debt.`;
  }

  if (/\b(checking|savings|brokerage|roth|ira|401\(k\)|account)\b/.test(query)) {
    const matches = context.accounts.filter(account =>
      `${account.name} ${account.kind}`.toLowerCase().split(/\s+/).some(word => word.length > 2 && query.includes(word)),
    );
    if (matches.length) return matches.map(account => `${account.name} (${account.kind}): ${money(account.balance)}${account.isDebt ? " owed" : ""}.`).join(" ");
    if (context.accounts.length) {
      return `Across your accounts, you have ${money(context.assets)} in assets and ${money(context.debt)} in debt. You can see each balance in Accounts.`;
    }
    return "There are no accounts on your dashboard yet. Add an account or connect a bank to get started.";
  }

  if (/\b(goal|goals|saving|savings|progress)\b/.test(query)) {
    if (!context.goals.length) return "You haven’t added a savings goal yet. Add one to track your progress in NorthStar.";
    return context.goals.map(goal => {
      const percent = goal.target > 0 ? Math.min(100, Math.round(goal.saved / goal.target * 100)) : 0;
      return `${goal.name}: ${money(goal.saved)} of ${money(goal.target)} (${percent}%), saving ${money(goal.weekly)} per week.`;
    }).join(" ");
  }

  if (/\b(budget|left over|left to plan|monthly income|essentials|save)\b/.test(query)) {
    if (context.monthlyIncome <= 0) return "Add your monthly after-tax income in Budget to see how much is left after expenses and goal contributions.";
    const remaining = context.monthlyIncome - context.monthlyExpenses - context.monthlyGoalContributions;
    return `${money(context.monthlyIncome)} monthly income minus ${money(context.monthlyExpenses)} in essentials and lifestyle spending and ${money(context.monthlyGoalContributions)} in goal contributions leaves ${money(Math.abs(remaining))} ${remaining < 0 ? "over budget" : "to plan"}.`;
  }

  if (/\b(retirement|retire|401\(k\)|roth ira|traditional ira)\b/.test(query)) {
    if (context.retirementEstimate === null || context.retirementAge === null) {
      return `Your retirement accounts currently total ${money(context.retirementBalance)}. Enter your ages and monthly contribution in Retirement for an estimate.`;
    }
    return `Your retirement accounts total ${money(context.retirementBalance)} today. With your current assumptions, the illustrative estimate at age ${context.retirementAge} is ${money(context.retirementEstimate)}. It is not guaranteed.`;
  }

  if (/\b(spend|purchase|buy|opportunity cost|trade.off)\b/.test(query)) {
    return context.goals.length
      ? "The Opportunity cost calculator compares a purchase with your savings-goal timeline. Open it on Overview to compare one-time or recurring spending."
      : "Create a savings goal first, then use the Opportunity cost calculator on Overview to see how a purchase could affect its timeline.";
  }

  if (/\b(net worth|asset|debt|interest|budget)\b/.test(query)) {
    return "Net worth is what you own minus what you owe. Your dashboard groups balances into assets and debt so you can see both sides.";
  }

  return "I can help with balances, goals, budget, retirement, and investing basics. Try “How do I start investing?”, “Explain index funds”, or “How should I diversify?”";
}
