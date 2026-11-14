// General US federal treatment; deliberately omit annually changing dollar limits.
const accounts = [
  { match: /\b(traditional ira|iras?|individual retirement)\b/, name: "Traditional IRA", detail: "An individual retirement account. Contributions may be deductible depending on income, filing status, and workplace-plan coverage. Growth is tax-deferred; deductible contributions and earnings are generally taxed on withdrawal. Early withdrawals may trigger an additional tax, and required distributions apply." },
  { match: /\b(roth|roth ira)\b/, name: "Roth IRA", detail: "Funded with after-tax money, with no contribution deduction. Qualified withdrawals are federally tax-free. Direct contributions depend on income and taxable compensation. Regular contributions generally come out tax- and penalty-free, but earnings and conversions have different timing rules." },
  { match: /\b401\s*(?:\(k\)|k)/, name: "401(k)", detail: "A workplace retirement plan that may offer an employer match, subject to plan and vesting rules. Traditional employee contributions generally defer federal income tax until withdrawal; Roth contributions use after-tax money and qualified withdrawals are tax-free. Investment choices and withdrawal access depend on the plan." },
  { match: /\b403\s*(?:\(b\)|b)/, name: "403(b)", detail: "A workplace retirement plan for eligible public-school and certain nonprofit employees. It may offer traditional pre-tax and Roth contributions. Compare investment fees, any annuity restrictions, matching, and withdrawal rules in your plan." },
  { match: /\b457\s*(?:\(b\)|b)/, name: "457(b)", detail: "A deferred-compensation plan for eligible government and certain nonprofit employees. Governmental and nongovernmental plans differ substantially in creditor protection, rollovers, and access. Eligible governmental plans may offer Roth contributions; check your specific plan before comparing withdrawal rules." },
  { match: /\b(sep|simple|self.employed|solo 401)/, name: "Self-employed and small-business plans", detail: "SEP IRAs, SIMPLE IRAs, and solo 401(k)s offer retirement saving options for eligible businesses or self-employed workers. Employer contributions, employee eligibility, setup deadlines, and contribution calculations differ; business income alone is not enough to determine your limit." },
  { match: /\b(hsa|health savings)\b/, name: "HSA", detail: "A health savings account for people meeting HSA eligibility rules, including qualifying health coverage and restrictions on other coverage. Contributions receive federal tax benefits, earnings grow tax-free, and qualified medical withdrawals are tax-free. Unused funds roll over and remain yours. Nonmedical withdrawals can be taxable and may carry an additional tax; state treatment can differ." },
  { match: /\b(fsa|flexible spending)\b/, name: "Health FSA", detail: "An employer health flexible spending arrangement generally funded with pre-tax salary contributions for eligible medical expenses. Unused funds are generally forfeited unless the plan permits a limited carryover or grace period. A general-purpose health FSA can affect HSA contribution eligibility." },
  { match: /\b(529|education savings|college savings)\b/, name: "529 plan", detail: "An education savings or prepaid tuition plan. Contributions are not federally deductible; earnings used for qualified education expenses are generally federally tax-free. State benefits and qualified-expense rules vary. Nonqualified withdrawals can create income tax and an additional tax on earnings." },
];

export function answerAccountEducation(query: string): string | null {
  const overview = /\b(retirement|tax.advantaged|tax.benefit|tax.favored)\b/.test(query)
    && /\b(accounts?|plans?|options|types|compare|different)\b/.test(query);
  const matches = accounts.filter(account => {
    if (account.name === "Traditional IRA" && /\broth\b/.test(query) && !/\btraditional\b/.test(query)) return false;
    if (account.name === "Roth IRA" && !/\bira\b/.test(query) && /401|403|457/.test(query)) return false;
    return account.match.test(query);
  });
  // Preserve dashboard lookups; contribution and eligibility questions are education.
  if (/\b(balance|worth|how much is in|how much do i have|accounts total)\b/.test(query)) return null;
  if (!overview && !matches.length) return null;
  const selected = matches.length ? matches : accounts;
  const details = selected.map(account => `${account.name}: ${account.detail}`).join("\n\n");
  const limits = /\b(limit|maximum|how much|eligible|eligibility|qualify)\b/.test(query)
    ? " Exact limits and eligibility depend on tax year, age, income, filing status, coverage, and plan rules. I don’t have a live tax-rule lookup; verify the applicable year with the IRS and your plan administrator."
    : " Contribution limits and eligibility rules can change by tax year.";
  return `For US accounts (general federal tax treatment):\n\n${details}\n\nThese are account structures, not investments themselves; available investments depend on the provider.${limits} Educational information, not personalized tax advice. Sources: IRS retirement plans (https://www.irs.gov/retirement-plans), health accounts (https://www.irs.gov/publications/p969), and 529 plans (https://www.irs.gov/taxtopics/tc313).`;
}
