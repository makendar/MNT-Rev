import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: P, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const Icon = {
  Logo: (p: P) => base({ size: 20, ...p }, <path d="M5 18V6l7 7 7-7v12" stroke="#e9b44c" strokeWidth={2.6} />),
  Home: (p: P) => base(p, <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>),
  Spark: (p: P) => base(p, <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></>),
  Board: (p: P) => base(p, <><rect x="3" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="11" rx="1.5" /><rect x="17" y="4" width="4" height="7" rx="1.5" /></>),
  Check: (p: P) => base(p, <path d="M5 12.5l4.5 4.5L19 7.5" />),
  CheckSquare: (p: P) => base(p, <><rect x="3.5" y="3.5" width="17" height="17" rx="3" /><path d="M8 12l3 3 5-6" /></>),
  Building: (p: P) => base(p, <><rect x="4" y="3" width="11" height="18" rx="1" /><path d="M15 9h5v12h-5M8 7h3M8 11h3M8 15h3" /></>),
  Chart: (p: P) => base(p, <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  Target: (p: P) => base(p, <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>),
  Upload: (p: P) => base(p, <><path d="M12 16V4M7 9l5-5 5 5M4 16v4h16v-4" /></>),
  Download: (p: P) => base(p, <><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></>),
  Settings: (p: P) => base(p, <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
  Search: (p: P) => base(p, <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>),
  Plus: (p: P) => base(p, <path d="M12 5v14M5 12h14" />),
  X: (p: P) => base(p, <path d="M6 6l12 12M18 6L6 18" />),
  Phone: (p: P) => base(p, <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2" />),
  Mail: (p: P) => base(p, <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>),
  Users: (p: P) => base(p, <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0M16 4.5a3.5 3.5 0 010 7M18 14a6 6 0 013.5 6" /></>),
  Monitor: (p: P) => base(p, <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>),
  Note: (p: P) => base(p, <><path d="M5 3h10l4 4v14H5z" /><path d="M9 12h6M9 16h4" /></>),
  Alert: (p: P) => base(p, <><path d="M12 3l9.5 17h-19z" /><path d="M12 10v4M12 17.5v.01" /></>),
  Arrow: (p: P) => base(p, <path d="M5 12h14M13 6l6 6-6 6" />),
  Clock: (p: P) => base(p, <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  Menu: (p: P) => base(p, <path d="M4 7h16M4 12h16M4 17h16" />),
  Logout: (p: P) => base(p, <><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" /></>),
  Copy: (p: P) => base(p, <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3" /></>),
  Trash: (p: P) => base(p, <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />),
  Edit: (p: P) => base(p, <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />),
};
