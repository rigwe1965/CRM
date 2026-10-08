import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }));
import { isKnownIp, markKnownIp } from "@/lib/rate-limit";
import { signInAllowed } from "@/lib/signin-limits";

let n = 0;
const fresh = () => `victim${++n}@example.com`;

beforeEach(() => findUnique.mockReset());

describe("known sign-in addresses", () => {
  it("remembers an address per account", async () => {
    await markKnownIp("u1", "1.1.1.1");
    expect(await isKnownIp("u1", "1.1.1.1")).toBe(true);
    expect(await isKnownIp("u1", "2.2.2.2")).toBe(false);
    expect(await isKnownIp("u2", "1.1.1.1")).toBe(false);
  });
  it("never trusts an unidentified address", async () => {
    await markKnownIp("u1", "unknown");
    expect(await isKnownIp("u1", "unknown")).toBe(false);
  });
});

describe("signInAllowed", () => {
  it("locks the account for new addresses after 40 attempts, but not for a known one", async () => {
    const email = fresh();
    findUnique.mockResolvedValue({ id: `id-${email}` });
    await markKnownIp(`id-${email}`, "9.9.9.9");

    // Attacker rotates addresses so only the account limit can stop them.
    let blocked = 0;
    for (let i = 0; i < 45; i++) if (!(await signInAllowed(`10.0.0.${i}`, email)).allowed) blocked++;
    expect(blocked).toBe(5);

    // The real owner, from the address they signed in from before, is still let in.
    expect((await signInAllowed("9.9.9.9", email)).allowed).toBe(true);
  });
  it("still applies the per-address limit to a known address", async () => {
    const email = fresh();
    findUnique.mockResolvedValue({ id: `id-${email}` });
    await markKnownIp(`id-${email}`, "8.8.8.8");
    let allowed = 0;
    for (let i = 0; i < 20; i++) if ((await signInAllowed("8.8.8.8", email)).allowed) allowed++;
    expect(allowed).toBe(15);
  });
  it("treats unknown emails like any other account", async () => {
    findUnique.mockResolvedValue(null);
    expect((await signInAllowed("7.7.7.7", fresh())).allowed).toBe(true);
  });
});
