// Alpine components for the CSP build: no inline expressions, only named methods/getters.
document.addEventListener("alpine:init", () => {
  const Alpine = window.Alpine;

  // Login: show / hide password.
  Alpine.data("password", () => ({
    shown: false,
    toggle() {
      this.shown = !this.shown;
    },
    get type() {
      return this.shown ? "text" : "password";
    },
    get label() {
      return this.shown ? "Hide" : "Show";
    },
    get aria() {
      return this.shown ? "Hide password" : "Show password";
    },
  }));

  // List title: save on change, select on creation.
  Alpine.data("autosubmit", () => ({
    submit() {
      this.$el.form?.requestSubmit();
    },
    select() {
      this.$el.select?.();
    },
  }));

  // Destructive forms: ask first (data-confirm holds the question).
  Alpine.data("confirmer", () => ({
    ask(event) {
      if (!window.confirm(this.$root.dataset.confirm)) event.preventDefault();
    },
  }));

  // Share switch: slide the knob immediately, the server response follows.
  Alpine.data("switcher", () => ({
    flip() {
      const btn = this.$root.querySelector('[role="switch"]');
      btn?.setAttribute("aria-checked", btn.getAttribute("aria-checked") === "true" ? "false" : "true");
    },
  }));

  // New task: show it immediately, confirm with the server, roll back if that fails.
  Alpine.data("adder", () => ({
    async submit() {
      const form = this.$root;
      const title = form.elements.namedItem("title");
      const due = form.elements.namedItem("due");
      const text = title.value.trim();
      if (!text) return;

      const data = new FormData(form);
      const cid = randomId();
      data.set("cid", cid);
      const dueValue = due.value;
      const row = insertPlaceholder(text, cid);
      title.value = "";
      due.value = "";
      title.focus();
      this.$refs.error.textContent = "";

      try {
        const res = await fetch(form.action, {
          method: "POST",
          body: new URLSearchParams(data),
          headers: { "HX-Request": "true" },
          credentials: "same-origin",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // The response replaces the placeholder and updates the counters out-of-band.
        // transition: false keeps the swap synchronous. With globalViewTransitions htmx would defer
        // it into startViewTransition, so the remove() below would delete the placeholder before
        // the response could replace it and the new task would never show.
        window.htmx.swap(document.body, await res.text(), { swapStyle: "none", transition: false });
        row?.remove(); // no-op once replaced; never leave an unconfirmed row behind
      } catch {
        rollback(row);
        if (!title.value) {
          title.value = text;
          due.value = dueValue;
        }
        this.$refs.error.textContent = `Couldn’t add “${text}”. Check your connection and try again.`;
      }
    },
  }));

  // Account menu: toggled by the avatar, closed by Escape or a click outside.
  Alpine.data("menu", () => ({
    open: false,
    get expanded() {
      return this.open ? "true" : "false";
    },
    toggle() {
      this.open = !this.open;
      if (this.open) this.$nextTick(() => this.$root.querySelector('[role="menuitem"]')?.focus());
    },
    close() {
      if (!this.open) return;
      this.open = false;
      this.$refs.trigger?.focus();
    },
    changePassword() {
      this.open = false;
      document.getElementById("pw-dialog")?.showModal();
    },
  }));

  // Change password modal: check the rules locally, then let the server decide.
  Alpine.data("pwchange", () => ({
    error: "",
    busy: false,
    done: false,
    get editing() {
      return !this.done;
    },
    get invalid() {
      return this.error ? "true" : "false";
    },
    async submit() {
      if (this.busy) return;
      const form = this.$root.querySelector("form");
      const input = form.elements.namedItem("password");
      this.error = passwordProblem(input);
      if (this.error) return input.focus();

      this.busy = true;
      try {
        const res = await fetch(form.action, {
          method: "POST",
          body: new URLSearchParams(new FormData(form)),
          headers: { "HX-Request": "true" },
          credentials: "same-origin",
        });
        if (res.ok) {
          input.value = "";
          this.done = true;
        } else if (res.status === 400) {
          this.error = await res.text();
          input.focus();
        } else if (res.status === 401) {
          this.error = "Your session has expired. Sign in again to change your password.";
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        this.error = "Couldn’t save your password. Check your connection and try again.";
      } finally {
        this.busy = false;
      }
    },
    cancel() {
      this.$root.close();
    },
    reset() {
      this.error = "";
      this.busy = false;
      this.done = false;
      const input = this.$root.querySelector('input[name="password"]');
      if (input) input.value = "";
    },
  }));

  // Task row: play the check / removal animation while the request is in flight.
  Alpine.data("item", () => ({
    toggle() {
      this.$root.classList.toggle("is-done");
      this.$root.classList.add("is-ticking");
    },
    remove() {
      this.$root.classList.add("is-removing");
    },
  }));
});

/**
 * Length check against the input's own minlength/maxlength, which the server renders from
 * the shared password policy. Returns "" when the password is acceptable.
 */
function passwordProblem(input) {
  const n = input.value.length;
  if (input.minLength > 0 && n < input.minLength) return `Use at least ${input.minLength} characters.`;
  if (input.maxLength > 0 && n > input.maxLength) return `Use at most ${input.maxLength} characters.`;
  return "";
}

function randomId() {
  // crypto.getRandomValues works on plain-HTTP origins too (randomUUID needs a secure context).
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function insertPlaceholder(text, cid) {
  const list = document.querySelector(".items");
  if (!list) return null;
  const tpl = document.getElementById("pending-item");
  // Without the template, a bare row still gives the server's response something to replace.
  const row = tpl ? tpl.content.firstElementChild.cloneNode(true) : document.createElement("li");
  row.classList.add("item", "is-pending");
  row.id = `pending-${cid}`;
  const title = row.querySelector(".item-title");
  if (title) title.textContent = text; // text, never HTML
  list.prepend(row);
  return row;
}

function rollback(row) {
  if (!row) return;
  row.classList.add("is-failed");
  setTimeout(() => row.remove(), 320);
}
