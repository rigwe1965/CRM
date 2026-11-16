import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import internals from "@prisma/internals";

/**
 * The full Prisma data model (every field with isRequired, hasDefaultValue, relationFromFields, ...), parsed from
 * prisma/schema.prisma. Prisma 7's runtime `Prisma.dmmf` keeps only names and types, which is not enough for the
 * tenant-schema checks, so the tests read the schema file through Prisma's own parser instead.
 */
const doc = await internals.getDMMF({ datamodel: readFileSync(resolve(__dirname, "../../prisma/schema.prisma"), "utf8") });

export const dmmfModels = doc.datamodel.models;
