import { ArrowDownLeft, ArrowUpRight, Car, CircleDollarSign, Clapperboard, CreditCard, HeartPulse, House, Landmark, Plane, Receipt, ShoppingBag, Sparkles, Tag, Utensils, Wrench, type LucideIcon } from "lucide-react";

// Plaid personal_finance_category.primary → a line icon (replaces the old emoji).
const ICONS: Record<string, LucideIcon> = {
  INCOME: CircleDollarSign,
  RENT_AND_UTILITIES: House,
  FOOD_AND_DRINK: Utensils,
  TRANSPORTATION: Car,
  TRAVEL: Plane,
  GENERAL_MERCHANDISE: ShoppingBag,
  PERSONAL_CARE: Sparkles,
  ENTERTAINMENT: Clapperboard,
  MEDICAL: HeartPulse,
  GENERAL_SERVICES: Receipt,
  HOME_IMPROVEMENT: Wrench,
  GOVERNMENT_AND_NON_PROFIT: Landmark,
  BANK_FEES: Landmark,
  LOAN_PAYMENTS: CreditCard,
  TRANSFER_IN: ArrowDownLeft,
  TRANSFER_OUT: ArrowUpRight,
};

/** A category's icon in a small tile (rows) or inline next to a label. Decorative: the label carries the meaning. */
export function CategoryIcon({ category, inline = false }: { category: string; inline?: boolean }) {
  const Icon = ICONS[category] ?? Tag;
  return (
    <span className={`category-icon${inline ? " is-inline" : ""}`} aria-hidden="true">
      <Icon size={inline ? 16 : 18} />
    </span>
  );
}
