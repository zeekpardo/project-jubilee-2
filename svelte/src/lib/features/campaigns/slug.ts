/**
 * Client-side twin of the server's slugify. It returns an empty string rather
 * than throwing, because it runs on every keystroke while the name is still
 * half-typed; the server stays the authority on what is acceptable.
 */
export function suggestSlug(value: string): string {
	return value
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
