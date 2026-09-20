/**
 * Does the /welcome flow still need to ask for a password? True until the
 * account has both a credential password and a verified email — covers a
 * fresh ops-created row (no account at all), a client who signed in via magic
 * link first (verified, no password), and legacy rows made with a throwaway
 * password (unverified, password to be replaced). Pure.
 */
export function needsPasswordSetup(i: { emailVerified: boolean; credentialPassword: string | null | undefined }): boolean {
  return !i.credentialPassword || !i.emailVerified;
}
