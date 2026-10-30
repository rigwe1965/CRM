import { describe, expect, it } from "vitest";
import { checkWipeTarget } from "../scripts/safe-target";

const local = "postgresql://crm:crm@localhost:5432/crm?schema=public";
const neon = "postgresql://u:p@ep-cool-name-123.eu-west-2.aws.neon.tech/crm_prod?sslmode=require";

describe("checkWipeTarget", () => {
  it("allows a local database", () => {
    expect(checkWipeTarget({ DATABASE_URL: local }, [])).toEqual({ ok: true });
  });

  it("refuses a hosted database", () => {
    expect(checkWipeTarget({ DATABASE_URL: neon }, [])).toMatchObject({ ok: false });
  });

  it("refuses a local-looking URL when NODE_ENV is production", () => {
    expect(checkWipeTarget({ DATABASE_URL: local, NODE_ENV: "production" }, [])).toMatchObject({ ok: false });
  });

  it("refuses a missing or unparseable URL", () => {
    expect(checkWipeTarget({}, [])).toMatchObject({ ok: false });
    expect(checkWipeTarget({ DATABASE_URL: "not a url" }, ["--force"])).toMatchObject({ ok: false });
  });

  it("--force alone is not enough on a hosted database", () => {
    expect(checkWipeTarget({ DATABASE_URL: neon }, ["--force"])).toMatchObject({ ok: false });
  });

  it("CONFIRM_WIPE alone is not enough either", () => {
    expect(checkWipeTarget({ DATABASE_URL: neon, CONFIRM_WIPE: "crm_prod" }, [])).toMatchObject({ ok: false });
  });

  it("--force with the wrong database name is refused", () => {
    expect(checkWipeTarget({ DATABASE_URL: neon, CONFIRM_WIPE: "crm" }, ["--force"])).toMatchObject({ ok: false });
  });

  it("--force with the matching database name goes ahead", () => {
    expect(checkWipeTarget({ DATABASE_URL: neon, CONFIRM_WIPE: "crm_prod" }, ["--force"])).toEqual({ ok: true });
    expect(checkWipeTarget({ DATABASE_URL: neon, CONFIRM_WIPE: "crm_prod", WIPE_FORCE: "1" }, [])).toEqual({ ok: true });
  });

  it("names the database to confirm in the refusal message", () => {
    const r = checkWipeTarget({ DATABASE_URL: neon }, []);
    expect(r.ok === false && r.reason).toContain('"crm_prod"');
  });
});
