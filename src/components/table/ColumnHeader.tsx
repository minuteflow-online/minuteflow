"use client";

import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

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

  // The popover renders via a portal at a viewport-relative fixed position
  // instead of absolute-inside-the-header, so it can't get clipped by the
  // table's own horizontal-scroll container when the column sits near the
  // right edge (every filterable column can end up there in a wide table).
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const POPOVER_WIDTH = customFilter ? 220 : 180;

  useLayoutEffect(() => {
    if (!open || !buttonRef.current) {
      setPopoverPos(null);
      return;
    }
    const position = () => {
      if (!buttonRef.current) return;
      const rect = buttonRef.current.getBoundingClientRect();
      const margin = 8;
      const maxLeft = window.innerWidth - POPOVER_WIDTH - margin;
      const left = Math.min(rect.left, Math.max(margin, maxLeft));
      setPopoverPos({ top: rect.bottom + 4, left });
    };
    position();
    window.addEventListener("resize", position);
    return () => window.removeEventListener("resize", position);
  }, [open, POPOVER_WIDTH]);

  useEffect(() => {
    if (!open) return;
    const closeOnScroll = () => setOpen(false);
    // Capture phase so this fires for scroll on any ancestor (e.g. the
    // table's own overflow-x-auto wrapper), not just window-level scroll.
    window.addEventListener("scroll", closeOnScroll, true);
    return () => window.removeEventListener("scroll", closeOnScroll, true);
  }, [open]);

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
              ref={buttonRef}
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="flex h-5 w-5 items-center justify-center rounded text-terracotta hover:text-[#a85840]"
              aria-label={`Filter ${label}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="h-4 w-4">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {open && popoverPos && customFilter && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div
                  className="fixed z-50 min-w-[220px] rounded-xl border border-sand bg-white p-3 normal-case shadow-lg"
                  style={{ top: popoverPos.top, left: popoverPos.left }}
                >
                  {customFilter(() => setOpen(false))}
                </div>
              </>,
              document.body
            )}
            {open && popoverPos && !customFilter && filterOptions && onFilterChange && createPortal(
              <>
                <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
                <div
                  className="fixed z-50 min-w-[180px] rounded-xl border border-sand bg-white py-1 normal-case shadow-lg"
                  style={{ top: popoverPos.top, left: popoverPos.left }}
                >
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
              </>,
              document.body
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
