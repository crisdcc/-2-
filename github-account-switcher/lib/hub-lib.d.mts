/*
 * Types for lib/hub-lib.mjs, for the repository's TypeScript tooling
 * (typecheck and tests). The extension itself loads the .mjs directly.
 */

export interface GHCookieLike {
  name: string;
  value?: string;
  domain: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  hostOnly?: boolean;
  sameSite?: string;
  expirationDate?: number;
  firstPartyDomain?: string;
  storeId?: string;
  partitionKey?: { topLevelSite: string | null };
  [key: string]: unknown;
}

export interface GHProfile {
  id: string;
  username: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  storeId: string | null;
  partitionKey: { topLevelSite: string | null } | null;
  cookies: Array<Record<string, unknown>>;
}

export interface GHProfileMeta {
  id: string;
  username: string | null;
  name: string;
  createdAt: number;
  updatedAt: number;
  storeId: string | null;
}

export interface GHASLib {
  SITE_ORIGINS: string[];
  isGithubHostname(hostname: string): boolean;
  cookieAllowed(cookie: { domain: string }): boolean;
  dedupeCookies<T extends { name: string; domain: string; path: string }>(
    cookies: T[],
  ): T[];
  normalizeSameSite(value: string): "strict" | "lax" | "no_restriction";
  cookieUrl(cookie: { domain: string; path: string }): string;
  serializeCookie(cookie: GHCookieLike): Record<string, unknown>;
  toSetDetails(
    cookie: Record<string, unknown>,
    storeId?: string,
  ): Record<string, unknown>;
  usernameFromCookies(
    cookies: Array<{ name: string; value: string }>,
  ): string | null;
  sanitizeName(value: unknown, maxLen?: number): string;
  makeId(username: string | null, stamp?: number): string;
  profileFromCookies(
    cookies: GHCookieLike[],
    opts?: {
      username?: string | null;
      name?: string;
      now?: number;
      existingId?: string;
      createdAt?: number;
      storeId?: string | null;
      partitionKey?: { topLevelSite: string | null } | null;
    },
  ): GHProfile;
  profileMeta(profile: GHProfile): GHProfileMeta;
  displayName(profile: GHProfile | GHProfileMeta): string;
}

export declare const GHAS: GHASLib;
