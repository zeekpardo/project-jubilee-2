/**
 * Path to a campaign's public landing page. Null until the org's public site
 * slug has loaded — there is no address to show before that, and objectSlug
 * is frozen at campaign creation so it is always available once the campaign
 * itself has loaded.
 */
export function campaignPublicPath(
	orgSlug: string | null | undefined,
	campaignSlug: string,
	objectSlug: string
): string | null {
	return orgSlug ? `/${orgSlug}/${campaignSlug}/${objectSlug}` : null;
}
