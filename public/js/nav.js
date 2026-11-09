// Direction-aware page transitions with web standards only:
// cross-document View Transitions (enabled in app.css with `@view-transition { navigation: auto }`),
// the `pagereveal` event and the Navigation API. Each transition is tagged with a View Transition
// type, "forward" (open a list) or "back", which app.css styles via :active-view-transition-type().
(() => {
  const listId = (url) => url.pathname.match(/^\/lists\/(\d+)/)?.[1] ?? null;
  // Screen depth: 0 = lists (home), 1 = a list.
  const depth = (url) => (listId(url) ? 1 : 0);

  function direction(fromHref, toHref, navigationType, fromIndex, toIndex) {
    let from, to;
    try {
      from = new URL(fromHref);
      to = new URL(toHref);
    } catch {
      return null;
    }
    if (from.origin !== to.origin) return null;
    // Browser back/forward buttons: the history position decides.
    if (navigationType === "traverse" && fromIndex >= 0 && toIndex >= 0 && fromIndex !== toIndex)
      return toIndex < fromIndex ? "back" : "forward";
    const a = depth(from), b = depth(to);
    if (a !== b) return b > a ? "forward" : "back";
    // List to another list counts as opening a list.
    if (b === 1 && listId(from) !== listId(to)) return "forward";
    return null; // same screen (e.g. sign-in → home): default cross-fade
  }

  window.addEventListener("pagereveal", (event) => {
    const vt = event.viewTransition;
    if (!vt) return;
    const activation = window.navigation?.activation;
    // Without the Navigation API (older Safari) fall back to the referrer: same-origin only,
    // which Referrer-Policy: same-origin provides.
    const from = activation?.from?.url ?? document.referrer;
    const to = activation?.entry?.url ?? location.href;
    const dir = direction(from, to, activation?.navigationType, activation?.from?.index ?? -1, activation?.entry?.index ?? -1);
    if (dir) vt.types?.add(dir);
  });
})();
