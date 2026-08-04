// ============================================================
// THE PRIVACY WALL
// ============================================================
// This module and `convex/public/queries.ts` are the ONLY data source
// public-facing pages may read from. Everything returned here is safe to
// render to an anonymous visitor. Public pages must NEVER call the admin
// queries under campaigns/, projects/, contacts/, money/ and so on — those
// return unscrubbed admin records.
//
// The wall is an ALLOWLIST. Every returned object is built field by field
// below; no database document is ever spread into a response. Adding a field
// here is a privacy decision, not a refactor.
//
//   EXPOSED, and nothing else:
//   - project `number` (the public identifier)
//   - `publicName`, if an admin set one. Never derived from the real name:
//     no rule separates given name from surname across cultures. Null
//     otherwise, leaving `number` as the only identifier.
//   - story, photoUrl, videoUrl, stage key and label. An uploaded photo is
//     resolved from its storage id into a signed URL here, so that URL is
//     handed to anonymous visitors by design — only ever for a project whose
//     isPublished is true
//   - a campaign's coverImageUrl/iconUrl: same resolution as a project photo
//     — an uploaded cover/icon is resolved from its storage id into a signed
//     URL here, with the pasted URL as fallback, for a campaign whose
//     isPublished is true
//   - memberCount (a COUNT, never the member rows)
//   - memberFirstNames — only members given an explicit public first name;
//     the rest are counted but unnamed
//   - custom attributes whose field definition is explicitly isPublic, each
//     carrying its admin-authored label and type so a reader never has to
//     invent either from the key
//   - isGoalMet and the campaign's goalLabel (the "Freed" badge)
//   - raised / target / progress, derived from the ledger. targetCents is
//     derived from the bonded debt owed for this family, so it quantifies
//     their bondage; it is exposed because it IS the fundraising ask.
//   - org chrome: orgSettings.publicName/publicTagline/theme/slug — never
//     the org's internal name or any other orgSettings field
//   - campaign summary cards: slug, name, summary, coverImageUrl,
//     objectSlug, objectLabelPlural — a subset of toPublicCampaign, for list
//     views that don't need the full detail shape
//   - a PUBLISHED update's `title`, `body`, `publishedAt` and `slug`, plus an
//     `assets` map of storage id to resolved URL for the photographs its body
//     names.
//     The `slug` goes out where an id may not because it is not a key to
//     anything: it was derived from the title the org itself chose to publish,
//     it is unique only within one campaign or one record rather than across
//     this deployment, and it names exactly one row that has already passed the
//     publish check below. A document id is the opposite on every count —
//     forgeable into a reference to any table, meaningful to queries that never
//     asked whether the row was public, and an admission that the row exists at
//     all. The slug says only "this published post is at this address", which is
//     the whole point of having one.
//     The body is markdown authored by staff and is the only FREE PROSE ABOUT A
//     NAMED FAMILY this wall carries, which is why the decision to let it
//     through is a capability of its own (`content:publish`, held by fewer
//     roles than may write one) rather than a property of the parent: a draft
//     is not a public record and `toPublicUpdate` returns null for one, ON TOP
//     of every caller reading only the published half of the index. Asset URLs
//     are resolved for published rows ONLY — a storage URL cannot be revoked
//     once handed out, so a draft's photographs must never acquire one.
//     What is NOT here matters as much: no update id, no authorUserId, no
//     orgId, campaignId or projectId. Public records are addressed by `number`
//     and ids do not travel.
//   - campaign stat counts — whole-number aggregates only, and only the
//     stats a campaign has configured for its public surface. Which
//     aggregates may go out is decided by the engine in model/stats.ts
//     (a private field or checklist item is skipped, a protected key is
//     dropped, a small count is withheld); see publicCampaignStats below
//     for why counting across unpublished projects is still safe
//
//   NEVER EXPOSED. Do not add without a privacy review:
//   - member surnames, ages, relationships, or contact records of any kind
//   - donor/contact PII, donation amounts, or donor-to-project links
//   - Convex document ids — projects are addressed by `number` only
//   - a PROTECTED custom-field key — site/factory references, phone numbers,
//     addresses, locations, and internal ops notes. This app serves people
//     escaping forced labour; leaking where they were held can endanger
//     them. These used to be fixed columns this wall simply never copied,
//     but they are now entries in `projects.attributes` like any other
//     custom field, so "never copied" is no longer a guarantee by itself.
//     The guarantee now lives in `lib/domain/field-definitions.ts`:
//     `isProtectedFieldKey` denylists these keys (exact match, plus a
//     pattern for `*_ref`/phone/address/location), enforced twice —
//     once at write time (customFields/mutations.ts refuses to let a
//     protected key be marked `isPublic`) and again at read time
//     (`publicAttributeList`, which drops a protected key even if some
//     future path marked it public anyway). Adding a field here is still a
//     privacy decision: an admin ticking `isPublic` on a NEW field is a
//     deliberate per-field choice, not something this wall can veto beyond
//     the denylist above.
//
// Only projects with isPublished true are visible. Publishing is an
// independent toggle, decoupled from pipeline stage: an unpublished project
// does not exist as far as the public site is concerned.
// ============================================================

import type { QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import {
	publicAttributeList,
	type FieldDefinition,
	type PublicAttribute
} from '../../lib/domain/field-definitions';
import { raisedForProject } from '../../lib/domain/reconciliation';
import { isPersonReachedRole } from '../../lib/domain/campaign-stats';
import { resolveProjectFieldDefs } from './fields';
import { loadPublicPolicy } from './policy';
import { computeStats, type ResolvedStat } from './stats';
import { resolveUpdateAssets } from './updates';

/**
 * The org a public URL is talking about, resolved from its slug alone.
 *
 * `orgSettings.slug` is the globally unique handle; every other slug in this
 * app — campaigns especially — is unique only per org, which is why the public
 * surface must name the org first. The same three lines already sat at the top
 * of `resolvePublishedCampaign`; they are lifted here because the signed-in
 * site now needs the identical lookup, and two copies of "which org is this"
 * drifting apart is how one org ends up shadowing another's public site.
 *
 * The returned orgId is a LOOKUP KEY, not a public field. It is the one
 * internal identifier this module hands back, and it exists so a caller can
 * scope a read; nothing on the exposed list above changes, and this string must
 * never be copied into a response.
 *
 * Null for an unknown slug — never a throw. An anonymous page load for an org
 * that does not exist is a 404's worth of nothing, not an error dialog.
 * `.first()` rather than `.unique()` for the same reason: slug uniqueness is a
 * convention enforced at write time, and a visitor should not be the one who
 * discovers it was broken.
 */
export async function orgIdForSlug(ctx: QueryCtx, orgSlug: string): Promise<string | null> {
	const settings = await ctx.db
		.query('orgSettings')
		.withIndex('by_slug', (q) => q.eq('slug', orgSlug))
		.first();
	return settings?.orgId ?? null;
}

/**
 * Public names are ADMIN-ENTERED, never derived. Taking the first token of a
 * name leaks the surname for "Bhatti, Ahmed", for every name written without a
 * separator, and for every surname-first culture. There is no rule that works
 * across cultures, so an unset public name yields null and the project is
 * identified by its number alone.
 */
function publicNameOf(explicit: string | undefined): string | null {
	const trimmed = explicit?.trim();
	return trimmed ? trimmed : null;
}

export type PublicProject = {
	number: string;
	/** Null unless an admin set an explicit public name. */
	name: string | null;
	story: string | null;
	photoUrl: string | null;
	videoUrl: string | null;
	stage: string;
	stageLabel: string;
	isGoalMet: boolean;
	goalLabel: string;
	memberCount: number;
	memberFirstNames: string[];
	attributes: PublicAttribute[];
	raisedCents: number;
	targetCents: number | null;
	progress: number | null;
};

/**
 * The field definitions that apply to a project in this campaign. Lives in
 * model/fields.ts now, because the stat engine needs the same set; kept
 * exported from the wall so the public queries keep one import.
 */
export async function publicFieldDefs(
	ctx: QueryCtx,
	orgId: string,
	campaignId: Id<'campaigns'>
): Promise<FieldDefinition[]> {
	return resolveProjectFieldDefs(ctx, orgId, campaignId);
}

/** Donation cents attributed to this project, via the ported ledger math. */
async function raisedCentsFor(ctx: QueryCtx, projectId: Id<'projects'>): Promise<number> {
	const allocations = await ctx.db
		.query('allocations')
		.withIndex('by_projectId', (q) => q.eq('projectId', projectId))
		.collect();
	if (allocations.length === 0) return 0;

	const transactions = [];
	const seen = new Set<string>();
	for (const allocation of allocations) {
		if (seen.has(allocation.transactionId)) continue;
		seen.add(allocation.transactionId);
		const transaction = await ctx.db.get('transactions', allocation.transactionId);
		if (transaction) {
			transactions.push({
				id: transaction._id as string,
				type: transaction.type,
				amountCents: transaction.amountCents
			});
		}
	}

	return raisedForProject(
		projectId,
		transactions,
		allocations.map((a) => ({
			transactionId: a.transactionId as string,
			projectId: a.projectId ?? null,
			amountCents: a.amountCents
		}))
	);
}

/**
 * Build the public view of a project. Every field is copied explicitly; the
 * source document is never spread, so a new admin-only column cannot leak by
 * simply existing.
 */
export async function toPublicProject(
	ctx: QueryCtx,
	project: Doc<'projects'>,
	campaign: Doc<'campaigns'>,
	presolvedDefs?: FieldDefinition[]
): Promise<PublicProject> {
	const stage = await ctx.db
		.query('pipelineStages')
		.withIndex('by_campaignId_and_key', (q) =>
			q.eq('campaignId', project.campaignId).eq('key', project.stage)
		)
		.first();

	// Donors attached to this record are excluded: memberCount is published as
	// the household's size, so counting sponsors would both overstate it and
	// hint at how many donors a given family has.
	const memberLinks = (
		await ctx.db
			.query('projectMembers')
			.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
			.collect()
	).filter((link) => isPersonReachedRole(link.role));

	// Only members with an explicit public first name are listed. A member
	// without one is counted, never named.
	const memberFirstNames: string[] = [];
	for (const link of memberLinks) {
		const contact = await ctx.db.get('contacts', link.contactId);
		const publicFirst = publicNameOf(contact?.publicFirstName);
		if (publicFirst) memberFirstNames.push(publicFirst);
	}

	const budget = await ctx.db
		.query('budgets')
		.withIndex('by_projectId', (q) => q.eq('projectId', project._id))
		.first();

	const raisedCents = await raisedCentsFor(ctx, project._id);
	const targetCents = budget?.targetCents ?? null;

	const defs = presolvedDefs ?? (await publicFieldDefs(ctx, project.orgId, project.campaignId));
	// The org's own denylist additions, on top of the shared one. Loaded here
	// rather than passed in so no caller can forget it.
	const policy = await loadPublicPolicy(ctx, project.orgId);

	// An uploaded photo lives in Convex storage and has to be resolved to a
	// signed URL at read time; a pasted photoUrl is the fallback. Same order as
	// the admin queries, so the public page shows the picture an admin sees
	// rather than the placeholder. Publishing is still gated by isPublished —
	// this resolves the address of a photo, it does not decide to show one.
	const photoUrl = project.photoStorageId
		? ((await ctx.storage.getUrl(project.photoStorageId)) ?? project.photoUrl ?? null)
		: (project.photoUrl ?? null);

	return {
		number: project.number,
		name: publicNameOf(project.publicName),
		story: project.story ?? null,
		photoUrl,
		videoUrl: project.videoUrl ?? null,
		stage: project.stage,
		stageLabel: stage?.label ?? project.stage,
		isGoalMet: project.isGoalMet,
		goalLabel: campaign.goalLabel,
		memberCount: memberLinks.length,
		memberFirstNames,
		attributes: publicAttributeList(defs, project.attributes, policy.extraProtectedKeys),
		raisedCents,
		targetCents,
		progress: targetCents && targetCents > 0 ? Math.min(1, raisedCents / targetCents) : null
	};
}

export type PublicCampaign = {
	slug: string;
	name: string;
	summary: string | null;
	story: string | null;
	coverImageUrl: string | null;
	iconUrl: string | null;
	promoVideoUrl: string | null;
	accent: string | null;
	theme: string | null;
	objectLabel: string;
	objectLabelPlural: string;
	objectSlug: string;
	goalLabel: string;
	goalVerb: string;
};

/**
 * Resolves a campaign's cover/icon to the URL a visitor should see: the
 * uploaded blob when one is set, the pasted URL otherwise. Same order and
 * fallback as `toPublicProject`'s photoUrl resolution.
 */
async function resolveCampaignImage(
	ctx: QueryCtx,
	storageId: Id<'_storage'> | undefined,
	pastedUrl: string | undefined
): Promise<string | null> {
	if (!storageId) return pastedUrl ?? null;
	return (await ctx.storage.getUrl(storageId)) ?? pastedUrl ?? null;
}

/** Public view of a campaign. Built field by field, same rule as projects. */
export async function toPublicCampaign(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>
): Promise<PublicCampaign> {
	return {
		slug: campaign.slug,
		name: campaign.name,
		summary: campaign.summary ?? null,
		story: campaign.story ?? null,
		coverImageUrl: await resolveCampaignImage(
			ctx,
			campaign.coverImageStorageId,
			campaign.coverImageUrl
		),
		iconUrl: await resolveCampaignImage(ctx, campaign.iconStorageId, campaign.iconUrl),
		promoVideoUrl: campaign.promoVideoUrl ?? null,
		accent: campaign.accent ?? null,
		theme: campaign.theme ?? null,
		objectLabel: campaign.objectLabel,
		objectLabelPlural: campaign.objectLabelPlural,
		objectSlug: campaign.objectSlug,
		goalLabel: campaign.goalLabel,
		goalVerb: campaign.goalVerb
	};
}

export type PublicCampaignSummary = {
	slug: string;
	name: string;
	summary: string | null;
	coverImageUrl: string | null;
	objectSlug: string;
	objectLabelPlural: string;
};

/** The list-view shape for a campaign card. Built field by field, same rule as projects. */
export async function toPublicCampaignSummary(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>
): Promise<PublicCampaignSummary> {
	return {
		slug: campaign.slug,
		name: campaign.name,
		summary: campaign.summary ?? null,
		coverImageUrl: await resolveCampaignImage(
			ctx,
			campaign.coverImageStorageId,
			campaign.coverImageUrl
		),
		objectSlug: campaign.objectSlug,
		objectLabelPlural: campaign.objectLabelPlural
	};
}

export type PublicOrgProfile = {
	name: string;
	tagline: string | null;
	theme: string | null;
	slug: string;
};

/**
 * Public site chrome for an org. `name` is admin-entered
 * (`orgSettings.publicName`) so it never has to guess at a display name;
 * when unset it falls back to the caller-supplied name of the org's first
 * published campaign, so a brand-new org with no chrome configured yet still
 * has something to show in the header.
 */
export function toPublicOrgProfile(
	settings: Doc<'orgSettings'>,
	orgSlug: string,
	fallbackName: string
): PublicOrgProfile {
	const explicit = settings.publicName?.trim();
	return {
		name: explicit ? explicit : fallbackName,
		tagline: settings.publicTagline ?? null,
		theme: settings.theme ?? null,
		// settings was resolved BY slug, so this is always the same string as
		// orgSlug; the fallback only guards the optional-field type.
		slug: settings.slug ?? orgSlug
	};
}

export type PublicUpdate = {
	/**
	 * The post's public address, unique within its campaign or its record. Never
	 * null: a published row that has no slug does not come out of the wall at all.
	 */
	slug: string;
	title: string;
	/** Markdown. Rendered server-side; no editor bytes reach a public page. */
	body: string;
	/** The moment publishing happened, never the moment the row was created. */
	publishedAt: number | null;
	/** Storage id to resolved URL, for the photographs the body names. */
	assets: Record<string, string>;
};

/**
 * Public view of an update. Built field by field like everything else here, so
 * the id, the author and the parents stay behind the wall.
 *
 * NULL FOR A DRAFT, and that is not belt-and-braces — it is the wall making the
 * publish decision itself rather than trusting that every caller remembered to
 * ask for the published half of an index. Nothing in this codebase treats "the
 * parent is published" as authorization for a child row, and an update carries
 * its own publish decision precisely because free prose about a named family is
 * the riskiest thing this platform emits.
 *
 * The photographs are resolved only once that check has passed. A storage URL
 * does not expire — deleting the blob is the only revocation there is — so a
 * URL minted for a draft would be a permanent public address for a photo nobody
 * had yet agreed to publish.
 *
 * NULL ALSO FOR A PUBLISHED ROW WITH NO SLUG, which `publishUpdate` cannot
 * produce — it mints one on the way through. A row in that state is therefore a
 * row that reached `published` without passing the `content:publish` gate: a
 * seed, a migration, or somebody typing in the Convex dashboard. Failing closed
 * costs an operator a confused afternoon; failing open would put free prose
 * about a named family on the public site by a route that never asked anyone.
 * It is also what lets a caller link every row it is handed, since the slug on
 * this shape is never null.
 */
export async function toPublicUpdate(
	ctx: QueryCtx,
	update: Doc<'updates'>
): Promise<PublicUpdate | null> {
	if (update.status !== 'published') return null;
	if (!update.slug) return null;

	return {
		slug: update.slug,
		title: update.title,
		body: update.body,
		publishedAt: update.publishedAt ?? null,
		assets: await resolveUpdateAssets(ctx, update.assetIds)
	};
}

export type PublicStat = ResolvedStat;

/**
 * The public impact numbers for a campaign: whichever stats the campaign has
 * configured for its public surface, computed by the engine in model/stats.ts
 * and subject to every gate documented there (a private field or checklist
 * item is skipped, a protected key is dropped, a small count is withheld).
 * A campaign that has configured nothing gets the three counts this app
 * shipped with — see defaultStatConfigs.
 *
 * Counts still run across ALL of the campaign's projects, published or not —
 * same as the reference app's getImpactStats. These are whole-number
 * aggregates with no per-project or per-donor detail, so the wall holds: an
 * unpublished project cannot be identified from a count. It does mean the
 * headline number can be larger than the number of project cards a visitor
 * actually sees, since those are filtered to isPublished.
 */
export async function publicCampaignStats(
	ctx: QueryCtx,
	campaign: Doc<'campaigns'>
): Promise<PublicStat[]> {
	return computeStats(ctx, campaign, { surface: 'public' });
}
