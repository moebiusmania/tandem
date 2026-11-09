import { z } from "zod";

/** Collapse whitespace and strip control characters from user text. */
const cleanText = (max: number) =>
  z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

export const loginSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(256),
  remember: z.literal("on").optional(),
});

export const listNameSchema = z.object({ name: cleanText(80) });

export const newItemSchema = z.object({
  title: cleanText(200),
  due: z
    .union([z.literal(""), z.iso.date()])
    .optional()
    .transform((v) => v || null),
});

export const usernameSchema = z
  .string()
  .regex(/^[a-z0-9_.-]{3,32}$/i, "3–32 characters: letters, digits, dot, dash, underscore");

/**
 * The one password policy, shared by the CLI and the change-password form.
 * OWASP ASVS 2.1: at least 12 characters, at most 128, no composition rules.
 * The form renders these limits as minlength/maxlength, and the browser check reads them from there.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use at most ${PASSWORD_MAX} characters.`);

export const changePasswordSchema = z.object({ password: passwordSchema });

export const idSchema = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

export const FILTERS = ["all", "shared", "private"] as const;
export const TABS = ["todo", "done", "all"] as const;
export type Filter = (typeof FILTERS)[number];
export type Tab = (typeof TABS)[number];

export function pick<T extends string>(allowed: readonly T[], value: string | undefined, fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

/** Accept only same-site relative paths, preventing open redirects. */
export function safeRedirect(target: string | undefined, fallback = "/"): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") || target.includes("\\")) return fallback;
  if (/[\u0000-\u001F]/.test(target)) return fallback;
  return target;
}
