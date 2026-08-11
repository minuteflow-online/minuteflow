"use client";

import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

type FilterOptionValue = string | number;

type ColumnHeaderProps<T extends FilterOptionValue> = {
  label: string;
  width: number;
  onResize: (width: number) => void;
  minWidth?: number;
  filterOptions?: { value: T; label: string }[];
  selected?: T[];
  onFilterChange?: (v: T[]) => void;
  /** Adds a search box above the checkbox list, for columns with many options (e.g. task names). */
  searchable?: boolean;
  searchValue?: string;
  onSearchChange?: (v: string) => void;
  searchPlaceholder?: string;
  /** True when a custom filter (e.g. a date range) is currently applied — only used with customFilter. */
  isFiltered?: boolean;
  /**
   * Escape hatch for filter UIs that aren't a checkbox list (e.g. a from/to
   * date range). When set, this renders inside the same caret popover
   * instead of the built-in checkbox list. `close` lets the custom content
   * dismiss the popover itself (e.g. after "Apply").
   */
  customFilter?: (close: () => void) => ReactNode;
};

// Column header with an Excel-style filter caret and a drag handle on the
// right edge for resizing — replaces the separate filter-dropdown-row +
// fixed-width-column pattern that was duplicated across every task table.
export default function ColumnHeader<T extends FilterOptionValue>({
  label,
  width,
  onResize,
  minWidth = 60,
  filterOptions,
  selected = [],
  onFilterChange,
  searchable,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  isFiltered: isFilteredProp,
  customFilter,
}: ColumnHeaderProps<T>) {
  const [open, setOpen] = useState(false);
  const hasFilter = Boolean((filterOptions && onFilterChange) || customFilter);
  const isFiltered = customFilter ? Boolean(isFilteredProp) : selected.length > 0;
  const visibleOptions =
    searchable && searchValue && filterOptions
      ? filterOptions.filter((opt) => opt.label.toLowerCase().includes(searchValue.toLowerCase()))
      : filterOptions ?? [];

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(minWidth, startWidth + (moveEvent.clientX - startX));
      onResize(next);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <th
      style={{ width, minWidth }}
      className="relative select-none border-b border-sand bg-parchment px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-walnut"
    >
      <div className="flex items-center gap-1 pr-2">
        <span className="truncate">{label}</span>
        {hasFilter && (
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className={`flex h-4 w-4 items-center justify-center rounded ${isFiltered ? "text-terracotta" : "text-stone hover:text-walnut"}`}
              aria-label={`Filter ${label}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-3 w-3">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {open && customFilter && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-xl border border-sand bg-white p-3 normal-case shadow-lg">
                  {customFilter(() => setOpen(false))}
                </div>
              </>
            )}
            {open && !customFilter && filterOptions && onFilterChange && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-xl border border-sand bg-white py-1 normal-case shadow-lg">
                  {searchable && onSearchChange && (
                    <div className="border-b border-sand px-3 py-2">
                      <input
                        value={searchValue || ""}
                        onChange={(e) => onSearchChange(e.target.value)}
                        placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                        className="w-full rounded-lg border border-sand px-2.5 py-1.5 text-[13px] outline-none focus:border-terracotta"
                      />
                    </div>
                  )}
                  <div className="flex items-center justify-between border-b border-sand px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => onFilterChange(visibleOptions.map((o) => o.value))}
                      className="text-[11px] text-terracotta hover:underline"
                    >
                      Select All
                    </button>
                    <button type="button" onClick={() => onFilterChange([])} className="text-[11px] text-stone hover:underline">
                      Clear
                    </button>
                  </div>
                  {visibleOptions.length > 0 ? (
                    visibleOptions.map((opt) => (
                      <label key={String(opt.value)} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 font-normal normal-case hover:bg-parchment">
                        <input
                          type="checkbox"
                          checked={selected.includes(opt.value)}
                          onChange={(e) => {
                            if (e.target.checked) onFilterChange([...selected, opt.value]);
                            else onFilterChange(selected.filter((v) => v !== opt.value));
                          }}
                          className="accent-terracotta"
                        />
                        <span className="text-[13px] text-espresso">{opt.label}</span>
                      </label>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-[12px] font-normal normal-case text-stone">No options found</div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <div
        onPointerDown={startResize}
        className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-terracotta/30"
      />
    </th>
  );
}
