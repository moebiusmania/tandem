export interface Argon2Options {
  memoryCost: number;
  timeCost: number;
}

export function hashPassword(password: string, opts: Argon2Options): Promise<string> {
  return Bun.password.hash(password, { algorithm: "argon2id", ...opts });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  try {
    return await Bun.password.verify(password, hash);
  } catch {
    return false;
  }
}

/**
 * A hash to verify against when the username does not exist, so a miss
 * costs the same time as a wrong password (prevents user enumeration by timing).
 */
export function dummyHash(opts: Argon2Options): () => Promise<string> {
  let cached: Promise<string> | undefined;
  return () => (cached ??= hashPassword(crypto.randomUUID(), opts));
}
