import type { LucideIcon } from "lucide-react";

// Einheitliche Seiten-Überschrift: Icon-Badge + Titel (+ optional
// Beschreibung und Aktions-Buttons rechts). Wird ab Ebene 5 nach und nach
// auf allen Modul-Seiten statt des nackten <h1> eingesetzt.
export default function PageHeader({
  icon: Icon,
  titel,
  beschreibung,
  aktionen,
}: {
  icon?: LucideIcon;
  titel: string;
  beschreibung?: string;
  aktionen?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-2.5">
        {Icon && (
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div>
          <h1 className="text-lg font-semibold text-emerald-900">{titel}</h1>
          {beschreibung && (
            <p className="text-sm text-neutral-500">{beschreibung}</p>
          )}
        </div>
      </div>
      {aktionen && (
        <div className="flex flex-wrap items-center gap-2">{aktionen}</div>
      )}
    </div>
  );
}
