import { createContext, useContext, type FC, type PropsWithChildren } from "hono/jsx";
import { MoonIcon, SunIcon } from "./icons";

/** htmx hardened for a strict CSP: no eval, no inline styles, no script execution, no history snapshots. */
export const HTMX_CONFIG = JSON.stringify({
  allowEval: false,
  allowScriptTags: false,
  includeIndicatorStyles: false,
  historyCacheSize: 0,
  refreshOnHistoryMiss: true,
  selfRequestsOnly: true,
  scrollIntoViewOnBoost: false,
  globalViewTransitions: true,
  defaultSwapStyle: "innerHTML",
  // No "style": settling would strip the display:none Alpine's x-show sets on swapped-in elements
  // with a stable id (e.g. #acct-menu), showing them while Alpine thinks they are hidden.
  // Markup never carries inline styles (CSP), so only Alpine writes them.
  attributesToSettle: ["class", "width", "height"],
});

/** Absolute origin (scheme + host) the page is served on, for social-share meta tags. Set by `render`. */
export const PublicOrigin = createContext("");

const DESCRIPTION = "Shared to-do lists for two.";

/** Open Graph / Twitter card tags; crawlers need an absolute image URL. */
const ShareMeta: FC = () => {
  const image = `${useContext(PublicOrigin)}/static/og.png`;
  return (
    <>
      <meta name="description" content={DESCRIPTION} />
      <meta property="og:type" content="website" />
      <meta property="og:site_name" content="Tandem" />
      <meta property="og:title" content="Tandem" />
      <meta property="og:description" content={DESCRIPTION} />
      <meta property="og:image" content={image} />
      <meta property="og:image:type" content="image/png" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:alt" content="Tandem: a shared grocery list with tasks assigned to two people" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:image" content={image} />
    </>
  );
};

export const Layout: FC<PropsWithChildren<{ title: string; theme: "dark" | "light"; page: string }>> = ({
  title,
  theme,
  page,
  children,
}) => (
  <html lang="en" class={`tdm-${theme}`} data-page={page}>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <meta name="color-scheme" content={theme} />
      <meta name="htmx-config" content={HTMX_CONFIG} />
      <title>{title}</title>
      <meta name="theme-color" content={theme === "dark" ? "#0E0F13" : "#F5F5F0"} />
      <meta name="mobile-web-app-capable" content="yes" />
      <meta name="apple-mobile-web-app-title" content="Tandem" />
      <ShareMeta />
      <link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48" />
      <link rel="icon" href="/static/icons/icon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/static/icons/apple-touch-icon.png" />
      <link rel="manifest" href="/static/manifest.webmanifest" />
      <link rel="stylesheet" href="/static/css/app.css" />
      {/* Render-blocking on purpose: it must be listening before the first frame to catch `pagereveal`. */}
      <script src="/static/js/nav.js"></script>
      <script defer src="/static/vendor/htmx.min.js"></script>
      <script defer src="/static/js/app.js"></script>
      <script defer src="/static/vendor/alpine-csp.min.js"></script>
    </head>
    {/* Boosted links/forms (tabs, filters, task actions) replace the history entry instead of pushing,
        so Back always means "previous screen". Screen changes are real navigations (see nav.js). */}
    <body hx-boost="true" hx-replace-url="true">
      {children}
    </body>
  </html>
);

export const CsrfField: FC<{ token: string }> = ({ token }) => <input type="hidden" name="_csrf" value={token} />;

export const ThemeToggle: FC<{ theme: "dark" | "light"; csrf: string; next: string; class?: string }> = (p) => (
  <form method="post" action="/theme" class={`theme-form ${p.class ?? ""}`} hx-boost="false">
    <CsrfField token={p.csrf} />
    <input type="hidden" name="next" value={p.next} />
    <input type="hidden" name="theme" value={p.theme === "dark" ? "light" : "dark"} />
    <button
      type="submit"
      class="icon-btn theme-btn"
      aria-label={p.theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
    >
      <span class="theme-icon theme-icon-sun">
        <SunIcon size={19} />
      </span>
      <span class="theme-icon theme-icon-moon">
        <MoonIcon size={19} />
      </span>
    </button>
  </form>
);
