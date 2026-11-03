"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { escapeHtml, isRichEmpty, sanitizeRichHtml, IMAGE_SIZES, RICH_TEXT_CLASSES, type ImageSize } from "@/lib/richText";

// Highlight choices: the palette's soft accent tones (globals.css). Clay-rose-soft is
// left out — next to terracotta-soft the two read as the same color.
const HIGHLIGHT_COLORS: { label: string; value: string; swatch: string }[] = [
  { label: "Yellow", value: "#f5ecd0", swatch: "bg-amber-soft" },
  { label: "Green", value: "#dce8dd", swatch: "bg-sage-soft" },
  { label: "Pink", value: "#f0ddd5", swatch: "bg-terracotta-soft" },
  { label: "Blue", value: "#dfe5ea", swatch: "bg-slate-blue-soft" },
  { label: "Purple", value: "#ede8f5", swatch: "bg-plum-soft" },
];

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  /** Uploads an image and resolves to its public URL (or null on failure). */
  onUploadImage: (file: File) => Promise<string | null>;
}

export default function RichTextEditor({ value, onChange, placeholder, onUploadImage }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [empty, setEmpty] = useState(() => isRichEmpty(value));
  const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);

  // Load external value (open/edit/reset) without clobbering the caret while typing.
  useEffect(() => {
    const el = editorRef.current;
    if (el && el.innerHTML !== value) el.innerHTML = value;
    setEmpty(isRichEmpty(value));
  }, [value]);

  const emit = useCallback(() => {
    const html = editorRef.current?.innerHTML ?? "";
    setEmpty(isRichEmpty(html));
    onChange(html);
  }, [onChange]);

  const saveSelection = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  };

  const restoreSelection = () => {
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
  };

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    emit();
  };

  // "transparent" removes a highlight without touching bold, links or other formatting.
  const highlight = (color: string) => {
    editorRef.current?.focus();
    // CSS mode makes the browser emit <span style="background-color">, which the sanitizer keeps.
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand("hiliteColor", false, color);
    document.execCommand("styleWithCSS", false, "false");
    emit();
  };

  const addLink = () => {
    saveSelection();
    const raw = window.prompt("Link URL", "https://");
    if (!raw) return;
    const url = /^(https?:\/\/|mailto:)/i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    restoreSelection();
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) {
      exec("createLink", url);
    } else {
      exec("insertHTML", `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>&nbsp;`);
    }
  };

  const insertImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const url = await onUploadImage(file);
        if (!url) return;
        restoreSelection();
        document.execCommand("insertHTML", false, `<img src="${escapeHtml(url)}" alt="">`);
        emit();
      } finally {
        setUploading(false);
      }
    },
    [onUploadImage, emit]
  );

  // Clicking an image selects it (outlined via data-selected) so its size can be changed.
  const selectImage = (img: HTMLImageElement | null) => {
    editorRef.current?.querySelectorAll("img[data-selected]").forEach((el) => el.removeAttribute("data-selected"));
    if (img) img.setAttribute("data-selected", "");
    setSelectedImg(img);
  };

  // null = the image's original size (capped at the message width)
  const setImageSize = (size: ImageSize | null) => {
    if (!selectedImg) return;
    if (size) {
      selectedImg.setAttribute("data-size", size);
      selectedImg.style.width = IMAGE_SIZES[size].width;
    } else {
      selectedImg.removeAttribute("data-size");
      selectedImg.style.removeProperty("width");
      if (!selectedImg.getAttribute("style")) selectedImg.removeAttribute("style");
    }
    emit();
  };

  const removeImage = () => {
    if (!selectedImg) return;
    selectedImg.remove();
    setSelectedImg(null);
    emit();
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const imageFile = Array.from(e.clipboardData.files).find((f) => f.type.startsWith("image/"));
    if (imageFile) {
      e.preventDefault();
      saveSelection();
      insertImageFile(imageFile);
      return;
    }
    // Strip foreign styling/scripts from pasted HTML before it lands in the editor.
    const html = e.clipboardData.getData("text/html");
    e.preventDefault();
    if (html) {
      document.execCommand("insertHTML", false, sanitizeRichHtml(html));
    } else {
      document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
    }
    emit();
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    const imageFile = Array.from(e.dataTransfer.files).find((f) => f.type.startsWith("image/"));
    if (!imageFile) return;
    e.preventDefault();
    const pos = document.caretRangeFromPoint?.(e.clientX, e.clientY);
    if (pos) savedRange.current = pos;
    insertImageFile(imageFile);
  };

  const btn =
    "h-7 min-w-7 px-1.5 inline-flex items-center justify-center rounded text-[12px] text-walnut hover:bg-parchment hover:text-espresso cursor-pointer transition-colors";

  // onMouseDown preventDefault keeps the text selection when a toolbar button is clicked.
  const keep = (e: React.MouseEvent) => e.preventDefault();

  return (
    <div className="border border-sand rounded-lg bg-white focus-within:border-terracotta">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 border-b border-sand px-1.5 py-1">
        <button type="button" title="Bold" onMouseDown={keep} onClick={() => exec("bold")} className={`${btn} font-bold`}>B</button>
        <button type="button" title="Italic" onMouseDown={keep} onClick={() => exec("italic")} className={`${btn} italic font-serif`}>I</button>
        <button type="button" title="Underline" onMouseDown={keep} onClick={() => exec("underline")} className={`${btn} underline`}>U</button>
        <span className="mx-1 h-4 w-px bg-sand" />
        <span className="text-[10px] font-semibold text-walnut tracking-wide uppercase px-1">Highlight</span>
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={`Highlight ${c.label.toLowerCase()}`}
            onMouseDown={keep}
            onClick={() => highlight(c.value)}
            className="h-7 w-6 inline-flex items-center justify-center rounded hover:bg-parchment cursor-pointer transition-colors"
          >
            <span className={`h-4 w-4 rounded-sm border border-sand ${c.swatch}`} />
          </button>
        ))}
        <button
          type="button"
          title="Remove highlight"
          onMouseDown={keep}
          onClick={() => highlight("transparent")}
          className="h-7 w-6 inline-flex items-center justify-center rounded hover:bg-parchment cursor-pointer transition-colors"
        >
          <svg className="h-4 w-4 text-terracotta" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <rect x="0.75" y="0.75" width="14.5" height="14.5" rx="2" className="text-sand" stroke="currentColor" />
            <line x1="3" y1="13" x2="13" y2="3" />
          </svg>
        </button>
        <span className="mx-1 h-4 w-px bg-sand" />
        <button type="button" title="Bulleted list" onMouseDown={keep} onClick={() => exec("insertUnorderedList")} className={btn}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="9" y1="6" x2="20" y2="6" /><line x1="9" y1="12" x2="20" y2="12" /><line x1="9" y1="18" x2="20" y2="18" />
            <circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" />
          </svg>
        </button>
        <button type="button" title="Insert link" onMouseDown={keep} onClick={addLink} className={btn}>
          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
          </svg>
        </button>
        <button
          type="button"
          title="Insert image at cursor"
          onMouseDown={keep}
          onClick={() => {
            saveSelection();
            fileInputRef.current?.click();
          }}
          disabled={uploading}
          className={`${btn} disabled:opacity-50`}
        >
          {uploading ? (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-sand border-t-terracotta animate-spin" />
          ) : (
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          )}
        </button>
        <span className="mx-1 h-4 w-px bg-sand" />
        <button type="button" title="Clear formatting" onMouseDown={keep} onClick={() => exec("removeFormat")} className={`${btn} text-stone`}>
          Clear
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) insertImageFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {/* Image size — shown while an image in the message is selected */}
      {selectedImg && (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-sand bg-parchment px-3 py-1.5">
          <span className="text-[10px] font-semibold text-walnut tracking-wide uppercase mr-1">Image size</span>
          {[...(Object.keys(IMAGE_SIZES) as ImageSize[]), null].map((size) => {
            const active = (selectedImg.getAttribute("data-size") || null) === size;
            return (
              <button
                key={size ?? "original"}
                type="button"
                onMouseDown={keep}
                onClick={() => setImageSize(size)}
                className={`px-3 py-1 rounded-lg text-[10px] font-semibold transition-colors cursor-pointer ${
                  active ? "bg-sage text-white hover:bg-sage/90" : "bg-stone/10 text-stone hover:bg-stone/20"
                }`}
              >
                {size ? IMAGE_SIZES[size].label : "Original"}
              </button>
            );
          })}
          <button
            type="button"
            onMouseDown={keep}
            onClick={removeImage}
            className="ml-auto text-[11px] text-terracotta hover:underline cursor-pointer"
          >
            Remove image
          </button>
        </div>
      )}

      {/* Editable area */}
      <div className="relative">
        {empty && placeholder && (
          <div className="pointer-events-none absolute left-3 top-2 text-[13px] text-stone">{placeholder}</div>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={emit}
          onClick={(e) => selectImage(e.target instanceof HTMLImageElement ? e.target : null)}
          onBlur={() => {
            saveSelection();
            selectImage(null);
          }}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onPaste={handlePaste}
          onDrop={handleDrop}
          className={`min-h-[180px] max-h-[480px] overflow-y-auto py-2 px-3 text-[13px] text-ink leading-relaxed outline-none ${RICH_TEXT_CLASSES}`}
        />
      </div>
    </div>
  );
}
