import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export const transparencyValidator = v.union(v.literal('summary'), v.literal('full'));

export const preferredContactValidator = v.union(
	v.literal('email'),
	v.literal('mail'),
	v.literal('phone')
);

export type CreateContactInput = {
	orgId: string;
	name: string;
	email?: string;
	phone?: string;
	organization?: string;
	addressLine1?: string;
	addressLine2?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	country?: string;
	notes?: string;
	authUserId?: string;
	source?: string;
	transparency?: 'summary' | 'full';
	preferredContact?: 'email' | 'mail' | 'phone';
};

/** Trimmed + lowercased, or undefined when there is no email to store. */
export function normalizeEmail(email?: string): string | undefined {
	const normalized = email?.trim().toLowerCase();
	return normalized === undefined || normalized === '' ? undefined : normalized;
}

/**
 * `email` and `emailLower` are only ever written through this helper, so the
 * display value and the dedup key can never drift apart.
 */
export function emailFields(email?: string): {
	email: string | undefined;
	emailLower: string | undefined;
} {
	const emailLower = normalizeEmail(email);
	return emailLower === undefined
		? { email: undefined, emailLower: undefined }
		: { email: email!.trim(), emailLower };
}

export async function assertEmailAvailable(
	ctx: QueryCtx,
	orgId: string,
	emailLower: string | undefined,
	excludeContactId?: Id<'contacts'>
): Promise<void> {
	if (emailLower === undefined) {
		return;
	}

	const existing = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_emailLower', (q) => q.eq('orgId', orgId).eq('emailLower', emailLower))
		.collect();
	if (existing.some((contact) => contact._id !== excludeContactId)) {
		throw new ConvexError(`Email already in use: ${emailLower}`);
	}
}

export async function assertAuthUserAvailable(
	ctx: QueryCtx,
	orgId: string,
	authUserId: string,
	excludeContactId?: Id<'contacts'>
): Promise<void> {
	const existing = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_authUserId', (q) => q.eq('orgId', orgId).eq('authUserId', authUserId))
		.collect();
	if (existing.some((contact) => contact._id !== excludeContactId)) {
		throw new ConvexError(`Auth user already linked to a contact: ${authUserId}`);
	}
}

export async function requireContact(
	ctx: QueryCtx,
	orgId: string,
	contactId: Id<'contacts'>
): Promise<Doc<'contacts'>> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
	return contact;
}

/**
 * Creates a contact in the caller's org. Shared by the authed mutation and any
 * seed, so both produce an identically-defaulted, deduped row.
 */
export async function createContactModel(
	ctx: MutationCtx,
	input: CreateContactInput
): Promise<Id<'contacts'>> {
	const { email, emailLower } = emailFields(input.email);
	await assertEmailAvailable(ctx, input.orgId, emailLower);
	if (input.authUserId !== undefined) {
		await assertAuthUserAvailable(ctx, input.orgId, input.authUserId);
	}

	return await ctx.db.insert('contacts', {
		orgId: input.orgId,
		name: input.name,
		email,
		emailLower,
		phone: input.phone,
		organization: input.organization,
		addressLine1: input.addressLine1,
		addressLine2: input.addressLine2,
		city: input.city,
		state: input.state,
		postalCode: input.postalCode,
		country: input.country,
		notes: input.notes,
		authUserId: input.authUserId,
		source: input.source,
		transparency: input.transparency,
		preferredContact: input.preferredContact,
		customFields: {}
	});
}
