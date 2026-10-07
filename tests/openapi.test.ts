import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "@/lib/openapi";

type Op = { tags: string[]; parameters?: { name: string; in: string }[]; requestBody?: unknown; responses: Record<string, unknown> };
const doc = buildOpenApiDocument() as unknown as { paths: Record<string, Record<string, Op>>; tags: { name: string }[]; info: { description: string }; components: { schemas: { Error: { properties: { code: { enum: string[] } } } } } };

const NEW_OPERATIONS: [string, string][] = [
  ["get", "/invoices"], ["post", "/invoices"], ["get", "/invoices/{id}"], ["patch", "/invoices/{id}"], ["delete", "/invoices/{id}"],
  ["get", "/deals/{id}/payments"], ["post", "/deals/{id}/payments"], ["delete", "/deals/{id}/payments/{paymentId}"], ["put", "/deals/{id}/schedule"],
  ["get", "/stock"], ["post", "/stock/adjustments"], ["patch", "/stock/adjustments/{id}"], ["delete", "/stock/adjustments/{id}"],
];

describe("OpenAPI document", () => {
  it("documents invoices, payments and stock", () => {
    for (const [method, path] of NEW_OPERATIONS) expect(doc.paths[path]?.[method], `${method} ${path}`).toBeDefined();
    expect(doc.tags.map((t) => t.name)).toEqual(expect.arrayContaining(["Invoices", "Payments", "Stock"]));
  });

  it("declares every path parameter and a 404 for parameterised paths", () => {
    for (const [path, methods] of Object.entries(doc.paths)) {
      const names = [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const [method, op] of Object.entries(methods)) {
        const declared = (op.parameters ?? []).filter((p) => p.in === "path").map((p) => p.name);
        expect(declared, `${method} ${path}`).toEqual(names);
        if (names.length) expect(op.responses["404"], `${method} ${path}`).toBeDefined();
      }
    }
  });

  it("has request bodies for the new writes", () => {
    for (const [method, path] of [["post", "/invoices"], ["patch", "/invoices/{id}"], ["post", "/deals/{id}/payments"], ["put", "/deals/{id}/schedule"], ["post", "/stock/adjustments"], ["patch", "/stock/adjustments/{id}"]]) {
      expect(doc.paths[path][method].requestBody, `${method} ${path}`).toBeDefined();
    }
  });

  it("uses the right success codes", () => {
    expect(Object.keys(doc.paths["/invoices"].post.responses)).toContain("201");
    expect(Object.keys(doc.paths["/invoices/{id}"].delete.responses)).toContain("204");
    expect(Object.keys(doc.paths["/deals/{id}/payments/{paymentId}"].delete.responses)).toContain("200");
    expect(Object.keys(doc.paths["/stock/adjustments"].post.responses)).toContain("201");
  });

  it("keeps the existing endpoints", () => {
    expect(doc.paths["/contacts/{id}/convert"].post).toBeDefined();
    expect(doc.paths["/deals/{id}/stage"].post).toBeDefined();
    expect(doc.paths["/organizations/{id}/restore"].post).toBeDefined();
    expect(doc.paths["/contacts/{id}"].get.parameters).toEqual([{ name: "id", in: "path", required: true, schema: { type: "string" } }]);
  });

  it("mentions per-currency money and the rate-limit error code, and serialises to JSON", () => {
    expect(doc.info.description).toMatch(/never added across currencies/);
    expect(doc.components.schemas.Error.properties.code.enum).toContain("RATE_LIMITED");
    expect(() => JSON.stringify(doc)).not.toThrow();
  });
});
