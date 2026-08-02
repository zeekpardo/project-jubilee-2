import { ConvexError, v } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export const contactLocationValidator = v.union(
	v.literal('home'),
	v.literal('work'),
	v.literal('other')
);

export const phoneLocationValidator = v.union(contactLocationValidator, v.literal('mobile'));

export const contactStatusValidator = v.union(v.literal('active'), v.literal('inactive'));

export const updateDetailValidator = v.union(v.literal('summary'), v.literal('full'));

export const preferredContactValidator = v.union(
	v.literal('email'),
	v.literal('mail'),
	v.literal('phone')
);

export type CreateContactInput = {
	orgId: string;
	firstName: string;
	lastName?: string;
	givenName?: string;
	middleName?: string;
	nickname?: string;
	namePrefix?: string;
	nameSuffix?: string;
	publicFirstName?: string;
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
	birthdate?: string;
	anniversary?: string;
	gender?: string;
	child?: boolean;
	grade?: number;
	graduationYear?: number;
	schoolName?: string;
	schoolType?: string;
	medicalNotes?: string;
	maritalStatus?: string;
	membership?: string;
	status?: 'active' | 'inactive';
	inactiveReason?: string;
	inactivatedOn?: string;
	campus?: string;
	avatarUrl?: string;
	barcodes?: string[];
	remoteId?: string;
	authUserId?: string;
	source?: string;
	updateDetail?: 'summary' | 'full';
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

export async function assertRemoteIdAvailable(
	ctx: QueryCtx,
	orgId: string,
	remoteId: string,
	excludeContactId?: Id<'contacts'>
): Promise<void> {
	const existing = await ctx.db
		.query('contacts')
		.withIndex('by_orgId_and_remoteId', (q) => q.eq('orgId', orgId).eq('remoteId', remoteId))
		.collect();
	if (existing.some((contact) => contact._id !== excludeContactId)) {
		throw new ConvexError(`Remote id already linked to a contact: ${remoteId}`);
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
 *
 * Also seeds the primary child rows (email/phone/address) so
 * contacts.email/phone/address* are a consistent projection from birth,
 * rather than a contact that exists for one tick with no primary row backing
 * its own scalar fields.
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
	if (input.remoteId !== undefined) {
		await assertRemoteIdAvailable(ctx, input.orgId, input.remoteId);
	}

	const contactId = await ctx.db.insert('contacts', {
		orgId: input.orgId,
		firstName: input.firstName,
		lastName: input.lastName,
		givenName: input.givenName,
		middleName: input.middleName,
		nickname: input.nickname,
		namePrefix: input.namePrefix,
		nameSuffix: input.nameSuffix,
		publicFirstName: input.publicFirstName,
		email,
		emailLower,
		phone: input.phone,
		addressLine1: input.addressLine1,
		addressLine2: input.addressLine2,
		city: input.city,
		state: input.state,
		postalCode: input.postalCode,
		country: input.country,
		organization: input.organization,
		notes: input.notes,
		birthdate: input.birthdate,
		anniversary: input.anniversary,
		gender: input.gender,
		child: input.child,
		grade: input.grade,
		graduationYear: input.graduationYear,
		schoolName: input.schoolName,
		schoolType: input.schoolType,
		medicalNotes: input.medicalNotes,
		maritalStatus: input.maritalStatus,
		membership: input.membership,
		status: input.status,
		inactiveReason: input.inactiveReason,
		inactivatedOn: input.inactivatedOn,
		campus: input.campus,
		avatarUrl: input.avatarUrl,
		barcodes: input.barcodes,
		remoteId: input.remoteId,
		authUserId: input.authUserId,
		source: input.source,
		customFields: {},
		updateDetail: input.updateDetail,
		preferredContact: input.preferredContact
	});

	if (email !== undefined) {
		await ctx.db.insert('contactEmails', {
			orgId: input.orgId,
			contactId,
			address: email,
			addressLower: emailLower!,
			location: 'home',
			isPrimary: true
		});
	}

	if (input.phone !== undefined) {
		await ctx.db.insert('contactPhones', {
			orgId: input.orgId,
			contactId,
			number: input.phone,
			location: 'mobile',
			isPrimary: true
		});
	}

	const hasAddress = [
		input.addressLine1,
		input.addressLine2,
		input.city,
		input.state,
		input.postalCode,
		input.country
	].some((field) => field !== undefined);
	if (hasAddress) {
		await ctx.db.insert('contactAddresses', {
			orgId: input.orgId,
			contactId,
			line1: input.addressLine1,
			line2: input.addressLine2,
			city: input.city,
			state: input.state,
			postalCode: input.postalCode,
			countryCode: input.country,
			location: 'home',
			isPrimary: true
		});
	}

	return contactId;
}

// --- Emails ------------------------------------------------------------

/**
 * Backs `updateContact`'s `email` argument: upserts the primary contactEmails
 * row and re-derives the projection, so contacts.email/emailLower are never
 * patched directly outside this file. An empty/absent email deletes the
 * primary row, mirroring the old behaviour where an empty string cleared
 * both projected fields.
 */
export async function upsertPrimaryEmailModel(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>,
	email: string | undefined
): Promise<void> {
	const fields = emailFields(email);
	const rows = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);

	if (fields.emailLower === undefined) {
		if (primary) {
			await deleteContactEmailModel(ctx, orgId, primary._id);
		}
		return;
	}

	await assertContactEmailAvailable(ctx, contactId, fields.emailLower, primary?._id);
	await assertEmailAvailable(ctx, orgId, fields.emailLower, contactId);

	if (primary) {
		await ctx.db.patch('contactEmails', primary._id, {
			address: fields.email,
			addressLower: fields.emailLower
		});
	} else {
		await ctx.db.insert('contactEmails', {
			orgId,
			contactId,
			address: fields.email!,
			addressLower: fields.emailLower,
			location: 'home',
			isPrimary: true
		});
	}
	await syncPrimaryEmail(ctx, contactId);
}

async function syncPrimaryEmail(ctx: MutationCtx, contactId: Id<'contacts'>): Promise<void> {
	const rows = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);
	await ctx.db.patch('contacts', contactId, {
		email: primary?.address,
		emailLower: primary?.addressLower
	});
}

export async function assertContactEmailAvailable(
	ctx: QueryCtx,
	contactId: Id<'contacts'>,
	addressLower: string,
	excludeEmailId?: Id<'contactEmails'>
): Promise<void> {
	const existing = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId_and_addressLower', (q) =>
			q.eq('contactId', contactId).eq('addressLower', addressLower)
		)
		.collect();
	if (existing.some((row) => row._id !== excludeEmailId)) {
		throw new ConvexError(`Email already on this contact: ${addressLower}`);
	}
}

export async function requireContactEmail(
	ctx: QueryCtx,
	orgId: string,
	emailId: Id<'contactEmails'>
): Promise<Doc<'contactEmails'>> {
	const email = await ctx.db.get('contactEmails', emailId);
	if (!email || email.orgId !== orgId) {
		throw new ConvexError('Email not found');
	}
	return email;
}

export async function addContactEmailModel(
	ctx: MutationCtx,
	orgId: string,
	input: {
		contactId: Id<'contacts'>;
		address: string;
		location: 'home' | 'work' | 'other';
		isPrimary?: boolean;
		blocked?: boolean;
	}
): Promise<Id<'contactEmails'>> {
	const fields = emailFields(input.address);
	if (fields.emailLower === undefined) {
		throw new ConvexError('Email address is required');
	}
	await assertContactEmailAvailable(ctx, input.contactId, fields.emailLower);

	const existingRows = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', input.contactId))
		.collect();
	// The first email on a contact is always primary — an email row can never
	// exist with nothing backing the projection.
	const isPrimary = input.isPrimary === true || existingRows.length === 0;

	if (isPrimary) {
		await assertEmailAvailable(ctx, orgId, fields.emailLower, input.contactId);
		for (const row of existingRows) {
			if (row.isPrimary) {
				await ctx.db.patch('contactEmails', row._id, { isPrimary: false });
			}
		}
	}

	const emailId = await ctx.db.insert('contactEmails', {
		orgId,
		contactId: input.contactId,
		address: fields.email!,
		addressLower: fields.emailLower,
		location: input.location,
		isPrimary,
		blocked: input.blocked
	});

	if (isPrimary) {
		await syncPrimaryEmail(ctx, input.contactId);
	}

	return emailId;
}

export async function updateContactEmailModel(
	ctx: MutationCtx,
	orgId: string,
	emailId: Id<'contactEmails'>,
	updates: { address?: string; location?: 'home' | 'work' | 'other'; blocked?: boolean }
): Promise<void> {
	const email = await requireContactEmail(ctx, orgId, emailId);

	const patch: Partial<Doc<'contactEmails'>> = {};
	if (updates.location !== undefined) {
		patch.location = updates.location;
	}
	if (updates.blocked !== undefined) {
		patch.blocked = updates.blocked;
	}

	if (updates.address !== undefined) {
		const fields = emailFields(updates.address);
		if (fields.emailLower === undefined) {
			throw new ConvexError('Email address is required');
		}
		await assertContactEmailAvailable(ctx, email.contactId, fields.emailLower, emailId);
		if (email.isPrimary) {
			await assertEmailAvailable(ctx, orgId, fields.emailLower, email.contactId);
		}
		patch.address = fields.email;
		patch.addressLower = fields.emailLower;
	}

	await ctx.db.patch('contactEmails', emailId, patch);

	if (email.isPrimary && updates.address !== undefined) {
		await syncPrimaryEmail(ctx, email.contactId);
	}
}

export async function setPrimaryContactEmailModel(
	ctx: MutationCtx,
	orgId: string,
	emailId: Id<'contactEmails'>
): Promise<void> {
	const email = await requireContactEmail(ctx, orgId, emailId);
	if (email.isPrimary) {
		return;
	}

	await assertEmailAvailable(ctx, orgId, email.addressLower, email.contactId);

	const rows = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', email.contactId))
		.collect();
	for (const row of rows) {
		if (row._id !== emailId && row.isPrimary) {
			await ctx.db.patch('contactEmails', row._id, { isPrimary: false });
		}
	}
	await ctx.db.patch('contactEmails', emailId, { isPrimary: true });
	await syncPrimaryEmail(ctx, email.contactId);
}

export async function deleteContactEmailModel(
	ctx: MutationCtx,
	orgId: string,
	emailId: Id<'contactEmails'>
): Promise<void> {
	const email = await requireContactEmail(ctx, orgId, emailId);
	await ctx.db.delete('contactEmails', emailId);
	if (!email.isPrimary) {
		return;
	}

	// Deleting the primary promotes the oldest remaining row, or clears the
	// projection if this was the contact's last email.
	const remaining = await ctx.db
		.query('contactEmails')
		.withIndex('by_contactId', (q) => q.eq('contactId', email.contactId))
		.collect();
	if (remaining.length > 0) {
		const oldest = remaining.reduce((a, b) => (a._creationTime < b._creationTime ? a : b));
		await ctx.db.patch('contactEmails', oldest._id, { isPrimary: true });
	}
	await syncPrimaryEmail(ctx, email.contactId);
}

// --- Phones --------------------------------------------------------------

/** Backs `updateContact`'s `phone` argument — same discipline as email. */
export async function upsertPrimaryPhoneModel(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>,
	number: string | undefined
): Promise<void> {
	const rows = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);

	if (number === undefined || number === '') {
		if (primary) {
			await deleteContactPhoneModel(ctx, orgId, primary._id);
		}
		return;
	}

	if (primary) {
		await ctx.db.patch('contactPhones', primary._id, { number });
	} else {
		await ctx.db.insert('contactPhones', {
			orgId,
			contactId,
			number,
			location: 'mobile',
			isPrimary: true
		});
	}
	await syncPrimaryPhone(ctx, contactId);
}

async function syncPrimaryPhone(ctx: MutationCtx, contactId: Id<'contacts'>): Promise<void> {
	const rows = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);
	await ctx.db.patch('contacts', contactId, { phone: primary?.number });
}

export async function requireContactPhone(
	ctx: QueryCtx,
	orgId: string,
	phoneId: Id<'contactPhones'>
): Promise<Doc<'contactPhones'>> {
	const phone = await ctx.db.get('contactPhones', phoneId);
	if (!phone || phone.orgId !== orgId) {
		throw new ConvexError('Phone not found');
	}
	return phone;
}

export async function addContactPhoneModel(
	ctx: MutationCtx,
	orgId: string,
	input: {
		contactId: Id<'contacts'>;
		number: string;
		location: 'home' | 'work' | 'other' | 'mobile';
		isPrimary?: boolean;
		carrier?: string;
	}
): Promise<Id<'contactPhones'>> {
	const existingRows = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', input.contactId))
		.collect();
	const isPrimary = input.isPrimary === true || existingRows.length === 0;

	if (isPrimary) {
		for (const row of existingRows) {
			if (row.isPrimary) {
				await ctx.db.patch('contactPhones', row._id, { isPrimary: false });
			}
		}
	}

	const phoneId = await ctx.db.insert('contactPhones', {
		orgId,
		contactId: input.contactId,
		number: input.number,
		location: input.location,
		isPrimary,
		carrier: input.carrier
	});

	if (isPrimary) {
		await syncPrimaryPhone(ctx, input.contactId);
	}

	return phoneId;
}

export async function updateContactPhoneModel(
	ctx: MutationCtx,
	orgId: string,
	phoneId: Id<'contactPhones'>,
	updates: { number?: string; location?: 'home' | 'work' | 'other' | 'mobile'; carrier?: string }
): Promise<void> {
	const phone = await requireContactPhone(ctx, orgId, phoneId);

	const patch: Partial<Doc<'contactPhones'>> = {};
	if (updates.number !== undefined) {
		patch.number = updates.number;
	}
	if (updates.location !== undefined) {
		patch.location = updates.location;
	}
	if (updates.carrier !== undefined) {
		patch.carrier = updates.carrier;
	}

	await ctx.db.patch('contactPhones', phoneId, patch);

	if (phone.isPrimary && updates.number !== undefined) {
		await syncPrimaryPhone(ctx, phone.contactId);
	}
}

export async function setPrimaryContactPhoneModel(
	ctx: MutationCtx,
	orgId: string,
	phoneId: Id<'contactPhones'>
): Promise<void> {
	const phone = await requireContactPhone(ctx, orgId, phoneId);
	if (phone.isPrimary) {
		return;
	}

	const rows = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', phone.contactId))
		.collect();
	for (const row of rows) {
		if (row._id !== phoneId && row.isPrimary) {
			await ctx.db.patch('contactPhones', row._id, { isPrimary: false });
		}
	}
	await ctx.db.patch('contactPhones', phoneId, { isPrimary: true });
	await syncPrimaryPhone(ctx, phone.contactId);
}

export async function deleteContactPhoneModel(
	ctx: MutationCtx,
	orgId: string,
	phoneId: Id<'contactPhones'>
): Promise<void> {
	const phone = await requireContactPhone(ctx, orgId, phoneId);
	await ctx.db.delete('contactPhones', phoneId);
	if (!phone.isPrimary) {
		return;
	}

	const remaining = await ctx.db
		.query('contactPhones')
		.withIndex('by_contactId', (q) => q.eq('contactId', phone.contactId))
		.collect();
	if (remaining.length > 0) {
		const oldest = remaining.reduce((a, b) => (a._creationTime < b._creationTime ? a : b));
		await ctx.db.patch('contactPhones', oldest._id, { isPrimary: true });
	}
	await syncPrimaryPhone(ctx, phone.contactId);
}

// --- Addresses -------------------------------------------------------------

type ContactAddressFields = {
	line1?: string;
	line2?: string;
	city?: string;
	state?: string;
	postalCode?: string;
	countryCode?: string;
};

/**
 * Backs `updateContact`'s addressLine1/addressLine2/city/state/postalCode/
 * country arguments — same discipline as email/phone, but per-field: any
 * field left undefined is simply left alone on the primary row rather than
 * cleared, matching the rest of updateContact's partial-patch semantics.
 */
export async function upsertPrimaryAddressModel(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>,
	fields: ContactAddressFields
): Promise<void> {
	const rows = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);

	const patch: Partial<Doc<'contactAddresses'>> = {};
	if (fields.line1 !== undefined) patch.line1 = fields.line1;
	if (fields.line2 !== undefined) patch.line2 = fields.line2;
	if (fields.city !== undefined) patch.city = fields.city;
	if (fields.state !== undefined) patch.state = fields.state;
	if (fields.postalCode !== undefined) patch.postalCode = fields.postalCode;
	if (fields.countryCode !== undefined) patch.countryCode = fields.countryCode;

	if (primary) {
		await ctx.db.patch('contactAddresses', primary._id, patch);
	} else {
		await ctx.db.insert('contactAddresses', {
			orgId,
			contactId,
			...patch,
			location: 'home',
			isPrimary: true
		});
	}
	await syncPrimaryAddress(ctx, contactId);
}

async function syncPrimaryAddress(ctx: MutationCtx, contactId: Id<'contacts'>): Promise<void> {
	const rows = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const primary = rows.find((row) => row.isPrimary);
	await ctx.db.patch('contacts', contactId, {
		addressLine1: primary?.line1,
		addressLine2: primary?.line2,
		city: primary?.city,
		state: primary?.state,
		postalCode: primary?.postalCode,
		country: primary?.countryCode
	});
}

export async function requireContactAddress(
	ctx: QueryCtx,
	orgId: string,
	addressId: Id<'contactAddresses'>
): Promise<Doc<'contactAddresses'>> {
	const address = await ctx.db.get('contactAddresses', addressId);
	if (!address || address.orgId !== orgId) {
		throw new ConvexError('Address not found');
	}
	return address;
}

export async function addContactAddressModel(
	ctx: MutationCtx,
	orgId: string,
	input: ContactAddressFields & {
		contactId: Id<'contacts'>;
		location: 'home' | 'work' | 'other';
		isPrimary?: boolean;
	}
): Promise<Id<'contactAddresses'>> {
	const existingRows = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', input.contactId))
		.collect();
	const isPrimary = input.isPrimary === true || existingRows.length === 0;

	if (isPrimary) {
		for (const row of existingRows) {
			if (row.isPrimary) {
				await ctx.db.patch('contactAddresses', row._id, { isPrimary: false });
			}
		}
	}

	const addressId = await ctx.db.insert('contactAddresses', {
		orgId,
		contactId: input.contactId,
		line1: input.line1,
		line2: input.line2,
		city: input.city,
		state: input.state,
		postalCode: input.postalCode,
		countryCode: input.countryCode,
		location: input.location,
		isPrimary
	});

	if (isPrimary) {
		await syncPrimaryAddress(ctx, input.contactId);
	}

	return addressId;
}

export async function updateContactAddressModel(
	ctx: MutationCtx,
	orgId: string,
	addressId: Id<'contactAddresses'>,
	updates: ContactAddressFields & { location?: 'home' | 'work' | 'other' }
): Promise<void> {
	const address = await requireContactAddress(ctx, orgId, addressId);

	const patch: Partial<Doc<'contactAddresses'>> = {};
	if (updates.line1 !== undefined) patch.line1 = updates.line1;
	if (updates.line2 !== undefined) patch.line2 = updates.line2;
	if (updates.city !== undefined) patch.city = updates.city;
	if (updates.state !== undefined) patch.state = updates.state;
	if (updates.postalCode !== undefined) patch.postalCode = updates.postalCode;
	if (updates.countryCode !== undefined) patch.countryCode = updates.countryCode;
	if (updates.location !== undefined) patch.location = updates.location;

	await ctx.db.patch('contactAddresses', addressId, patch);

	const changedProjectedField =
		updates.line1 !== undefined ||
		updates.line2 !== undefined ||
		updates.city !== undefined ||
		updates.state !== undefined ||
		updates.postalCode !== undefined ||
		updates.countryCode !== undefined;
	if (address.isPrimary && changedProjectedField) {
		await syncPrimaryAddress(ctx, address.contactId);
	}
}

export async function setPrimaryContactAddressModel(
	ctx: MutationCtx,
	orgId: string,
	addressId: Id<'contactAddresses'>
): Promise<void> {
	const address = await requireContactAddress(ctx, orgId, addressId);
	if (address.isPrimary) {
		return;
	}

	const rows = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', address.contactId))
		.collect();
	for (const row of rows) {
		if (row._id !== addressId && row.isPrimary) {
			await ctx.db.patch('contactAddresses', row._id, { isPrimary: false });
		}
	}
	await ctx.db.patch('contactAddresses', addressId, { isPrimary: true });
	await syncPrimaryAddress(ctx, address.contactId);
}

export async function deleteContactAddressModel(
	ctx: MutationCtx,
	orgId: string,
	addressId: Id<'contactAddresses'>
): Promise<void> {
	const address = await requireContactAddress(ctx, orgId, addressId);
	await ctx.db.delete('contactAddresses', addressId);
	if (!address.isPrimary) {
		return;
	}

	const remaining = await ctx.db
		.query('contactAddresses')
		.withIndex('by_contactId', (q) => q.eq('contactId', address.contactId))
		.collect();
	if (remaining.length > 0) {
		const oldest = remaining.reduce((a, b) => (a._creationTime < b._creationTime ? a : b));
		await ctx.db.patch('contactAddresses', oldest._id, { isPrimary: true });
	}
	await syncPrimaryAddress(ctx, address.contactId);
}

// --- Background checks -----------------------------------------------------

/** ISO YYYY-MM-DD for "today", matching every other date in this schema. */
function todayIso(): string {
	return new Date().toISOString().slice(0, 10);
}

async function syncBackgroundCheck(ctx: MutationCtx, contactId: Id<'contacts'>): Promise<void> {
	const rows = await ctx.db
		.query('contactBackgroundChecks')
		.withIndex('by_contactId', (q) => q.eq('contactId', contactId))
		.collect();
	const today = todayIso();
	const passed = rows.some(
		(row) => row.cleared && (row.expiresOn === undefined || row.expiresOn >= today)
	);
	await ctx.db.patch('contacts', contactId, { passedBackgroundCheck: passed });
}

export async function requireBackgroundCheck(
	ctx: QueryCtx,
	orgId: string,
	checkId: Id<'contactBackgroundChecks'>
): Promise<Doc<'contactBackgroundChecks'>> {
	const check = await ctx.db.get('contactBackgroundChecks', checkId);
	if (!check || check.orgId !== orgId) {
		throw new ConvexError('Background check not found');
	}
	return check;
}

export async function addBackgroundCheckModel(
	ctx: MutationCtx,
	orgId: string,
	input: {
		contactId: Id<'contacts'>;
		cleared: boolean;
		completedOn?: string;
		expiresOn?: string;
		note?: string;
	}
): Promise<Id<'contactBackgroundChecks'>> {
	const checkId = await ctx.db.insert('contactBackgroundChecks', {
		orgId,
		contactId: input.contactId,
		cleared: input.cleared,
		completedOn: input.completedOn,
		expiresOn: input.expiresOn,
		note: input.note
	});
	await syncBackgroundCheck(ctx, input.contactId);
	return checkId;
}

export async function updateBackgroundCheckModel(
	ctx: MutationCtx,
	orgId: string,
	checkId: Id<'contactBackgroundChecks'>,
	updates: { cleared?: boolean; completedOn?: string; expiresOn?: string; note?: string }
): Promise<void> {
	const check = await requireBackgroundCheck(ctx, orgId, checkId);

	const patch: Partial<Doc<'contactBackgroundChecks'>> = {};
	if (updates.cleared !== undefined) patch.cleared = updates.cleared;
	if (updates.completedOn !== undefined) patch.completedOn = updates.completedOn;
	if (updates.expiresOn !== undefined) patch.expiresOn = updates.expiresOn;
	if (updates.note !== undefined) patch.note = updates.note;

	await ctx.db.patch('contactBackgroundChecks', checkId, patch);
	await syncBackgroundCheck(ctx, check.contactId);
}

export async function deleteBackgroundCheckModel(
	ctx: MutationCtx,
	orgId: string,
	checkId: Id<'contactBackgroundChecks'>
): Promise<void> {
	const check = await requireBackgroundCheck(ctx, orgId, checkId);
	await ctx.db.delete('contactBackgroundChecks', checkId);
	await syncBackgroundCheck(ctx, check.contactId);
}
