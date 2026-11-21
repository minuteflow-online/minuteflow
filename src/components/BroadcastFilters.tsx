"use client";

// Multi-select filters over a list of broadcasts: Type (memo, announcement, …),
// Account (tags) and Author. Inside a group any picked option matches; across
// groups every group must match. Used by the portal and the admin list.

export interface BroadcastFilterState {
  types: string[];
  tags: string[];
  authors: string[];
}

export const EMPTY_BROADCAST_FILTERS: BroadcastFilterState = { types: [], tags: [], authors: [] };

interface Filterable {
  category: string;
  tags?: string[] | null;
  published_by_name?: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  memo: "Memo",
  announcement: "Announcement",
  training: "Training",
  coaching_notes: "Coaching Notes",
  job_posting: "Job Posting",
  onboarding: "Onboarding",
};

export function applyBroadcastFilters<T extends Filterable>(items: T[], f: BroadcastFilterState): T[] {
  return items.filter(
    (b) =>
      (f.types.length === 0 || f.types.includes(b.category)) &&
      (f.tags.length === 0 || (b.tags ?? []).some((t) => f.tags.includes(t))) &&
      (f.authors.length === 0 || (!!b.published_by_name && f.authors.includes(b.published_by_name)))
  );
}

export function hasBroadcastFilters(f: BroadcastFilterState): boolean {
  return f.types.length + f.tags.length + f.authors.length > 0;
}

const sorted = (values: Iterable<string>) => Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));

/** A group is worth showing when picking from it would actually narrow the list. */
function useful<T>(items: T[], options: string[], has: (item: T, option: string) => boolean): boolean {
  if (options.length > 1) return true;
  return options.length === 1 && items.some((i) => !has(i, options[0]));
}

const chipClass = (on: boolean) =>
  `rounded-full px-3 py-1 text-[11px] font-semibold capitalize transition-colors cursor-pointer ${
    on ? "bg-terracotta-soft text-terracotta" : "bg-stone/10 text-stone hover:bg-stone/20"
  }`;

export default function BroadcastFilters<T extends Filterable>({
  items,
  value,
  onChange,
}: {
  items: T[];
  value: BroadcastFilterState;
  onChange: (next: BroadcastFilterState) => void;
}) {
  const types = sorted(items.map((b) => b.category));
  const tags = sorted(items.flatMap((b) => b.tags ?? []));
  const authors = sorted(items.map((b) => b.published_by_name).filter((n): n is string => !!n));

  const groups: { key: keyof BroadcastFilterState; label: string; options: string[]; show: boolean; text: (o: string) => string }[] = [
    { key: "types", label: "Type", options: types, show: useful(items, types, (b, o) => b.category === o), text: (o) => TYPE_LABELS[o] ?? o },
    { key: "tags", label: "Account", options: tags, show: useful(items, tags, (b, o) => (b.tags ?? []).includes(o)), text: (o) => o },
    { key: "authors", label: "Author", options: authors, show: useful(items, authors, (b, o) => b.published_by_name === o), text: (o) => o },
  ];
  const shown = groups.filter((g) => g.show);
  if (shown.length === 0) return null;

  const toggle = (key: keyof BroadcastFilterState, option: string) => {
    const current = value[key];
    onChange({
      ...value,
      [key]: current.includes(option) ? current.filter((o) => o !== option) : [...current, option],
    });
  };

  return (
    <div className="space-y-2">
      {shown.map((g) => (
        <div key={g.key} className="flex flex-wrap items-center gap-1.5">
          <p className="w-16 shrink-0 text-[10px] font-semibold text-walnut tracking-wide uppercase">{g.label}</p>
          <button onClick={() => onChange({ ...value, [g.key]: [] })} className={chipClass(value[g.key].length === 0)}>
            All
          </button>
          {g.options.map((o) => (
            <button key={o} onClick={() => toggle(g.key, o)} className={chipClass(value[g.key].includes(o))}>
              {g.text(o)}
            </button>
          ))}
        </div>
      ))}
      {hasBroadcastFilters(value) && (
        <button
          onClick={() => onChange(EMPTY_BROADCAST_FILTERS)}
          className="text-[11px] text-terracotta hover:underline cursor-pointer"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
