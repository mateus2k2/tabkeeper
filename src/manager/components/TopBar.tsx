import { useApp } from "../context/AppContext";
import { useUndo } from "../hooks/useUndo";

interface Props {
  onToggleSidebar: () => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
}

export function TopBar({ onToggleSidebar, onOpenSettings, onOpenSync }: Props) {
  const { state, dispatch } = useApp();
  const { undo, redo, canUndo, canRedo } = useUndo();

  return (
    <header className="topbar">
      <button className="icon-btn sidebar-toggle-btn" title="Toggle sidebar" onClick={onToggleSidebar}>
        <svg viewBox="0 0 20 20" fill="none">
          <rect x="2" y="4" width="16" height="2" rx="1" fill="#fff"/>
          <rect x="2" y="9" width="16" height="2" rx="1" fill="#fff"/>
          <rect x="2" y="14" width="16" height="2" rx="1" fill="#fff"/>
        </svg>
      </button>

      <a
        className="topbar-logo"
        href="https://github.com/mateus2k2/tabkeeper/"
        target="_blank"
        rel="noopener noreferrer"
        title="TabKeeper on GitHub"
      >
        <svg className="logo-icon" viewBox="0 0 32 32" fill="none">
          <rect width="32" height="32" rx="6" fill="#1a73e8"/>
          <text x="16" y="23" fontFamily="Arial,sans-serif" fontSize="20" fontWeight="bold" fill="white" textAnchor="middle">S</text>
        </svg>
      </a>

      <div className="topbar-search">
        <svg className="search-icon" viewBox="0 0 20 20" fill="none">
          <circle cx="8.5" cy="8.5" r="5.5" stroke="#aaa" strokeWidth="1.8"/>
          <line x1="12.5" y1="12.5" x2="17" y2="17" stroke="#aaa" strokeWidth="1.8" strokeLinecap="round"/>
        </svg>
        <input
          id="search-input"
          type="text"
          placeholder="Search tabs and collections"
          autoComplete="off"
          value={state.searchQuery}
          onChange={e => dispatch({ type: "SET_SEARCH", query: e.target.value })}
        />
      </div>

      <div className="topbar-actions">
        <button className="icon-btn" title="Redo" disabled={!canRedo} onClick={() => void redo()}>
          <svg viewBox="0 0 24 24" fill="none">
            <g transform="scale(-1,1) translate(-24,0)">
              <path d="M20 7H9C7.13 7 6.2 7 5.5 7.4C5.04 7.67 4.67 8.04 4.4 8.5C4 9.2 4 10.13 4 12C4 13.87 4 14.8 4.4 15.5C4.67 15.96 5.04 16.33 5.5 16.6C6.2 17 7.13 17 9 17H16M20 7L17 4M20 7L17 10" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </g>
          </svg>
        </button>
        <button className="icon-btn" title="Undo" disabled={!canUndo} onClick={() => void undo()}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M20 7H9C7.13 7 6.2 7 5.5 7.4C5.04 7.67 4.67 8.04 4.4 8.5C4 9.2 4 10.13 4 12C4 13.87 4 14.8 4.4 15.5C4.67 15.96 5.04 16.33 5.5 16.6C6.2 17 7.13 17 9 17H16M20 7L17 4M20 7L17 10" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="icon-btn" title="Cloud Sync (Google Drive)" onClick={onOpenSync}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6.28571 19C3.91878 19 2 17.1038 2 14.7647C2 12.4256 3.91878 10.5294 6.28571 10.5294C6.56983 10.5294 6.8475 10.5567 7.11616 10.6089M14.381 8.02721C14.9767 7.81911 15.6178 7.70588 16.2857 7.70588C16.9404 7.70588 17.5693 7.81468 18.1551 8.01498M7.11616 10.6089C6.88706 9.9978 6.7619 9.33687 6.7619 8.64706C6.7619 5.52827 9.32028 3 12.4762 3C15.4159 3 17.8371 5.19371 18.1551 8.01498M7.11616 10.6089C7.68059 10.7184 8.20528 10.9374 8.66667 11.2426M18.1551 8.01498C20.393 8.78024 22 10.8811 22 13.3529C22 16.0599 20.0726 18.3221 17.5 18.8722" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M12 16V22M12 16L14 18M12 16L10 18" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M10.4 5.6C10.4 4.85 10.4 4.47 10.63 4.23C10.87 4 11.25 4 12 4C12.75 4 13.13 4 13.37 4.23C13.6 4.47 13.6 4.85 13.6 5.6V6.63C13.97 6.74 14.33 6.89 14.66 7.07L15.39 6.34C15.93 5.81 16.19 5.54 16.53 5.54C16.86 5.54 17.12 5.81 17.66 6.34C18.19 6.88 18.46 7.14 18.46 7.47C18.46 7.81 18.19 8.07 17.66 8.61L16.93 9.34C17.11 9.67 17.26 10.03 17.37 10.4H18.4C19.15 10.4 19.53 10.4 19.77 10.63C20 10.87 20 11.25 20 12C20 12.75 20 13.13 19.77 13.37C19.53 13.6 19.15 13.6 18.4 13.6H17.37C17.26 13.97 17.11 14.33 16.93 14.66L17.66 15.39C18.19 15.93 18.46 16.19 18.46 16.53C18.46 16.86 18.19 17.12 17.66 17.66C17.12 18.19 16.86 18.46 16.53 18.46C16.19 18.46 15.93 18.19 15.39 17.66L14.66 16.93C14.33 17.11 13.97 17.26 13.6 17.37V18.4C13.6 19.15 13.6 19.53 13.37 19.77C13.13 20 12.75 20 12 20C11.25 20 10.87 20 10.63 19.77C10.4 19.53 10.4 19.15 10.4 18.4V17.37C10.03 17.26 9.67 17.11 9.34 16.93L8.61 17.66C8.07 18.19 7.81 18.46 7.47 18.46C7.14 18.46 6.88 18.19 6.34 17.66C5.81 17.12 5.54 16.86 5.54 16.53C5.54 16.19 5.81 15.93 6.34 15.39L7.07 14.66C6.89 14.33 6.74 13.97 6.63 13.6H5.6C4.85 13.6 4.47 13.6 4.23 13.37C4 13.13 4 12.75 4 12C4 11.25 4 10.87 4.23 10.63C4.47 10.4 4.85 10.4 5.6 10.4H6.63C6.74 10.03 6.89 9.67 7.07 9.34L6.34 8.61C5.81 8.07 5.54 7.81 5.54 7.47C5.54 7.14 5.81 6.88 6.34 6.34C6.88 5.81 7.14 5.54 7.47 5.54C7.81 5.54 8.07 5.81 8.61 6.34L9.34 7.07C9.67 6.89 10.03 6.74 10.4 6.63V5.6Z" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M14.4 12C14.4 13.33 13.33 14.4 12 14.4C10.67 14.4 9.6 13.33 9.6 12C9.6 10.67 10.67 9.6 12 9.6C13.33 9.6 14.4 10.67 14.4 12Z" stroke="#ccc" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>
    </header>
  );
}
