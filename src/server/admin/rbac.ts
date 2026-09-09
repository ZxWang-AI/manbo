import type { AdminPrincipal } from "@/domain/admin-review";

/**
 * Resolves an administrator from a deployment-managed identity provider.
 * Implementations must validate a signed OIDC/SSO assertion; request headers
 * and URL parameters are intentionally not accepted as identity sources.
 */
export interface AdminIdentityResolver {
  resolve(request: Request): Promise<AdminPrincipal | null>;
}

export const unavailableAdminIdentityResolver: AdminIdentityResolver = {
  async resolve(): Promise<AdminPrincipal | null> {
    return null;
  },
};
