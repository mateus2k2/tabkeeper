# TabKeeper — Firefox Extension

TabKeeper is a Firefox tab and session manager **heavily inspired by [Session Buddy](https://sessionbuddy.com/)**, a popular Chrome extension. It is an **independent, unofficial project** — not affiliated with, endorsed by, or a port of Session Buddy or its authors.

It brings similar session management ideas to Firefox, with additional features like private window cookie management, session history, drag-and-drop organization, and full keyboard navigation.

## Features

### Sessions (Collections)
- Save all open windows and tabs as a named collection
- Save only the current window
- Restore a collection in a new window or replace the current window
- Rename, duplicate, and delete collections (F2 / Delete keyboard shortcuts)
- Replace a collection with the current browser state
- Tab groups are saved and restored with their original colors and titles
- Drag and drop tabs and windows within a collection to reorganize
- Drag collections together in the sidebar to merge them

### Tab Selection
- Click any tab row to select it; Shift-click or Shift-Arrow to range-select
- Arrow Up / Down to navigate; Space / Enter to toggle selection
- Select tabs across multiple windows, then:
  - Save them as a new collection
  - Extract them to a new window within the collection
  - Copy their URLs to the clipboard
  - Remove them from the session

### History
- Automatically saves a snapshot when the browser closes
- Auto-saves every 5 minutes
- Timeline grouped by date — click any entry to browse its tabs
- Save any history entry as a permanent collection
- Open a history entry in a new window
- Delete individual entries or clear all history
- Keeps the last 50 entries

### Export / Import
- Export a collection as JSON (full fidelity, re-importable)
- Export as indented plain text (human-readable)
- Import JSON or text files; both formats support multiple sessions per file
- Save dialog shown for both formats

### Private Window Cookie Manager
- Save all cookies from private windows to a JSON file
- Optionally include the URLs of open private tabs in the export
- Restore cookies and tabs into an already-open private window
- Clear all private cookies, or clear by domain
- Browse current private cookies grouped by domain

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| F2 | Rename current collection |
| Delete | Delete current collection / remove selected tabs |
| Escape | Close modal / clear selection |
| ↑ / ↓ | Navigate tab list |
| Shift + ↑ / ↓ | Extend tab selection |
| Space / Enter | Toggle selection on focused tab |
| ← / → (in modal) | Move focus between buttons |
| Enter (in modal input) | Confirm action |

## Installation (Developer Mode)

1. Open `about:debugging#/runtime/this-firefox` in Firefox
2. Click **Load Temporary Add-on…**
3. Select `manifest.json` from this folder

For private window cookie support, go to `about:addons` → TabKeeper → **Allow in private windows**.

### Local file tab support (`file://` URLs)

Firefox restricts extensions from opening `file://` URLs by default. To enable it, add the following to your Firefox profile's `user.js` file (create it if it doesn't exist, next to `prefs.js` in your [profile folder](https://support.mozilla.org/en-US/kb/profiles-where-firefox-stores-user-data)):

```js
user_pref("capability.policy.policynames", "localfilelinks");
user_pref("capability.policy.localfilelinks.sites", "moz-extension://YOUR-EXTENSION-UUID");
user_pref("capability.policy.localfilelinks.checkloaduri.enabled", "allAccess");
```

Replace `YOUR-EXTENSION-UUID` with the internal UUID shown at `about:debugging#/runtime/this-firefox` next to TabKeeper (it looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`, not the `@` ID from the manifest). Restart Firefox after saving `user.js`.

Without this setting, sessions containing `file://` tabs will open a placeholder page instead — you can still open them manually from there.

## Requirements

- Firefox 109 or later
- Firefox 136+ required for tab group support
- No build step — plain HTML, CSS, and vanilla JS

## File Structure

```
session-buddy/
├── manifest.json           Extension manifest (MV3)
├── background.js           Background page — IndexedDB, session capture, history
├── icons/
│   ├── icon-16.svg
│   ├── icon-48.svg
│   └── icon-128.svg
├── placeholder/
│   ├── index.html          Shown when a tab URL can't be restored directly
│   └── placeholder.js
└── manager/
    ├── manager.html        Main UI page
    ├── manager.css         Dark theme styles
    ├── manager.js          UI logic — views, selection, import/export
    └── drag-drop.js        Drag-and-drop for tabs, windows, and collections
```

## Permissions

| Permission | Reason |
|------------|--------|
| `tabs` | Read tab URLs, titles, and group IDs |
| `tabGroups` | Read and restore tab group colors and titles |
| `storage` / `unlimitedStorage` | Persist sessions and history in IndexedDB |
| `downloads` | Show save-as dialog when exporting files |
| `alarms` | Periodic history auto-save every 5 minutes |
| `cookies` | Read and write private window cookies |
| `<all_urls>` | Required to access cookies for any domain |

## Inspiration

TabKeeper takes its core concept from [Session Buddy](https://sessionbuddy.com/) by Shreeram Srinivasan — an excellent Chrome extension for session management. TabKeeper is an independent Firefox implementation and is **not** affiliated with or endorsed by the Session Buddy project in any way.
