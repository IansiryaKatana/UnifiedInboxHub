import { cn } from "@/lib/utils";

interface Props {
  email: string;
  color: string;
  className?: string;
  size?: "sm" | "md";
}

export function AccountBadge({ email, color, className, size = "sm" }: Props) {
  const label = email ? email[0].toUpperCase() + email.slice(1) : email;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full font-medium border",
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
        className
      )}
      style={{
        backgroundColor: `${color}14`,
        color,
        borderColor: `${color}40`,
      }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
