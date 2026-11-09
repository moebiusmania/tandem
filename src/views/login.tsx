import type { FC } from "hono/jsx";
import { ArrowRight, Logo } from "./icons";
import { CsrfField, Layout, ThemeToggle } from "./layout";

export interface LoginProps {
  csrf: string;
  theme: "dark" | "light";
  error?: string;
  username?: string;
  remember?: boolean;
  accounts: number;
}

export const LoginPage: FC<LoginProps> = (p) => (
  <Layout title="Tandem — Sign in" theme={p.theme} page="login">
    <div class="tdm">
      <ThemeToggle theme={p.theme} csrf={p.csrf} next="/login" class="theme-floating" />
      <div class="login">
        <section class="hero">
          <div class="glow glow-a" aria-hidden="true"></div>
          <div class="glow glow-b" aria-hidden="true"></div>
          <div class="brand">
            <Logo />
            <span class="brand-name">Tandem</span>
          </div>
          <div class="hero-copy">
            <h1 class="hero-title">
              Get it done,
              <br />
              together.
            </h1>
            <p class="hero-lede">Lists for the two of you. Share the ones you split, keep the rest to yourself.</p>
          </div>
          <div class="hero-art" aria-hidden="true">
            <div class="art-card">
              <div class="art-row">
                <span class="swatch c-0"></span>
                <span class="art-name">Groceries</span>
                <span class="badge-shared">Shared</span>
              </div>
              <div class="art-track">
                <div class="art-fill"></div>
              </div>
              <span class="art-note">“Olive oil” checked off · just now</span>
            </div>
            <div class="art-chip">
              <span class="art-box"></span>
              <span class="art-done">Book the electrician</span>
            </div>
          </div>
        </section>

        <div class="form-wrap">
          <form method="post" action="/login" class="login-form" hx-boost="false">
            <CsrfField token={p.csrf} />
            <div class="form-head">
              <h2>Welcome back</h2>
              <p>Sign in to your lists.</p>
            </div>
            {p.error ? (
              <p class="form-error" role="alert">
                {p.error}
              </p>
            ) : null}
            <label class="field">
              Username
              <input
                type="text"
                name="username"
                autocomplete="username"
                autocapitalize="none"
                spellcheck={false}
                placeholder="Your username"
                required
                maxlength={64}
                value={p.username ?? ""}
                autofocus={!p.username}
              />
            </label>
            <label class="field">
              Password
              <div class="pw" x-data="password">
                <input
                  type="password"
                  name="password"
                  autocomplete="current-password"
                  placeholder="Your password"
                  required
                  maxlength={256}
                  autofocus={!!p.username}
                  x-bind:type="type"
                />
                <button type="button" class="pw-toggle" x-cloak x-on:click="toggle" x-bind:aria-label="aria" x-text="label">
                  Show
                </button>
              </div>
            </label>
            <label class="check">
              <input type="checkbox" name="remember" checked={p.remember ?? true} /> Keep me signed in on this device
            </label>
            <button type="submit" class="btn-primary">
              Sign in <ArrowRight size={18} />
            </button>
            <p class="form-foot">
              Private workspace · {p.accounts} {p.accounts === 1 ? "account" : "accounts"}
            </p>
          </form>
        </div>
      </div>
    </div>
  </Layout>
);
