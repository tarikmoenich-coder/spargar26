import type { LucideIcon } from "lucide-react";

// Freundlicher Leerzustand statt nacktem "keine Einträge".
export default function EmptyState({
  icon: Icon,
  text,
  hinweis,
}: {
  icon?: LucideIcon;
  text: string;
  hinweis?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-linie bg-white/60 px-4 py-10 text-center">
      {Icon && <Icon className="h-8 w-8 text-neutral-300" />}
      <p className="text-sm text-neutral-500">{text}</p>
      {hinweis && <p className="text-xs text-neutral-400">{hinweis}</p>}
    </div>
  );
}
