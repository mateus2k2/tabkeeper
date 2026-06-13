# Session Buddy — Firefox Extension

A Firefox port of the Chrome Session Buddy extension. Save, restore, and organize your browser sessions, with support for tab groups, session history, and private window cookie management.

## Features

### Sessions (Collections)
- Save all open windows and tabs as a named collection
- Save only the current window
- Restore a collection in a new window or replace the current window
- Rename and delete collections (F2 / Delete keyboard shortcuts)
- Tab groups are saved and restored with their original colors and titles

### Tab Selection
- Click any tab row to select it; Shift-click or Shift-Arrow to range-select
- Arrow Up / Down to navigate the list; Space / Enter to toggle selection
- Select tabs across multiple windows, then save them as a new collection or copy their URLs
- Remove individual tabs or entire windows from a saved collection

### History
- Automatically saves a snapshot when the browser closes ("Browser closed")
- Auto-saves every 30 minutes ("Auto-save")
- Timeline grouped by date — click any entry to browse its tabs
- Save any history entry as a permanent collection
- Open a history entry in a new or existing window
- Right-click an entry to delete it; clear all history at once
- Keeps the last 50 entries

### Export / Import
- Export a collection as JSON (full fidelity, re-importable)
- Export a collection as indented plain text (human-readable)
  - Format: `Session Name → Window → [Group] → Tab`
  - Separator `---` between sessions in a single text file
- Import JSON or text files; both formats support multiple sessions per file
- Save dialog is shown for both formats (no silent downloads)

### Private Window Cookie Manager
- Save all cookies from private windows to a JSON file
- Optionally include the URLs of open private tabs in the export
- Restore cookies and tabs into an already-open private window
- Clear all private cookies, or clear by domain
- Browse current private cookies grouped by domain (collapsible)
- Import / Clear require a private window to be open

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| F2 | Rename current collection |
| Delete | Delete current collection / remove selected tabs |
| Escape | Close any open modal |
| ↑ / ↓ | Navigate tab list |
| Shift + ↑ / ↓ | Extend tab selection |
| Space / Enter | Toggle selection on focused tab |
| ← / → (in modal) | Move focus between buttons |
| Enter (in modal input) | Confirm action |

## Installation (Developer Mode)

1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` from this folder

For private window cookie support, go to `about:addons` → Session Buddy → **Allow in private windows**.

## Requirements

- Firefox 136 or later (for tab group support: Firefox 136+)
- No build step — plain HTML, CSS, and vanilla JS

## File Structure

```
session-buddy/
├── manifest.json          Extension manifest (MV3)
├── background.js          Background service worker — IndexedDB, session capture, history auto-save
├── icons/
│   ├── icon-16.svg
│   ├── icon-48.svg
│   └── icon-128.svg
└── manager/
    ├── manager.html       Main UI page
    ├── manager.css        Dark theme styles
    └── manager.js         UI logic — views, selection, import/export
```

## Permissions

| Permission | Reason |
|------------|--------|
| `tabs` | Read tab URLs, titles, and group IDs |
| `tabGroups` | Read and restore tab group colors and titles |
| `storage` / `unlimitedStorage` | Persist sessions and history in IndexedDB |
| `downloads` | Show save-as dialog when exporting files |
| `alarms` | Periodic history auto-save every 30 minutes |
| `cookies` | Read and write private window cookies |
| `<all_urls>` | Required to access cookies for any domain |
