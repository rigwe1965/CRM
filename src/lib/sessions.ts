/**
 * Cutoff for "sign out everywhere". JWT issue times have one-second resolution and a session is
 * rejected only when issued *before* the cutoff, so the cutoff is the next whole second. Otherwise a
 * session created in the same second as the revoke would survive it.
 */
export const revokeCutoff = () => new Date(Math.floor(Date.now() / 1000) * 1000 + 1000);
