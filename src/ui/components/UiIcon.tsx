import type { ReactNode } from 'react';

export type IconName = 'logbook' | 'fuel' | 'warning' | 'star' | 'map' | 'wrench' | 'tree' | 'paint' | 'settings' | 'flight' | 'back' | 'cash' | 'research' | 'salvage' | 'chevron' | 'lock' | 'check' | 'target' | 'retry' | 'pause' | 'home';

const paths: Record<IconName, ReactNode> = {
  map: <><path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Z"/><path d="M9 3v15M15 6v15"/></>,
  wrench: <><path d="M14.8 6.1a5 5 0 0 0-6.1 6.2L3.5 17.5a2.1 2.1 0 0 0 3 3l5.2-5.2a5 5 0 0 0 6.2-6.1l-3.1 3.1-2.7-.7-.7-2.7 3.4-2.8Z"/></>,
  tree: <><path d="M12 21V3M12 7h6M12 12H6M12 17h6"/><circle cx="18" cy="7" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="17" r="2.5"/></>,
  paint: <><path d="M12 3a9 9 0 1 0 0 18h1.1c1.2 0 1.9-1.3 1.2-2.3-.5-.7 0-1.7.9-1.7h1.1A4.7 4.7 0 0 0 21 12c0-5-4-9-9-9Z"/><circle cx="7.5" cy="11" r="1" fill="currentColor"/><circle cx="10" cy="7.5" r="1" fill="currentColor"/><circle cx="15" cy="8" r="1" fill="currentColor"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.4 2.4-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.4v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-2.4-2.4.1-.1A1.7 1.7 0 0 0 6 15a1.7 1.7 0 0 0-1.5-1H4.3v-3.4h.2A1.7 1.7 0 0 0 6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1L8 4.6l.1.1A1.7 1.7 0 0 0 10 5a1.7 1.7 0 0 0 1-1.5v-.2h3.4v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.5 1h.2v3.4h-.2a1.7 1.7 0 0 0-1.5 1.6Z"/></>,
  flight: <path d="m3 13 7.5-2.2L13 3l1.8.5-.8 7.2 5.7 1.2 1.9-1.8 1.1.4-1.1 3.2 1.1 3.2-1.1.4-1.9-1.8-5.7 1.2.8 7.2-1.8.5-2.5-7.8L3 15v-2Z"/>,
  back: <path d="m14 5-7 7 7 7M7 12h12"/>,
  cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M16 12h.01M6 9h.01M6 15h.01"/><circle cx="12" cy="12" r="2.5"/></>,
  research: <><path d="M9 3h6M10 3v6l-5.5 9A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-3l-5.5-9V3"/><path d="M8 15h8"/></>,
  salvage: <><path d="M4 7h16M6 7l1 14h10l1-14M9 7V4h6v3"/><path d="m9 12 6 5M15 12l-6 5"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></>,
  check: <path d="m4 12 5 5L20 6"/>,
  target: <><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></>,
  retry: <><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v5h5"/></>,
  pause: <path d="M8 5v14M16 5v14"/>,
  logbook: <><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 17a3 3 0 0 1 3-3h11M9 8h6"/></>,
  fuel: <><path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M4 10h10"/><path d="M14 8h2a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/></>,
  warning: <><path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/></>,
  star: <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3Z"/>,
  home: <path d="m3 11 9-8 9 8M5 10v10h14V10"/>,
};

export function UiIcon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return <svg className="ui-icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden={label ? undefined : true} aria-label={label}>{paths[name]}</svg>;
}
