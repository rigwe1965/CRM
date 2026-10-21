import type { ExportEntity } from "@/lib/export/define";
import { AREA_EXPORTS } from "@/lib/export/entities";
import { ADMIN_EXPORTS } from "@/lib/export/admin-entities";

/** Everything that can be exported, by URL name. */
export const EXPORTS: Readonly<Record<string, ExportEntity>> = { ...AREA_EXPORTS, ...ADMIN_EXPORTS };

/** Own keys only, so "constructor" or "__proto__" in the URL can't resolve to something. */
export const findExport = (key: string): ExportEntity | undefined =>
  Object.prototype.hasOwnProperty.call(EXPORTS, key) ? EXPORTS[key] : undefined;
