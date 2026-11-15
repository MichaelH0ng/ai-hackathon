import { UserRound } from "lucide-react";
import type { Profile } from "../lib/types";

export const avatarColors = [
  { name: "Blue", value: "#335cb3" },
  { name: "Teal", value: "#117275" },
  { name: "Purple", value: "#7444ad" },
  { name: "Rose", value: "#a63865" },
  { name: "Amber", value: "#945a12" },
  { name: "Slate", value: "#475569" },
];

export function ProfileAvatar({ profile, className = "" }: { profile: Profile; className?: string }) {
  const parts = (profile.name ?? "").trim().split(/\s+/).filter(Boolean);
  const initials = parts.length ? (parts[0][0] + (parts.length > 1 ? parts.at(-1)![0] : "")).toUpperCase() : null;
  const color = avatarColors.find(color => color.value === profile.avatarColor)?.value ?? avatarColors[0].value;
  return <span className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ${className}`} style={{ backgroundColor: color }} aria-hidden="true">
    {profile.avatarImage ? <img src={profile.avatarImage} alt="" className="h-full w-full object-cover" /> : initials ?? <UserRound className="h-1/2 w-1/2" />}
  </span>;
}
