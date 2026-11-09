import type { FC } from "hono/jsx";

type P = { size?: number };

const Svg: FC<P & { sw?: number; children?: any }> = ({ size = 20, sw = 2, children }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width={sw}
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

export const Logo: FC<{ width?: number }> = ({ width = 34 }) => (
  <svg class="logo" width={width} height={(width * 22) / 34} viewBox="0 0 34 22" aria-hidden="true">
    <circle class="logo-a" cx="11" cy="11" r="10" />
    <circle class="logo-b" cx="23" cy="11" r="10" />
  </svg>
);

export const SunIcon: FC<P> = (p) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Svg>
);

export const MoonIcon: FC<P> = (p) => (
  <Svg {...p}>
    <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
  </Svg>
);

export const ArrowRight: FC<P> = (p) => (
  <Svg {...p} sw={2.2}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

export const ChevronLeft: FC<P> = (p) => (
  <Svg {...p} sw={2.2}>
    <path d="M15 6l-6 6 6 6" />
  </Svg>
);

export const ChevronRight: FC<P> = (p) => (
  <Svg {...p} sw={2.2}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export const PlusIcon: FC<P> = (p) => (
  <Svg {...p} sw={2.6}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const CheckIcon: FC<P> = (p) => (
  <Svg {...p} sw={3.4}>
    <path class="check-path" d="M5 12.5l4.5 4.5L19 7.5" />
  </Svg>
);

export const LockIcon: FC<P> = (p) => (
  <Svg {...p} sw={2.2}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 018 0v3" />
  </Svg>
);

export const KeyIcon: FC<P> = (p) => (
  <Svg {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M10.8 12.2L20 3M16 7l3 3M18 5l2 2" />
  </Svg>
);

export const LogoutIcon: FC<P> = (p) => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
  </Svg>
);

export const TrashIcon: FC<P> = (p) => (
  <Svg {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" />
  </Svg>
);

export const XIcon: FC<P> = (p) => (
  <Svg {...p} sw={2.2}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
