-- Row-level security for "_DealToInvoice", Prisma's implicit many-to-many table between "Deal" and "Invoice".
--
-- It carries no "tenantId" (it holds only the two ids, "A" = deal, "B" = invoice), so it could not use the usual
-- tenant_isolation policy and was left open to the app role: a raw query could list links across businesses, and a
-- link between one business's deal and another's invoice could be written (a foreign key does not check that).
--
-- The policy instead requires that both ends are visible to the current business. "Deal" and "Invoice" are
-- themselves under row-level security, so the sub-selects see only the caller's own rows, and with
-- app.tenant_id missing or empty neither exists, so the table shows nothing (fails closed, like the others).
-- Neither of those policies refers back to this table, so there is no recursion. The grant given to crm_app by
-- 20261031000000_row_level_security already covers this table; the platform client owns it and is not bound.
--
-- Rollback:
--   DROP POLICY tenant_isolation ON "_DealToInvoice";
--   ALTER TABLE "_DealToInvoice" DISABLE ROW LEVEL SECURITY;

ALTER TABLE "_DealToInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "_DealToInvoice"
  USING (
    EXISTS (SELECT 1 FROM "Deal" d WHERE d."id" = "A")
    AND EXISTS (SELECT 1 FROM "Invoice" i WHERE i."id" = "B")
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM "Deal" d WHERE d."id" = "A")
    AND EXISTS (SELECT 1 FROM "Invoice" i WHERE i."id" = "B")
  );
