"use client";

import { useState } from "react";
import { PORTAL_TAB_BY_CATEGORY, broadcastPortalPath } from "@/lib/broadcasts";

/** Login-protected link that opens the portal on this broadcast, scrolled to and highlighted. */
export function broadcastShareUrl(category: string, id: string): string | null {
  const path = broadcastPortalPath(category, id);
  return path ? `${window.location.origin}${path}` : null;
}

export default function BroadcastCopyLinkButton({ category, id }: { category: string; id: string }) {
  const [copied, setCopied] = useState(false);
  if (!PORTAL_TAB_BY_CATEGORY[category]) return null;

  const copy = async () => {
    const url = broadcastShareUrl(category, id);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      title="Copy a link to this broadcast (team login required)"
      className="inline-flex items-center gap-1 text-[11px] text-walnut hover:text-espresso cursor-pointer px-2 py-1 rounded border border-sand hover:border-walnut transition-all"
    >
      <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
      </svg>
      {copied ? "Copied!" : "Copy link"}
    </button>
  );
}
