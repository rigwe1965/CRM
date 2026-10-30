import type { ZodType } from "zod";
import type { OwnerScope } from "@/lib/access";
import type { SessionUser } from "@/lib/auth-helpers";
import { resultText } from "@/lib/ai/tools/result";

/** Who Ivy is working for. Every tool reads through `owned`, the same scope the screens use, so Ivy sees exactly what the person sees. */
export type ToolContext = { user: SessionUser; owned: OwnerScope; now: Date; /** The chat this answer belongs to; the proposal tools attach their cards to it. */ conversationId?: string };

/** The model sent input that does not fit the tool, or asked for something that is not there. The message goes back to it so it can correct itself. */
export class ToolError extends Error {}

/** A read-only tool Ivy may call (AI_ASSISTANT_PLAN.md). It wraps existing scoped code and never writes. */
export type IvyTool = {
  name: string;
  description: string;
  /** The input schema: the model is shown its JSON Schema, and every call is validated against it before anything runs. */
  schema: ZodType;
  /** What the panel shows while the tool runs, e.g. "Looking up deals". Takes the raw input, which may be invalid. */
  label: (raw: unknown) => string;
  /** Validates the raw input, runs the tool, and returns what the model reads (already size-capped). Throws ToolError on bad input. */
  run: (ctx: ToolContext, raw: unknown) => Promise<string>;
};

/** Builds a tool from a typed definition; the registry only ever sees the untyped, validating `run`. */
export function defineTool<I>(def: {
  name: string;
  description: string;
  schema: ZodType<I>;
  label: (input: I) => string;
  fallbackLabel: string;
  run: (ctx: ToolContext, input: I) => Promise<unknown>;
}): IvyTool {
  return {
    name: def.name,
    description: def.description,
    schema: def.schema,
    label: (raw) => {
      const parsed = def.schema.safeParse(raw);
      return parsed.success ? def.label(parsed.data) : def.fallbackLabel;
    },
    run: async (ctx, raw) => {
      const parsed = def.schema.safeParse(raw);
      if (!parsed.success) {
        const problems = parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
        throw new ToolError(`Invalid input for ${def.name}: ${problems}`);
      }
      return resultText(await def.run(ctx, parsed.data));
    },
  };
}
