// Shared HTML rendering for the email approve/decline/propose landing pages.
// These routes return standalone pages (opened in a browser from an email), so
// each page is a full document styled with the MinuteFlow palette inline.

export function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );
}

export function htmlResponse(inner: string, status = 200): Response {
  const doc = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>MinuteFlow</title></head><body style="margin:0;background:#faf7f2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#3d3229;padding:20px">${inner}</body></html>`;
  return new Response(doc, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

export function card(inner: string): string {
  return `<div style="max-width:460px;margin:24px auto;background:#fffdf9;border:1px solid #e8dfd3;border-radius:16px;padding:24px">${inner}</div>`;
}

// A terminal result page (after the action ran, or an error).
export function resultPage(ok: boolean, title: string, message: string): Response {
  const color = ok ? "#6b8f71" : "#c2694f";
  return htmlResponse(
    card(
      `<h2 style="color:${color};margin:0 0 12px">${title}</h2><p style="line-height:1.55;margin:0">${message}</p><p style="color:#b5a898;font-size:12px;margin:20px 0 0">You can close this page. — MinuteFlow</p>`
    )
  );
}

// A summary block describing the request being acted on.
export function summaryBlock(inner: string): string {
  return `<div style="background:#f3ede4;padding:12px 14px;border-radius:10px;line-height:1.5;margin:0 0 16px">${inner}</div>`;
}

export function primaryButton(label: string, color: string): string {
  return `<button type="submit" style="width:100%;background:${color};color:#fff;border:none;padding:14px;border-radius:10px;font-size:16px;font-weight:600;cursor:pointer">${label}</button>`;
}

export function textareaField(name: string, label: string, placeholder: string): string {
  return `<label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px">${label}</label><textarea name="${name}" rows="3" placeholder="${placeholder}" style="width:100%;box-sizing:border-box;border:1px solid #e8dfd3;border-radius:10px;padding:10px;font-size:15px;margin:0 0 14px;font-family:inherit"></textarea>`;
}

export function timeField(name: string, label: string): string {
  return `<div style="flex:1"><label style="display:block;font-size:13px;font-weight:600;margin:0 0 6px">${label}</label><input type="time" name="${name}" style="width:100%;box-sizing:border-box;border:1px solid #e8dfd3;border-radius:10px;padding:10px;font-size:15px;font-family:inherit"></div>`;
}
