import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>;

/** scrypt$<salt b64>$<hash b64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  if (expected.length < 16) return false;
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return timingSafeEqual(actual, expected);
}

export function normalizeUsername(u: string): string {
  return u.trim().toLowerCase();
}

export function usernameProblem(u: string): string | null {
  return /^[a-z0-9._-]{2,32}$/.test(u) ? null : "Usernames are 2 to 32 characters: letters, numbers, dot, dash, underscore.";
}

export function passwordProblem(pw: string): string | null {
  return pw.length < 10 ? "Use at least 10 characters." : null;
}
