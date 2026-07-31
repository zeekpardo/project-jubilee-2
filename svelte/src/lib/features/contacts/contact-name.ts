/**
 * Display name for a contact. Last name is optional, so mononyms and
 * organization contacts render without a trailing space.
 */
export function contactDisplayName(contact: {
	firstName: string;
	lastName?: string | null;
}): string {
	return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim();
}
