"use client";

import { useCallback, useRef, useState } from "react";

const VIEWPORT = 240;
const OUTPUT = 480;
const ALLOWED_TYPES = "image/png,image/jpeg,image/webp,image/gif";

type Props = {
  avatarUrl: string | null | undefined;
  fullName: string;
  /** Diameter in px of the avatar circle shown outside the modal (e.g. in a nav chip or sidebar). */
  size?: number;
  className?: string;
  onUploaded: (url: string) => void;
};

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/** Avatar circle + click-to-upload, with a drag-to-reposition + zoom crop modal. */
export default function AvatarUpload({ avatarUrl, fullName, size = 32, className = "", onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dragRef = useRef<{ dragging: boolean; startX: number; startY: number; origX: number; origY: number }>({
    dragging: false,
    startX: 0,
    startY: 0,
    origX: 0,
    origY: 0,
  });

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setImageSrc(URL.createObjectURL(file));
  }, []);

  const cancelCrop = useCallback(() => {
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(null);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setError(null);
  }, [imageSrc]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { dragging: true, startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
  }, [offset]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current.dragging) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current.dragging = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }, []);

  const save = useCallback(async () => {
    const img = imgRef.current;
    if (!img) return;
    setError(null);
    setUploading(true);
    try {
      const naturalW = img.naturalWidth;
      const naturalH = img.naturalHeight;
      const baseScale = Math.max(VIEWPORT / naturalW, VIEWPORT / naturalH);
      const ratio = OUTPUT / VIEWPORT;
      const scale = baseScale * zoom * ratio;

      const canvas = document.createElement("canvas");
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const ctx = canvas.getContext("2d")!;
      ctx.save();
      ctx.translate(OUTPUT / 2 + offset.x * ratio, OUTPUT / 2 + offset.y * ratio);
      ctx.scale(scale, scale);
      ctx.drawImage(img, -naturalW / 2, -naturalH / 2, naturalW, naturalH);
      ctx.restore();

      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        setError("Couldn't process image");
        return;
      }

      const form = new FormData();
      form.append("file", blob, "avatar.png");
      const res = await fetch("/api/upload-avatar", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
        return;
      }
      onUploaded(data.avatar_url);
      cancelCrop();
    } catch {
      setError("Upload failed");
    } finally {
      setUploading(false);
    }
  }, [zoom, offset, onUploaded, cancelCrop]);

  return (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className={`shrink-0 rounded-full ${className}`}
        style={{ width: size, height: size }}
        title="Upload photo"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
        ) : (
          <div
            className="flex h-full w-full items-center justify-center rounded-full bg-terracotta font-bold text-white"
            style={{ fontSize: size * 0.4 }}
          >
            {getInitials(fullName)}
          </div>
        )}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES}
        onChange={handleFileChange}
        className="hidden"
      />

      {imageSrc && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40">
          <div className="w-full max-w-xs rounded-xl border border-sand bg-white p-5 text-center shadow-xl">
            <h3 className="mb-1 font-serif text-base font-bold text-espresso">Adjust Photo</h3>
            <p className="mb-3 text-[11px] text-stone">Drag to reposition, use the slider to zoom</p>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              className="mx-auto touch-none select-none overflow-hidden rounded-full border border-sand bg-parchment"
              style={{ width: VIEWPORT, height: VIEWPORT, cursor: "grab" }}
            >
              <img
                ref={imgRef}
                src={imageSrc}
                alt=""
                draggable={false}
                className="h-full w-full object-cover"
                style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "center" }}
              />
            </div>
            <div className="mt-4 flex items-center gap-2 px-2">
              <span className="text-xs text-stone">−</span>
              <input
                type="range"
                min={1}
                max={3}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(parseFloat(e.target.value))}
                className="w-full accent-terracotta"
              />
              <span className="text-xs text-stone">+</span>
            </div>
            {error && <p className="mt-2 text-[11px] text-terracotta">{error}</p>}
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={cancelCrop}
                disabled={uploading}
                className="flex-1 rounded-lg bg-parchment px-3 py-2 text-[13px] font-semibold text-walnut transition-colors hover:bg-sand disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={uploading}
                className="flex-1 rounded-lg bg-terracotta px-3 py-2 text-[13px] font-semibold text-white transition-colors hover:bg-[#a85840] disabled:opacity-50"
              >
                {uploading ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
