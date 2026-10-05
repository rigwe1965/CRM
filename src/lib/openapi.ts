import { z, type ZodType } from "zod";
import {
  activityListQuery,
  contactListQuery,
  createActivitySchema,
  createContactSchema,
  createDealSchema,
  createOrganizationSchema,
  createTaskSchema,
  dealListQuery,
  dealStageSchema,
  organizationListQuery,
  taskListQuery,
  updateActivitySchema,
  updateContactSchema,
  updateDealSchema,
  updateOrganizationSchema,
  updateTaskSchema,
} from "@/lib/validations/crm";

/**
 * OpenAPI 3.1 document generated from the same Zod schemas the handlers validate with,
 * so request shapes can't drift from the docs. Served at GET /api/openapi.json.
 * Add a row to OPERATIONS when you add an endpoint.
 */

type Op = {
  method: "get" | "post" | "patch" | "delete";
  path: string; // OpenAPI-style, e.g. /contacts/{id}
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
  // Dashboard
  { method: "get", path: "/dashboard", tag: "Dashboard", summary: "Counts, pipeline value, revenue and recent activity" },
];

function jsonSchema(schema: ZodType): Record<string, unknown> {
  const out = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

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
      ...(op.path.includes("{id}") ? [{ name: "id", in: "path", required: true, schema: { type: "string" } }] : []),
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
    if (op.path.includes("{id}")) responses[404] = ref("NotFound");
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
        "**Authorization:** non-admin users only see and edit their own data (owner of organizations, contacts and deals; author of activities; assignee or creator of tasks). Admins see everything.",
        "**Soft delete:** organizations, contacts and deals set `deletedAt` and disappear from the API; admins can pass `includeDeleted=true` to lists and restore via `POST /{id}/restore`. Activities and tasks are hard-deleted.",
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
              enum: ["BAD_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "VALIDATION_ERROR", "INVALID_REFERENCE", "ALREADY_CONVERTED", "INTERNAL_ERROR"],
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
