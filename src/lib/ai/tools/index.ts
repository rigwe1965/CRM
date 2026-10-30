import { z } from "zod";
import { stockLevels, salesReport } from "@/lib/ai/tools/business";
import { cashFlow, listOverdue, moneyChecks } from "@/lib/ai/tools/money";
import { draftMessage, proposeContact, proposeDeal, proposeNote, proposePayment, proposeStageChange, proposeTask, proposeTaskChange } from "@/lib/ai/tools/propose";
import { findContacts, findDeals, findInvoices, getContact, getDeal, listTasks } from "@/lib/ai/tools/records";
import type { IvyTool } from "@/lib/ai/tools/types";

export { ToolError } from "@/lib/ai/tools/types";
export type { IvyTool, ToolContext } from "@/lib/ai/tools/types";

/**
 * Every tool Ivy has, in a fixed order. The first eleven only read; the last eight (`PROPOSAL_TOOLS`) save a proposal for the
 * person to approve and change nothing themselves. The list and its schemas are part of the conversation's
 * identity: change them and `IVY_PROMPT_VERSION` (src/lib/ai/prompt.ts) must change too, so a test pins the two together.
 */
export const READ_TOOLS: readonly IvyTool[] = [findContacts, getContact, findDeals, getDeal, listOverdue, cashFlow, moneyChecks, stockLevels, salesReport, listTasks, findInvoices];
export const PROPOSAL_TOOLS: readonly IvyTool[] = [proposeTask, proposeTaskChange, proposeNote, proposeStageChange, draftMessage, proposePayment, proposeContact, proposeDeal];
export const IVY_TOOLS: readonly IvyTool[] = [...READ_TOOLS, ...PROPOSAL_TOOLS];

const byName = new Map(IVY_TOOLS.map((t) => [t.name, t]));
export const toolByName = (name: string) => byName.get(name);

/** The tools as the API wants them. Built once, so the bytes are identical on every request (prompt caching and thinking blocks depend on that). */
export const TOOL_DEFINITIONS = IVY_TOOLS.map((t) => {
  const { $schema: _omit, ...input_schema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<string, unknown>;
  void _omit;
  return { name: t.name, description: t.description, input_schema: input_schema as { type: "object" } & Record<string, unknown>, eager_input_streaming: true };
});
