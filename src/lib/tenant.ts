/**
 * The original business. The 20261028000000_tenants migration creates this tenant and every business table's
 * `tenantId` column defaults to it, so the app works unchanged until Phase 1 of MULTI_TENANCY_PLAN.md makes
 * queries and creates tenant-aware and removes the default.
 */
export const DEFAULT_TENANT_ID = "tenant_ivycandy";
