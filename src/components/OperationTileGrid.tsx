"use client";

// The Basecamp-style tile grid for an Operation's workspace — Phase 2,
// docs/operations-basecamp-feature.md. Operations only for now, per Toni's
// "let's see on operations first." Each tile opens full-width in place of
// this grid; VAProjectsTab renders the back button and swaps the content.

export type OperationTileKey = "message_board" | "recurring" | "subtasks";

interface OperationTileGridProps {
  recurringCount: number;
  subtaskCount: number;
  onSelect: (tile: OperationTileKey) => void;
}

interface Tile {
  key: OperationTileKey;
  title: string;
  description: string;
  count?: number;
  countLabel?: string;
}

export default function OperationTileGrid({ recurringCount, subtaskCount, onSelect }: OperationTileGridProps) {
  const tiles: Tile[] = [
    {
      key: "message_board",
      title: "Message Board",
      description: "Post updates and announcements for this Operation's team.",
    },
    {
      key: "recurring",
      title: "Recurring",
      description: "Templates that generate this Operation's day-to-day tasks.",
      count: recurringCount,
      countLabel: recurringCount === 1 ? "template" : "templates",
    },
    {
      key: "subtasks",
      title: "Subtasks",
      description: "The task list — List View or Board View.",
      count: subtaskCount,
      countLabel: subtaskCount === 1 ? "task" : "tasks",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          onClick={() => onSelect(tile.key)}
          className="flex flex-col gap-2 p-4 rounded-xl border border-sand bg-white hover:bg-cream transition-colors text-left cursor-pointer"
        >
          <h3 className="text-xs font-bold text-espresso uppercase tracking-wide">{tile.title}</h3>
          <p className="text-[11px] text-stone/80 leading-snug">{tile.description}</p>
          {tile.count !== undefined && (
            <span className="text-[10px] font-semibold px-2 py-[2px] rounded-full bg-stone/10 text-stone border border-stone/20 w-fit">
              {tile.count} {tile.countLabel}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
