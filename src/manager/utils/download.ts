import { safeFilename } from "./helpers";
import type { Session } from "../context/types";

// Firefox for Android has no windows API. Its downloads API also flatly rejects
// blob:/data: URLs ("Access denied") and has no saveAs support — confirmed by testing —
// so the only thing that actually works there is a direct <a download> click, which
// saves straight to the Downloads folder (Android has no per-download picker to show).
const ANDROID_MODE = typeof browser.windows === "undefined";

function toBase64Utf8(str: string): string {
  return btoa(unescape(encodeURIComponent(str)));
}

function clickDownload(url: string, filename: string, revoke: () => void): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(revoke, 60_000);
}

// Tries Android's native share sheet (Files, Drive, email, etc. — the closest thing
// to a "choose where to save" picker reachable from a WebExtension page there).
// Returns true if handled (shared, or the user cancelled the sheet), false if the
// API isn't usable here and the caller should fall back to a direct download.
async function tryShareFile(filename: string, content: string, mimeType: string): Promise<boolean> {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    const file = new File([content], filename, { type: mimeType });
    if (!navigator.canShare({ files: [file] })) return false;
    await navigator.share({ files: [file] });
    return true;
  } catch (err) {
    // AbortError means the user dismissed the share sheet themselves — respect that
    // instead of silently forcing a download behind their back.
    return err instanceof Error && err.name === "AbortError";
  }
}

export async function downloadFileSaveAs(filename: string, content: string, mimeType: string): Promise<void> {
  if (ANDROID_MODE) {
    if (await tryShareFile(filename, content, mimeType)) return;
    const url = `data:${mimeType};base64,${toBase64Utf8(content)}`;
    clickDownload(url, filename, () => {});
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    // Try the downloads API first (shows a Save As dialog)
    await browser.downloads.download({ url, filename, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    // Only fall back to <a> click if the API itself is unavailable (not when user cancels)
    const msg = err instanceof Error ? err.message : String(err);
    const isCancelled = /cancel/i.test(msg) || /user/i.test(msg);
    if (isCancelled) { URL.revokeObjectURL(url); return; }
    clickDownload(url, filename, () => URL.revokeObjectURL(url));
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
