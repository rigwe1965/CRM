import type { PrismaClient } from "@prisma/client";

type Row = { bypass: boolean; owner: boolean };

/**
 * Row-level security only binds a database role that is neither a superuser, nor allowed to bypass it, nor the
 * owner of the tables. Returns a warning when the role the app connects as is one of those (every query would then
 * ignore the policies without any error), or null when the policies hold. Run once at server start in production.
 */
export async function rowLevelSecurityWarning(client: Pick<PrismaClient, "$queryRaw">): Promise<string | null> {
  const [row] = await client.$queryRaw<Row[]>`
    SELECT (r.rolsuper OR r.rolbypassrls) AS bypass,
           EXISTS (SELECT 1 FROM pg_tables t WHERE t.schemaname = current_schema() AND t.tablename = 'Contact' AND t.tableowner = current_user) AS owner
    FROM pg_roles r WHERE r.rolname = current_user`;
  if (!row) return "could not read the database role, so row-level security was not checked";
  if (row.bypass) return "DATABASE_URL connects as a role that bypasses row-level security (a superuser or BYPASSRLS role)";
  if (row.owner) return "DATABASE_URL connects as the owner of the tables, which row-level security does not bind";
  return null;
}
