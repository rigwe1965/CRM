import { z, type ZodType } from "zod";
import {
  activityListQuery,
  contactListQuery,
  createActivitySchema,
  createContactSchema,
  createDealSchema,
  createInvoiceSchema,
  createOrganizationSchema,
  createPaymentSchema,
  createStockAdjustmentSchema,
  createTaskSchema,
  dealListQuery,
  dealStageSchema,
  invoiceListQuery,
  organizationListQuery,
  scheduleSchema,
  taskListQuery,
  updateActivitySchema,
  sendContactEmailSchema,
  updateContactSchema,
  updateDealSchema,
  updateInvoiceSchema,
  updateOrganizationSchema,
  updateStockAdjustmentSchema,
  updateTaskSchema,
} from "@/lib/validations/crm";

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the handlers validate with,
 * so request shapes can't drift from the docs. Served at GET /api/openapi.json.
 * Add a row to OPERATIONS when you add an endpoint.
 */

type Op = {
  method: "get" | "post" | "put" | "patch" | "delete";
  path: string; // OpenAPI-style, e.g. /contacts/{id} or /deals/{id}/payments/{paymentId}
  tag: string;
  summary: string;
  description?: string;
  admin?: boolean;
  query?: ZodType;
  body?: ZodType;
  success?: 200 | 201 | 204;
  list?: boolean;
};

const OPERATIONS: Op[] = [
  // Organizations
  { method: "get", path: "/organizations", tag: "Organizations", summary: "List organizations", query: organizationListQuery, list: true },
  { method: "post", path: "/organizations", tag: "Organizations", summary: "Create an organization", body: createOrganizationSchema, success: 201 },
  { method: "get", path: "/organizations/{id}", tag: "Organizations", summary: "Get an organization" },
  { method: "patch", path: "/organizations/{id}", tag: "Organizations", summary: "Update an organization", body: updateOrganizationSchema },
  { method: "delete", path: "/organizations/{id}", tag: "Organizations", summary: "Soft-delete an organization", success: 204 },
  { method: "post", path: "/organizations/{id}/restore", tag: "Organizations", summary: "Restore a soft-deleted organization", admin: true },
  // Contacts
  { method: "get", path: "/contacts", tag: "Contacts", summary: "List contacts, leads and customers", query: contactListQuery, list: true },
  { method: "post", path: "/contacts", tag: "Contacts", summary: "Create a contact", body: createContactSchema, success: 201 },
  { method: "get", path: "/contacts/{id}", tag: "Contacts", summary: "Get a contact" },
  { method: "patch", path: "/contacts/{id}", tag: "Contacts", summary: "Update a contact", body: updateContactSchema },
  { method: "delete", path: "/contacts/{id}", tag: "Contacts", summary: "Soft-delete a contact", success: 204 },
  { method: "post", path: "/contacts/{id}/convert", tag: "Contacts", summary: "Convert a lead/prospect to a customer", description: "409 ALREADY_CONVERTED if the contact is already a customer." },
  { method: "post", path: "/contacts/{id}/email", tag: "Contacts", summary: "Email a contact", description: "Sends the message to the contact (Reply-To is the signed-in user) and logs an EMAIL activity. 422 NO_EMAIL if the contact has no address, 429 when rate limited, 502 EMAIL_FAILED if the provider rejects it.", body: sendContactEmailSchema, success: 201 },
  { method: "post", path: "/contacts/{id}/restore", tag: "Contacts", summary: "Restore a soft-deleted contact", admin: true },
  // Deals
  { method: "get", path: "/deals", tag: "Deals", summary: "List deals", query: dealListQuery, list: true },
  { method: "post", path: "/deals", tag: "Deals", summary: "Create a deal", body: createDealSchema, success: 201 },
  { method: "get", path: "/deals/pipeline", tag: "Deals", summary: "Pipeline summary by stage", description: "Count, total amount and probability-weighted amount per stage." },
  { method: "get", path: "/deals/{id}", tag: "Deals", summary: "Get a deal" },
  { method: "patch", path: "/deals/{id}", tag: "Deals", summary: "Update a deal", description: "Changing `stage` also resets probability, closedAt and lostReason.", body: updateDealSchema },
  { method: "delete", path: "/deals/{id}", tag: "Deals", summary: "Soft-delete a deal", success: 204 },
  { method: "post", path: "/deals/{id}/stage", tag: "Deals", summary: "Move a deal to another pipeline stage", body: dealStageSchema },
  { method: "post", path: "/deals/{id}/restore", tag: "Deals", summary: "Restore a soft-deleted deal", admin: true },
  // Activities
  { method: "get", path: "/activities", tag: "Activities", summary: "List activities (calls, emails, meetings, notes)", query: activityListQuery, list: true },
  { method: "post", path: "/activities", tag: "Activities", summary: "Log an activity", body: createActivitySchema, success: 201 },
  { method: "get", path: "/activities/{id}", tag: "Activities", summary: "Get an activity" },
  { method: "patch", path: "/activities/{id}", tag: "Activities", summary: "Update an activity", body: updateActivitySchema },
  { method: "delete", path: "/activities/{id}", tag: "Activities", summary: "Delete an activity (hard delete)", success: 204 },
  // Tasks
  { method: "get", path: "/tasks", tag: "Tasks", summary: "List tasks", query: taskListQuery, list: true },
  { method: "post", path: "/tasks", tag: "Tasks", summary: "Create a task", body: createTaskSchema, success: 201 },
  { method: "get", path: "/tasks/{id}", tag: "Tasks", summary: "Get a task" },
  { method: "patch", path: "/tasks/{id}", tag: "Tasks", summary: "Update a task", body: updateTaskSchema },
  { method: "delete", path: "/tasks/{id}", tag: "Tasks", summary: "Delete a task (hard delete)", success: 204 },
  // Invoices (supplier stock purchases)
  { method: "get", path: "/invoices", tag: "Invoices", summary: "List supplier invoices", description: "Search `q` matches number, bill-to and vendor name.", query: invoiceListQuery, list: true },
  { method: "post", path: "/invoices", tag: "Invoices", summary: "Create an invoice with its line items", description: "Status defaults to DRAFT. Each line's total is quantity x unitPrice unless `lineTotal` is sent; the sheet subtotal is computed, and the deal price (`total`) defaults to subtotal + shipping. The owner is the caller. `dealIds` links the customer deals this order fulfils.", body: createInvoiceSchema, success: 201 },
  { method: "get", path: "/invoices/{id}", tag: "Invoices", summary: "Get an invoice with its line items and linked deals" },
  { method: "patch", path: "/invoices/{id}", tag: "Invoices", summary: "Update an invoice", description: "Sending `items` replaces all lines and recomputes the subtotal (and the deal price, unless `total` is sent). Sending `dealIds` replaces the linked deals.", body: updateInvoiceSchema },
  { method: "delete", path: "/invoices/{id}", tag: "Invoices", summary: "Delete an invoice (hard delete; its lines go with it)", success: 204 },
  // Payments and instalments (hang off a deal)
  { method: "get", path: "/deals/{id}/payments", tag: "Payments", summary: "Payments received on a deal, its instalment schedule and the balance", description: "Payments are applied to the schedule oldest-first. An instalment is overdue when it is not fully covered and its due date is before today (due today is not overdue)." },
  { method: "post", path: "/deals/{id}/payments", tag: "Payments", summary: "Record a payment", description: "Returns the updated payments view. 422 if the amount exceeds the remaining balance.", body: createPaymentSchema, success: 201 },
  { method: "delete", path: "/deals/{id}/payments/{paymentId}", tag: "Payments", summary: "Remove a mistaken payment", description: "Returns the updated payments view (200), not an empty body." },
  { method: "put", path: "/deals/{id}/schedule", tag: "Payments", summary: "Replace the instalment schedule", description: "Send an empty `instalments` list to clear it. Returns the updated payments view. 422 if the instalments total more than the deal amount.", body: scheduleSchema },
  // Stock
  { method: "get", path: "/stock", tag: "Stock", summary: "Stock on hand per product, colour and length", description: "On hand = pieces bought (lines of SENT and PAID invoices) - pieces sold (items on PROPOSAL, NEGOTIATION and CLOSED_WON deals) + manual adjustments, matched case-insensitively on product, colour and length. Each row lists its adjustments and the invoices it came from. `unmatched` lists sold items that matched no invoice line." },
  { method: "post", path: "/stock/adjustments", tag: "Stock", summary: "Record a manual stock adjustment", description: "`quantity` is signed and non-zero: positive adds pieces (found stock, opening stock), negative removes them (damaged, lost). Matched to a stock row on product, colour and length; if no invoice line matches, it creates its own row.", body: createStockAdjustmentSchema, success: 201 },
  { method: "patch", path: "/stock/adjustments/{id}", tag: "Stock", summary: "Change an adjustment's quantity, reason or note", description: "The product, colour and length cannot be changed; delete and re-create the adjustment instead.", body: updateStockAdjustmentSchema },
  { method: "delete", path: "/stock/adjustments/{id}", tag: "Stock", summary: "Delete a stock adjustment (hard delete)", success: 204 },
  // Dashboard
  { method: "get", path: "/dashboard", tag: "Dashboard", summary: "Counts, pipeline value, revenue and recent activity" },
];

function jsonSchema(schema: ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** Every `{name}` in an OpenAPI-style path, in order. */
const pathParamNames = (path: string) => [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);

function queryParameters(schema: ZodType) {
  const { properties = {}, required = [] } = jsonSchema(schema) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, s]) => ({
    name,
    in: "query",
    required: required.includes(name),
    schema: s,
  }));
}

const ref = (name: string) => ({ $ref: `#/components/responses/${name}` });

export function buildOpenApiDocument() {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of OPERATIONS) {
    const success = op.success ?? 200;
    const parameters = [
      ...pathParamNames(op.path).map((name) => ({ name, in: "path", required: true, schema: { type: "string" } })),
      ...(op.query ? queryParameters(op.query) : []),
    ];
    const responses: Record<string, unknown> =
      success === 204
        ? { 204: { description: "Deleted" } }
        : {
            [success]: {
              description: op.list ? "A page of results" : "Success",
              content: {
                "application/json": {
                  schema: { $ref: op.list ? "#/components/schemas/List" : "#/components/schemas/Item" },
                },
              },
            },
          };
    responses[401] = ref("Unauthorized");
    responses[403] = ref("Forbidden");
    if (op.path.includes("{")) responses[404] = ref("NotFound");
    if (op.body || op.query) responses[422] = ref("ValidationError");

    (paths[op.path] ??= {})[op.method] = {
      tags: [op.tag],
      summary: op.summary,
      description: [op.description, op.admin ? "**Admin only.**" : undefined].filter(Boolean).join("\n\n") || undefined,
      ...(parameters.length && { parameters }),
      ...(op.body && {
        requestBody: { required: true, content: { "application/json": { schema: jsonSchema(op.body) } } },
      }),
      responses,
    };
  }

  const error = (description: string) => ({
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  });

  return {
    openapi: "3.1.0",
    info: {
      title: "CRM API",
      version: "1.0.0",
      description: [
        "REST API for the CRM. All endpoints require a signed-in session (Auth.js cookie) except where noted.",
        "",
        "**Authorization:** non-admin users only see and edit their own data (owner of organizations, contacts, deals, invoices and stock adjustments; author of activities; assignee or creator of tasks; payments and instalments follow their deal). Admins see everything.",
        "**Money:** amounts are kept per currency (USD, EUR...) and are never added across currencies.",
        "**Soft delete:** organizations, contacts and deals set `deletedAt` and disappear from the API; admins can pass `includeDeleted=true` to lists and restore via `POST /{id}/restore`. Activities, tasks, invoices, payments and stock adjustments are hard-deleted.",
        "**Lists:** `page` (default 1), `pageSize` (default 20, max 100), `sort`, `order` (asc|desc), `q` (text search) plus resource-specific filters. Enum filters accept comma-separated values.",
        "**Errors:** `{ error, code, fieldErrors? }`.",
      ].join("\n"),
    },
    servers: [{ url: "/api" }],
    security: [{ sessionCookie: [] }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: "apiKey", in: "cookie", name: "authjs.session-token" },
      },
      schemas: {
        Item: { type: "object", properties: { data: { type: "object" } }, required: ["data"] },
        List: {
          type: "object",
          properties: {
            data: { type: "array", items: { type: "object" } },
            meta: {
              type: "object",
              properties: {
                page: { type: "integer" },
                pageSize: { type: "integer" },
                total: { type: "integer" },
                totalPages: { type: "integer" },
              },
            },
          },
          required: ["data", "meta"],
        },
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: {
              type: "string",
              enum: ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "INVALID_REFERENCE", "ALREADY_CONVERTED", "RATE_LIMITED", "PAYLOAD_TOO_LARGE", "INTERNAL_ERROR"],
            },
            fieldErrors: { type: "object", additionalProperties: { type: "array", items: { type: "string" } } },
          },
          required: ["error", "code"],
        },
      },
      responses: {
        Unauthorized: error("Not signed in"),
        Forbidden: error("Signed in but not allowed"),
        NotFound: error("Record doesn't exist or isn't visible to you"),
        ValidationError: error("Invalid input"),
      },
    },
  };
}
