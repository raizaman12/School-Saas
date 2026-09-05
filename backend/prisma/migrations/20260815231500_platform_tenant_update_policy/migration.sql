-- Day 10: platform admin (SUPER_ADMIN) needs to update ANY tenant's
-- status/plan while operating in "platform context" (app.tenant_id unset,
-- exactly like a SUPER_ADMIN's JWT — tenantId: null — already produces via
-- runWithTenant(null, ...)). The existing "tenants_update_self" policy only
-- allows a tenant to update its own row; this adds a second permissive
-- policy (permissive policies are OR'd together by Postgres) that opens
-- UPDATE specifically for the platform-context case, without loosening
-- anything for ordinary tenant-scoped connections.
CREATE POLICY "tenants_update_platform" ON "tenants"
  FOR UPDATE
  USING (NULLIF(current_setting('app.tenant_id', true), '') IS NULL)
  WITH CHECK (NULLIF(current_setting('app.tenant_id', true), '') IS NULL);
