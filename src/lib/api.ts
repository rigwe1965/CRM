import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";

export const apiError = (message: string, status: number, fieldErrors?: Record<string, string[]>) =>
  NextResponse.json({ error: message, ...(fieldErrors && { fieldErrors }) }, { status });

/** Parses and validates a JSON body. Returns data, or a ready-to-return error response. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ data: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: apiError("Invalid JSON body", 400) };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const { fieldErrors, formErrors } = z.flattenError(result.error);
    const message = formErrors[0] ?? Object.values(fieldErrors).flat()[0] ?? "Invalid input";
    return {
      response: apiError(message, 422, fieldErrors as Record<string, string[]>),
    };
  }
  return { data: result.data };
}
