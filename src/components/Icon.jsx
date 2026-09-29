/**
 * One consistent line-icon set (24×24, 1.75 stroke). Icons are decorative (hidden from screen
 * readers) unless given a `label`; controls that show only an icon carry their own aria-label.
 */
const PATHS = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  library: (
    <>
      <rect x="3" y="4" width="4" height="16" rx="1" />
      <rect x="9" y="4" width="4" height="16" rx="1" />
      <path d="m15.5 5.2 3.9-1 2.4 15.1-3.9 1z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />,
  play: <path d="M7 4.5v15a1 1 0 0 0 1.5.9l12-7.5a1 1 0 0 0 0-1.8l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none" />,
  bookmark: <path d="M18 21 12 17 6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5z" />,
  bookmarkFilled: <path d="M18 21 12 17 6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5z" fill="currentColor" />,
  share: (
    <>
      <path d="M12 3v12" />
      <path d="m7 8 5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevronLeft: <path d="m15 5-7 7 7 7" />,
  chevronRight: <path d="m9 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  arrowLeft: <path d="M19 12H5m6-6-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  trash: (
    <>
      <path d="M4 7h16M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
      <circle cx="16" cy="6" r="2" />
      <circle cx="10" cy="12" r="2" />
      <circle cx="18" cy="18" r="2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-2.3 5.7" />
      <path d="M20 4v7h-7" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-5.1A8 8 0 1 1 21 12z" />,
  thumbUp: <path d="M7 11v9H4v-9zm0 0 4-8a2.5 2.5 0 0 1 2.5 2.5V9h5.2a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.5 20H7" />,
};

export default function Icon({ name, size = 20, className, label }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

/** The platforms' marks, simplified, in their brand colors (set in CSS). */
export function SourceMark({ source, size = 16 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' };
  if (source === 'youtube')
    return (
      <svg {...common}>
        <rect x="1.5" y="5" width="21" height="14" rx="4" fill="var(--youtube)" />
        <path d="M10 9v6l5.2-3z" fill="#fff" />
      </svg>
    );
  if (source === 'twitch')
    return (
      <svg {...common}>
        <path d="M4.5 2 3 5.8V20h4.8v2.5h2.7l2.5-2.5h3.8L21 15V2zm14.6 12-2.9 2.9h-4.6l-2.5 2.5v-2.5H5.3V3.8h13.8z" fill="var(--twitch)" />
        <path d="M15.5 7.2h1.8v5.1h-1.8zm-4.9 0h1.8v5.1h-1.8z" fill="var(--twitch)" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="2" y="2" width="20" height="20" rx="5" fill="var(--dailymotion)" />
      <path d="M14.6 6.5h2v11h-1.9v-.8a3.9 3.9 0 0 1-2.7 1c-2.3 0-4-1.8-4-4.2s1.7-4.2 4-4.2c1 0 1.9.3 2.6.9zm-2.3 5.4c-1.3 0-2.2.9-2.2 2s.9 2.1 2.2 2.1 2.2-.9 2.2-2.1-.9-2-2.2-2z" fill="#fff" />
    </svg>
  );
}

/** The FundaStream mark: a play shape in a rounded hexagon. */
export function LogoMark({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="fs-logo" x1="4" y1="2" x2="28" y2="30" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <path d="M16 1.8a3 3 0 0 1 1.5.4l10.3 5.9a3 3 0 0 1 1.5 2.6v11.8a3 3 0 0 1-1.5 2.6L17.5 29.9a3 3 0 0 1-3 0L4.2 24a3 3 0 0 1-1.5-2.6V10.6A3 3 0 0 1 4.2 8L14.5 2.1a3 3 0 0 1 1.5-.3z" fill="url(#fs-logo)" />
      <path d="M13 11.2v9.6a.8.8 0 0 0 1.2.7l7.6-4.8a.8.8 0 0 0 0-1.4l-7.6-4.8a.8.8 0 0 0-1.2.7z" fill="#fff" />
    </svg>
  );
}
