"use client";

import { useState, useRef, useCallback } from "react";

/* ── Types ──────────────────────────────────────────────── */

interface ColumnDef {
  key: string;
  label: string;
  required: boolean;
  example: string;
}

interface CSVUploadModalProps {
  title: string;
  type: "expenses" | "time_logs";
  columns: ColumnDef[];
  onClose: () => void;
  onSuccess: () => void;
}

interface ParsedRow {
  [key: string]: string;
}

interface UploadError {
  row: number;
  message: string;
}

/* ── CSV Parser ─────────────────────────────────────────── */

function parseCSV(text: string): { headers: string[]; rows: ParsedRow[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };

  // Parse CSV properly (handle quoted fields with commas)
  const parseLine = (line: string): string[] => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === "," && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const rows: ParsedRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    if (values.every((v) => !v)) continue; // skip blank rows
    const row: ParsedRow = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || "";
    });
    rows.push(row);
  }

  return { headers, rows };
}

/* ── Template generators ────────────────────────────────── */

function generateTemplate(columns: ColumnDef[]): string {
  const headerRow = columns.map((c) => c.label).join(",");
  const exampleRow = columns.map((c) => {
    // Wrap in quotes if contains commas
    const val = c.example;
    return val.includes(",") ? `"${val}"` : val;
  }).join(",");
  return headerRow + "\n" + exampleRow + "\n";
}

/* ── Component ──────────────────────────────────────────── */

export default function CSVUploadModal({ title, type, columns, onClose, onSuccess }: CSVUploadModalProps) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; errors: UploadError[] } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [fileName, setFileName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { headers, rows } = parseCSV(text);
      if (rows.length === 0) {
        alert("No data rows found in file. Make sure the first row is headers.");
        return;
      }
      setParsedHeaders(headers);
      setParsedRows(rows);
      setStep("preview");
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file && (file.name.endsWith(".csv") || file.type === "text/csv")) {
      handleFile(file);
    } else {
      alert("Please upload a .csv file");
    }
  }, [handleFile]);

  const handleUpload = async () => {
    setUploading(true);
    try {
      const res = await fetch("/api/bulk-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, rows: parsedRows }),
      });

      // Safely parse JSON — server may return empty/malformed response
      let data: { inserted?: number; errors?: UploadError[]; error?: string };
      try {
        const text = await res.text();
        data = text ? JSON.parse(text) : {};
      } catch {
        data = { error: `Server returned invalid response (status ${res.status}). Try uploading fewer rows or check your CSV format.` };
      }

      if (!res.ok) {
        setResult({ inserted: data.inserted || 0, errors: data.errors || [{ row: 0, message: data.error || `Upload failed (status ${res.status})` }] });
      } else {
        setResult({ inserted: data.inserted || 0, errors: data.errors || [] });
      }
      setStep("result");
      if ((data.inserted || 0) > 0) {
        onSuccess();
      }
    } catch (err) {
      setResult({ inserted: 0, errors: [{ row: 0, message: `Network error: Could not reach server. Check your connection and try again.` }] });
      setStep("result");
    } finally {
      setUploading(false);
    }
  };

  const downloadTemplate = () => {
    const csv = generateTemplate(columns);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${type}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Map parsed headers to expected column keys
  const expectedKeys = columns.map((c) => c.key);
  const matchedKeys = parsedHeaders.filter((h) => expectedKeys.includes(h));
  const unmatchedHeaders = parsedHeaders.filter((h) => !expectedKeys.includes(h));
  const missingRequired = columns.filter((c) => c.required && !parsedHeaders.includes(c.key));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-2xl max-h-[85vh] rounded-xl border border-sand bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-parchment px-6 py-4 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-bold text-espresso">{title}</h3>
          <button onClick={onClose} className="text-bark hover:text-espresso cursor-pointer text-lg">&times;</button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === "upload" && (
            <div className="space-y-4">
              {/* Template download */}
              <div className="rounded-lg bg-parchment/30 border border-sand p-4">
                <div className="text-[12px] font-semibold text-espresso mb-1">Step 1: Download the template</div>
                <p className="text-[11px] text-bark mb-2">
                  Use this CSV template so your columns match what we expect. Fill it out and upload it below.
                </p>
                <button
                  onClick={downloadTemplate}
                  className="rounded-lg bg-terracotta px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-terracotta/80 transition-colors cursor-pointer"
                >
                  Download Template CSV
                </button>
              </div>

              {/* Expected columns info */}
              <div className="text-[11px] text-bark">
                <span className="font-semibold text-espresso">Expected columns: </span>
                {columns.map((c, i) => (
                  <span key={c.key}>
                    <span className={c.required ? "font-semibold text-espresso" : "text-bark/70"}>
                      {c.label}{c.required ? " *" : ""}
                    </span>
                    {i < columns.length - 1 ? ", " : ""}
                  </span>
                ))}
              </div>

              {/* Drop zone */}
              <div
                className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
                  dragActive
                    ? "border-terracotta bg-terracotta/5"
                    : "border-sand bg-parchment/10 hover:border-terracotta/50"
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
              >
                <div className="text-[13px] font-semibold text-espresso mb-1">
                  Drag & drop your CSV file here
                </div>
                <div className="text-[11px] text-bark mb-3">or</div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white hover:bg-terracotta/80 transition-colors cursor-pointer"
                >
                  Browse Files
                </button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFile(file);
                  }}
                />
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="text-[12px] font-semibold text-espresso">
                  Preview: {fileName}
                </div>
                <span className="text-[11px] text-bark bg-parchment rounded-full px-2 py-0.5">
                  {parsedRows.length} row{parsedRows.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Column matching info */}
              {missingRequired.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-[11px] text-red-700">
                  <span className="font-semibold">Missing required columns: </span>
                  {missingRequired.map((c) => c.label).join(", ")}
                  <div className="mt-1 text-red-500">
                    Make sure your CSV header row matches the template column names.
                  </div>
                </div>
              )}

              {unmatchedHeaders.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-[11px] text-amber-700">
                  <span className="font-semibold">Unrecognized columns (will be ignored): </span>
                  {unmatchedHeaders.join(", ")}
                </div>
              )}

              {matchedKeys.length > 0 && missingRequired.length === 0 && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-[11px] text-green-700">
                  <span className="font-semibold">Matched {matchedKeys.length} of {expectedKeys.length} columns. </span>
                  Ready to upload.
                </div>
              )}

              {/* Data table preview (show first 10 rows) */}
              <div className="overflow-x-auto rounded-lg border border-sand">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="bg-parchment/30 border-b border-parchment">
                      <th className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-bark">#</th>
                      {parsedHeaders.map((h) => (
                        <th
                          key={h}
                          className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${
                            expectedKeys.includes(h) ? "text-espresso" : "text-bark/40"
                          }`}
                        >
                          {h} {expectedKeys.includes(h) ? "✓" : "?"}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-parchment">
                    {parsedRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="hover:bg-parchment/10">
                        <td className="px-3 py-2 text-bark/60">{i + 1}</td>
                        {parsedHeaders.map((h) => (
                          <td key={h} className="px-3 py-2 text-espresso max-w-[150px] truncate">
                            {row[h] || "—"}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsedRows.length > 10 && (
                  <div className="px-3 py-2 text-[10px] text-bark/60 bg-parchment/10 border-t border-parchment">
                    ... and {parsedRows.length - 10} more rows
                  </div>
                )}
              </div>
            </div>
          )}

          {step === "result" && result && (
            <div className="space-y-4">
              {/* Success count */}
              {result.inserted > 0 && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                  <div className="text-[13px] font-bold text-green-700">
                    ✓ {result.inserted} row{result.inserted !== 1 ? "s" : ""} imported successfully
                  </div>
                </div>
              )}

              {/* Errors */}
              {result.errors.length > 0 && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                  <div className="text-[12px] font-semibold text-red-700 mb-2">
                    {result.errors.length} row{result.errors.length !== 1 ? "s" : ""} failed:
                  </div>
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {result.errors.map((err, i) => (
                      <div key={i} className="text-[11px] text-red-600">
                        {err.row > 0 ? `Row ${err.row}: ` : ""}{err.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.inserted === 0 && result.errors.length === 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-[12px] text-amber-700">
                  No rows were imported. Check your CSV file format.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-parchment px-6 py-3 flex justify-between items-center shrink-0">
          {step === "preview" && (
            <button
              onClick={() => { setStep("upload"); setParsedRows([]); setParsedHeaders([]); setFileName(""); }}
              className="text-[11px] text-terracotta hover:text-terracotta/70 font-medium cursor-pointer"
            >
              ← Back
            </button>
          )}
          {step !== "preview" && <div />}

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-sand px-4 py-2 text-[12px] font-medium text-bark hover:bg-parchment transition-colors cursor-pointer"
            >
              {step === "result" ? "Done" : "Cancel"}
            </button>
            {step === "preview" && (
              <button
                onClick={handleUpload}
                disabled={uploading || missingRequired.length > 0}
                className="rounded-lg bg-terracotta px-4 py-2 text-[12px] font-semibold text-white hover:bg-terracotta/80 transition-colors disabled:opacity-50 cursor-pointer"
              >
                {uploading ? "Importing..." : `Import ${parsedRows.length} Rows`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
