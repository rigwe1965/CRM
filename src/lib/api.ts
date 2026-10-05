import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z, ZodError, type ZodType } from "zod";

/**
 * Error contract for every endpoint:
 *   { "error": "<human message>", "code": "<MACHINE_CODE>", "fieldErrors"?: { field: ["msg"] } }
 * Success contract: { "data": ... } (lists add "meta": { page, pageSize, total, totalPages }).
 */

export type FieldErrors = Record<string, string[]>;

const CODES: Record<number, string> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  422: "VALIDATION_ERROR",
  429: "RATE_LIMITED",
  500: "INTERNAL_ERROR",
};

/** Throw from anywhere inside a route wrapped with `authed()`; it becomes a JSON error response. */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fieldErrors?: FieldErrors,
  ) {
    super(message);
  }
}

export const apiError = (
  message: string,
  status: number,
  fieldErrors?: FieldErrors,
  code?: string,
) =>
  NextResponse.json(
    { error: message, code: code ?? CODES[status] ?? "ERROR", ...(fieldErrors && { fieldErrors }) },
    { status },
  );

function validationFailure(error: ZodError): ApiError {
  const { fieldErrors, formErrors } = z.flattenError(error);
  const message = formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? "Invalid input";
  return new ApiError(422, message, "VALIDATION_ERROR", fieldErrors as FieldErrors);
}

/** Parses and validates a JSON body. Returns data, or a ready-to-return error response. (Auth routes.) */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  try {
    return { data: await readBody(req, schema) };
  } catch (e) {
    return { response: toErrorResponse(e) };
  }
}

/** Parses a JSON body; throws ApiError(400/422) on failure. */
export async function readBody<T>(req: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new ApiError(400, "Invalid JSON body");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailure(result.error);
  return result.data;
}

/** Parses the URL query string; throws ApiError(422) on failure. */
export function readQuery<T>(req: Request, schema: ZodType<T>): T {
  const raw = Object.fromEntries(new URL(req.url).searchParams);
  const result = schema.safeParse(raw);
  if (!result.success) throw validationFailure(result.error);
  return result.data;
}

export const ok = <T>(data: T, status = 200) => NextResponse.json({ data }, { status });
export const noContent = () => new NextResponse(null, { status: 204 });

export const paginated = <T>(data: T[], total: number, page: number, pageSize: number) =>
  NextResponse.json({
    data,
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
  });

export function toErrorResponse(e: unknown): NextResponse {
  // Next.js control-flow errors (dynamic rendering bail-out, redirect, notFound) must not be swallowed.
  if (typeof e === "object" && e !== null && "digest" in e) throw e;
  if (e instanceof ApiError) return apiError(e.message, e.status, e.fieldErrors, e.code);
  if (e instanceof ZodError) {
    const err = validationFailure(e);
    return apiError(err.message, 422, err.fieldErrors, err.code);
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2025") return apiError("Record not found", 404);
    if (e.code === "P2002") {
      const target = (e.meta?.target as string[] | undefined) ?? [];
      const fieldErrors = Object.fromEntries(target.map((f) => [f, ["Already in use"]]));
      return apiError("A record with this value already exists", 409, fieldErrors);
    }
    if (e.code === "P2003") {
      return apiError("The record is referenced by, or references, a record that doesn't exist", 422, undefined, "INVALID_REFERENCE");
    }
  }
  console.error("Unhandled API error", e);
  return apiError("Internal server error", 500);
}
