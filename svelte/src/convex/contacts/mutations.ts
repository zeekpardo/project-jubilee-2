import { v } from 'convex/values';
import { mutation } from '../_generated/server';
import type { Doc } from '../_generated/dataModel';
import { requireOrgId } from '../model/auth';
import { deleteContactCascade } from '../model/cascade';
import {
	addBackgroundCheckModel,
	addContactAddressModel,
	addContactEmailModel,
	addContactPhoneModel,
	assertAuthUserAvailable,
	assertRemoteIdAvailable,
	contactLocationValidator,
	contactStatusValidator,
	createContactModel,
	deleteBackgroundCheckModel,
	deleteContactAddressModel,
	deleteContactEmailModel,
	deleteContactPhoneModel,
	phoneLocationValidator,
	preferredContactValidator,
	requireContact,
	setPrimaryContactAddressModel,
	setPrimaryContactEmailModel,
	setPrimaryContactPhoneModel,
	transparencyValidator,
	updateBackgroundCheckModel,
	updateContactAddressModel,
	updateContactEmailModel,
	updateContactPhoneModel,
	upsertPrimaryAddressModel,
	upsertPrimaryEmailModel,
	upsertPrimaryPhoneModel
} from '../model/contacts';

const contactFields = {
	firstName: v.string(),
	lastName: v.optional(v.string()),
	givenName: v.optional(v.string()),
	middleName: v.optional(v.string()),
	nickname: v.optional(v.string()),
	namePrefix: v.optional(v.string()),
	nameSuffix: v.optional(v.string()),
	publicFirstName: v.optional(v.string()),
	email: v.optional(v.string()),
	phone: v.optional(v.string()),
	organization: v.optional(v.string()),
	addressLine1: v.optional(v.string()),
	addressLine2: v.optional(v.string()),
	city: v.optional(v.string()),
	state: v.optional(v.string()),
	postalCode: v.optional(v.string()),
	country: v.optional(v.string()),
	notes: v.optional(v.string()),
	birthdate: v.optional(v.string()),
	anniversary: v.optional(v.string()),
	gender: v.optional(v.string()),
	child: v.optional(v.boolean()),
	grade: v.optional(v.number()),
	graduationYear: v.optional(v.number()),
	schoolName: v.optional(v.string()),
	schoolType: v.optional(v.string()),
	medicalNotes: v.optional(v.string()),
	maritalStatus: v.optional(v.string()),
	membership: v.optional(v.string()),
	status: v.optional(contactStatusValidator),
	inactiveReason: v.optional(v.string()),
	inactivatedOn: v.optional(v.string()),
	campus: v.optional(v.string()),
	avatarUrl: v.optional(v.string()),
	barcodes: v.optional(v.array(v.string())),
	remoteId: v.optional(v.string()),
	source: v.optional(v.string()),
	transparency: v.optional(transparencyValidator),
	preferredContact: v.optional(preferredContactValidator)
};

export const createContact = mutation({
	args: contactFields,
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		return await createContactModel(ctx, { ...args, orgId });
	}
});

// authUserId is deliberately absent — linking a portal login is its own
// mutation so the per-org uniqueness check can never be bypassed.
export const updateContact = mutation({
	args: {
		contactId: v.id('contacts'),
		...contactFields,
		// every field is optional on update
		firstName: v.optional(v.string()),
		// null clears these three, which a plain optional cannot express: the
		// patch loop below turns it into an unset field.
		status: v.optional(v.union(contactStatusValidator, v.null())),
		transparency: v.optional(v.union(transparencyValidator, v.null())),
		preferredContact: v.optional(v.union(preferredContactValidator, v.null()))
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		const {
			contactId,
			email,
			phone,
			addressLine1,
			addressLine2,
			city,
			state,
			postalCode,
			country,
			remoteId,
			...updates
		} = args;

		const patch: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(updates)) {
			if (value === undefined) continue;
			// These three are closed unions with no empty member, so choosing "None"
			// sends null. Patching undefined removes the field, which is what an
			// unset choice means; skipping it would silently keep the old value.
			if (value === null) {
				patch[key] = undefined;
				continue;
			}
			patch[key] = value;
		}

		if (remoteId !== undefined) {
			await assertRemoteIdAvailable(ctx, orgId, remoteId, contactId);
			patch.remoteId = remoteId;
		}

		await ctx.db.patch('contacts', contactId, patch as Partial<Doc<'contacts'>>);

		// email/phone/address* are a projection of the primary child row, so an
		// update to them upserts that row and re-derives the projection, rather
		// than ever patching contacts.email/phone/addressLine1... directly.
		if (email !== undefined) {
			await upsertPrimaryEmailModel(ctx, orgId, contactId, email);
		}
		if (phone !== undefined) {
			await upsertPrimaryPhoneModel(ctx, orgId, contactId, phone);
		}
		if (
			addressLine1 !== undefined ||
			addressLine2 !== undefined ||
			city !== undefined ||
			state !== undefined ||
			postalCode !== undefined ||
			country !== undefined
		) {
			await upsertPrimaryAddressModel(ctx, orgId, contactId, {
				line1: addressLine1,
				line2: addressLine2,
				city,
				state,
				postalCode,
				countryCode: country
			});
		}

		return contactId;
	}
});

export const linkAuthUser = mutation({
	args: {
		contactId: v.id('contacts'),
		authUserId: v.string()
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		await assertAuthUserAvailable(ctx, orgId, args.authUserId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { authUserId: args.authUserId });
		return args.contactId;
	}
});

export const unlinkAuthUser = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { authUserId: undefined });
		return args.contactId;
	}
});

export const markInvited = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await ctx.db.patch('contacts', args.contactId, { invitedAt: Date.now() });
		return args.contactId;
	}
});

export const deleteContact = mutation({
	args: {
		contactId: v.id('contacts')
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);

		await deleteContactCascade(ctx, args.contactId);
		return null;
	}
});

// --- Emails ------------------------------------------------------------

export const addContactEmail = mutation({
	args: {
		contactId: v.id('contacts'),
		address: v.string(),
		location: contactLocationValidator,
		isPrimary: v.optional(v.boolean()),
		blocked: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		return await addContactEmailModel(ctx, orgId, args);
	}
});

export const updateContactEmail = mutation({
	args: {
		emailId: v.id('contactEmails'),
		address: v.optional(v.string()),
		location: v.optional(contactLocationValidator),
		blocked: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const { emailId, ...updates } = args;
		await updateContactEmailModel(ctx, orgId, emailId, updates);
		return emailId;
	}
});

export const setPrimaryContactEmail = mutation({
	args: { emailId: v.id('contactEmails') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await setPrimaryContactEmailModel(ctx, orgId, args.emailId);
		return args.emailId;
	}
});

export const deleteContactEmail = mutation({
	args: { emailId: v.id('contactEmails') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await deleteContactEmailModel(ctx, orgId, args.emailId);
		return null;
	}
});

// --- Phones --------------------------------------------------------------

export const addContactPhone = mutation({
	args: {
		contactId: v.id('contacts'),
		number: v.string(),
		location: phoneLocationValidator,
		isPrimary: v.optional(v.boolean()),
		carrier: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		return await addContactPhoneModel(ctx, orgId, args);
	}
});

export const updateContactPhone = mutation({
	args: {
		phoneId: v.id('contactPhones'),
		number: v.optional(v.string()),
		location: v.optional(phoneLocationValidator),
		carrier: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const { phoneId, ...updates } = args;
		await updateContactPhoneModel(ctx, orgId, phoneId, updates);
		return phoneId;
	}
});

export const setPrimaryContactPhone = mutation({
	args: { phoneId: v.id('contactPhones') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await setPrimaryContactPhoneModel(ctx, orgId, args.phoneId);
		return args.phoneId;
	}
});

export const deleteContactPhone = mutation({
	args: { phoneId: v.id('contactPhones') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await deleteContactPhoneModel(ctx, orgId, args.phoneId);
		return null;
	}
});

// --- Addresses -------------------------------------------------------------

export const addContactAddress = mutation({
	args: {
		contactId: v.id('contacts'),
		line1: v.optional(v.string()),
		line2: v.optional(v.string()),
		city: v.optional(v.string()),
		state: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		countryCode: v.optional(v.string()),
		location: contactLocationValidator,
		isPrimary: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		return await addContactAddressModel(ctx, orgId, args);
	}
});

export const updateContactAddress = mutation({
	args: {
		addressId: v.id('contactAddresses'),
		line1: v.optional(v.string()),
		line2: v.optional(v.string()),
		city: v.optional(v.string()),
		state: v.optional(v.string()),
		postalCode: v.optional(v.string()),
		countryCode: v.optional(v.string()),
		location: v.optional(contactLocationValidator)
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const { addressId, ...updates } = args;
		await updateContactAddressModel(ctx, orgId, addressId, updates);
		return addressId;
	}
});

export const setPrimaryContactAddress = mutation({
	args: { addressId: v.id('contactAddresses') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await setPrimaryContactAddressModel(ctx, orgId, args.addressId);
		return args.addressId;
	}
});

export const deleteContactAddress = mutation({
	args: { addressId: v.id('contactAddresses') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await deleteContactAddressModel(ctx, orgId, args.addressId);
		return null;
	}
});

// --- Background checks -----------------------------------------------------

export const addBackgroundCheck = mutation({
	args: {
		contactId: v.id('contacts'),
		cleared: v.boolean(),
		completedOn: v.optional(v.string()),
		expiresOn: v.optional(v.string()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await requireContact(ctx, orgId, args.contactId);
		return await addBackgroundCheckModel(ctx, orgId, args);
	}
});

export const updateBackgroundCheck = mutation({
	args: {
		checkId: v.id('contactBackgroundChecks'),
		cleared: v.optional(v.boolean()),
		completedOn: v.optional(v.string()),
		expiresOn: v.optional(v.string()),
		note: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		const { checkId, ...updates } = args;
		await updateBackgroundCheckModel(ctx, orgId, checkId, updates);
		return checkId;
	}
});

export const deleteBackgroundCheck = mutation({
	args: { checkId: v.id('contactBackgroundChecks') },
	handler: async (ctx, args) => {
		const orgId = await requireOrgId(ctx);
		await deleteBackgroundCheckModel(ctx, orgId, args.checkId);
		return null;
	}
});
