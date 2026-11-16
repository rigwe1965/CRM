/**
 * Which Claude models a business may choose for AI. A fixed list, never free text: each entry has a known price (the
 * spending ceiling depends on it) and has been checked against Anthropic's Models API for what the CRM sends (images,
 * PDFs, tools, and the effort setting). The default is the model AI has always used, so a business that never opens
 * this setting sees no change.
 */
export const DEFAULT_MODEL = "claude-sonnet-5-5";

/** Anthropic's server-side fallback for requests its safety classifiers decline; needs this beta header. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** Effort starts low (Anthropic's suggestion for chat); the eval set tells us if it should rise. */
export const IVY_EFFORT = "low" as const;

export type ModelOption = {
  id: string;
  label: string;
  /** One plain sentence for the settings screen. */
  blurb: string;
  /** Whether Anthropic's server-side fallback may be requested with this model as the first choice (the Models API reports it per model). */
  fallback: boolean;
};

export const MODEL_OPTIONS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", blurb: "Fastest and cheapest. Good for everyday questions and simple documents.", fallback: false },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", blurb: "Balanced speed, quality and cost. The standard choice.", fallback: true },
  { id: "claude-opus-5-5", label: "Opus 5.5", blurb: "Most capable, for difficult questions and messy documents. Costs about twice as much as Sonnet.", fallback: true },
] as const satisfies readonly ModelOption[];

export type SelectableModel = (typeof MODEL_OPTIONS)[number]["id"];
export const SELECTABLE_MODEL_IDS = MODEL_OPTIONS.map((m) => m.id) as [SelectableModel, ...SelectableModel[]];

export function isSelectableModel(id: unknown): id is SelectableModel {
  return typeof id === "string" && MODEL_OPTIONS.some((m) => m.id === id);
}

/** A stored or requested model that is not on the list means "the default", never a model we cannot price. */
export function resolveModel(id: unknown): SelectableModel {
  return isSelectableModel(id) ? id : DEFAULT_MODEL;
}

/**
 * The model-dependent part of every request: the model, its effort, and the server-side fallback only for models
 * that accept it (sending it to one that does not would fail the whole request). Every call to Anthropic spreads this.
 */
export function modelFields(model: unknown = DEFAULT_MODEL) {
  const id = resolveModel(model);
  const option = MODEL_OPTIONS.find((m) => m.id === id)!;
  const base = { model: id as string, output_config: { effort: IVY_EFFORT } };
  return option.fallback ? { ...base, betas: [FALLBACK_BETA], fallbacks: "default" as const } : { ...base, betas: undefined, fallbacks: undefined };
}
