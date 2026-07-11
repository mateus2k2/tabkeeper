import { safeFilename } from "./helpers";
import type { Session } from "../context/types";

// Firefox for Android has no windows API, and its downloads API doesn't support
// saveAs (the call rejects) — the <a download> blob fallback is also a no-op on
// GeckoView, so Android must go straight to the Downloads folder instead.
const ANDROID_MODE = typeof browser.windows === "undefined";

export async function downloadFileSaveAs(filename: string, content: string, mimeType: string): Promise<void> {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    // Try the downloads API first (shows a Save As dialog on desktop; saves
    // directly to the Downloads folder on Android, where saveAs isn't supported)
    await browser.downloads.download(ANDROID_MODE ? { url, filename } : { url, filename, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    // Only fall back to <a> click if the API itself is unavailable (not when user cancels)
    const msg = err instanceof Error ? err.message : String(err);
    const isCancelled = /cancel/i.test(msg) || /user/i.test(msg);
    if (isCancelled) { URL.revokeObjectURL(url); return; }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

function dateTimeStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

export function exportSessionAsJson(session: Session): void {
  const json = JSON.stringify([session], null, 2);
  void downloadFileSaveAs(`${safeFilename(session.name)}_${dateTimeStamp()}.json`, json, "application/json");
}

export function exportSessionAsText(session: Session): void {
  const lines: string[] = [session.name];
  const multiWin = session.windows.length > 1;

  for (let wi = 0; wi < session.windows.length; wi++) {
    const win = session.windows[wi];
    const winLabel = win.name || (multiWin ? `Window ${wi + 1}` : null);
    if (winLabel) lines.push(`  ${winLabel}${win.incognito ? " [Private]" : ""}`);

    const sorted = [...win.tabs].sort((a, b) => a.index - b.index);
    let lastGroupId: number | null = null;

    for (const tab of sorted) {
      const gid = tab.groupId ?? -1;

      if (gid !== -1 && gid !== lastGroupId) {
        const title = tab.groupTitle?.trim() || "Group";
        lines.push(`    [${title}]`);
      }
      lastGroupId = gid !== -1 ? gid : null;

      // Escape " | " in titles so it doesn't break the parser's separator
      const title = (tab.title || tab.url || "").replace(/ \| /g, " - ");
      const pin = tab.pinned ? "📌 " : "";
      const entry = `${pin}${title} | ${tab.url}`;
      lines.push(gid !== -1 ? `      ${entry}` : `    ${entry}`);
    }
  }

  void downloadFileSaveAs(`${safeFilename(session.name)}_${dateTimeStamp()}.txt`, lines.join("\n"), "text/plain");
}

export async function exportBackup(data: Record<string, unknown>): Promise<void> {
  const json = JSON.stringify({ ...data, version: 1, exportedAt: Date.now() }, null, 2);
  await downloadFileSaveAs(`tabkeeper-backup_${dateTimeStamp()}.json`, json, "application/json");
}
