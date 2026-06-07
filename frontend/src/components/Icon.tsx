import React from 'react';

const ICON_PATHS: Record<string, string> = {
  dashboard: '<rect x="3.5" y="3.5" width="7" height="9" rx="1.5"/><rect x="3.5" y="15.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.5"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.5"/>',
  pipeline: '<path d="M4 5h4v14H4zM10 5h4v9h-4zM16 5h4v6h-4z"/>',
  bolt: '<path d="M13 2 5 13h6l-1 9 8-11h-6z"/>',
  users: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5"/><path d="M16 5.2a3.2 3.2 0 0 1 0 6.1M20.5 20c0-2.4-1.4-4.2-3.5-4.8"/>',
  dollar: '<path d="M12 2.5v19M16.5 6.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3.2c0 4.6 9 2.2 9 6.8 0 1.9-2 3.2-4.5 3.2s-4.5-1.3-4.5-3"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-3.6-3.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  bell: '<path d="M18 9a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 15 18 9zM10 20a2 2 0 0 0 4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  clip: '<path d="M20 11.5L11.5 20a5 5 0 0 1-7-7l9-9a3.3 3.3 0 0 1 4.7 4.7l-9 9a1.7 1.7 0 0 1-2.4-2.4l8-8"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  building: '<path d="M5 21V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v17M15 9h3a1 1 0 0 1 1 1v11M8 7h2M8 11h2M8 15h2"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-10.5a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z"/><circle cx="12" cy="10.5" r="2.3"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  checkc: '<circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3 4.7-5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
  trend: '<path d="M3 17l6-6 4 4 8-8M21 7v5M21 7h-5"/>',
  doc: '<path d="M6 2h8l4 4v16H6zM14 2v4h4"/><path d="M9 13h6M9 17h6"/>',
  flame: '<path d="M12 3c2 3.5 5 5 5 9a5 5 0 0 1-10 0c0-1.5.6-2.7 1.4-3.6C9 10 10 11 10 12c0-2 .8-3.5 2-5z"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a3.5 3.5 0 0 1 .5 6.96"/><path d="M7 18h10"/>',
  cloudup: '<path d="M7 17.5a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a3.5 3.5 0 0 1 .5 6.96"/><path d="M12 21v-7M9 16.5l3-3 3 3"/>',
  sync: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 4v4h-4M21 12a9 9 0 0 1-15 6.7L3 16M3 20v-4h4"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  file: '<path d="M6 2h8l4 4v16H6zM14 2v4h4"/>',
  edit: '<path d="M4 20h4l11-11a2 2 0 0 0-3-3L5 17z"/>',
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.9 19.9 0 0 1 3.1 4.2 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L9 9.9a16 16 0 0 0 6.1 6.1l1.3-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.5 2.9.7a2 2 0 0 1 1.6 2z"/>',
  'chevron-down': '<path d="M6 9l6 6 6-6"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
};

interface IconProps {
  name: string;
  size?: number;
  stroke?: number;
  style?: React.CSSProperties;
}

export default function Icon({ name, size = 20, stroke = 1.7, style }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
      dangerouslySetInnerHTML={{ __html: ICON_PATHS[name] || '' }}
    />
  );
}
