import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const SIZES = { sm: "size-6 text-[10px]", default: "size-8 text-xs" } as const;

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Initials avatar for people (the account menu, assignees on cards). */
export function UserAvatar({ name, size = "default", className }: { name: string; size?: keyof typeof SIZES; className?: string }) {
  return (
    <Avatar className={cn(SIZES[size], className)} title={name}>
      <AvatarFallback className={size === "sm" ? "text-[10px]" : "text-xs"}>{initialsOf(name) || "?"}</AvatarFallback>
    </Avatar>
  );
}
