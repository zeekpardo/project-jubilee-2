import { ConvexError, v } from 'convex/values';
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export const householdRoleValidator = v.union(
	v.literal('parent_guardian'),
	v.literal('adult'),
	v.literal('other_adult'),
	v.literal('child')
);

export const projectMemberRoleValidator = v.string();

export const memberAttributesValidator = v.record(
	v.string(),
	v.union(v.string(), v.number(), v.boolean(), v.null())
);

export type MemberAttributes = Record<string, string | number | boolean | null>;

export async function requireHousehold(
	ctx: MutationCtx,
	orgId: string,
	householdId: Id<'households'>
): Promise<Doc<'households'>> {
	const household = await ctx.db.get('households', householdId);
	if (!household || household.orgId !== orgId) {
		throw new ConvexError('Household not found');
	}
	return household;
}

export async function requireProject(
	ctx: MutationCtx,
	orgId: string,
	projectId: Id<'projects'>
): Promise<Doc<'projects'>> {
	const project = await ctx.db.get('projects', projectId);
	if (!project || project.orgId !== orgId) {
		throw new ConvexError('Project not found');
	}
	return project;
}

export async function requireContact(
	ctx: MutationCtx,
	orgId: string,
	contactId: Id<'contacts'>
): Promise<Doc<'contacts'>> {
	const contact = await ctx.db.get('contacts', contactId);
	if (!contact || contact.orgId !== orgId) {
		throw new ConvexError('Contact not found');
	}
	return contact;
}

// unique(householdId, contactId) — Convex has no unique constraints.
export async function assertHouseholdMemberUnique(
	ctx: MutationCtx,
	householdId: Id<'households'>,
	contactId: Id<'contacts'>
): Promise<void> {
	const existing = await ctx.db
		.query('householdMembers')
		.withIndex('by_householdId_and_contactId', (q) =>
			q.eq('householdId', householdId).eq('contactId', contactId)
		)
		.first();
	if (existing) {
		throw new ConvexError('Contact is already a member of this household');
	}
}

// unique(projectId, contactId) — Convex has no unique constraints.
export async function assertProjectMemberUnique(
	ctx: MutationCtx,
	projectId: Id<'projects'>,
	contactId: Id<'contacts'>
): Promise<void> {
	const existing = await ctx.db
		.query('projectMembers')
		.withIndex('by_projectId_and_contactId', (q) =>
			q.eq('projectId', projectId).eq('contactId', contactId)
		)
		.first();
	if (existing) {
		throw new ConvexError('Contact is already a member of this project');
	}
}

/**
 * Ages live on the link (age at intake), not the person, and are whole years —
 * a fractional or negative age is a data-entry bug, not a valid value.
 */
export function assertMemberAttributes(attributes: MemberAttributes | undefined): void {
	if (attributes === undefined) {
		return;
	}
	for (const [key, value] of Object.entries(attributes)) {
		if (key !== 'age' && !key.endsWith('_age')) {
			continue;
		}
		if (value === null) {
			continue;
		}
		if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
			throw new ConvexError(`${key} must be a non-negative whole number of years`);
		}
	}
}
