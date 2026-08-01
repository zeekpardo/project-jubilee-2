/**
 * Project Jubilee seed — the driver.
 *
 * Reads the four source JSON documents from an EXTERNAL directory, applies the
 * whole transformation (`src/convex/seed/transform.ts`), validates the money
 * totals, prints a row-count report, and — only when asked — calls the internal
 * Convex mutations in dependency order.
 *
 * The source data contains real personal information about real people — and
 * the photos are identifiable images of vulnerable people. Both live outside
 * this repository. Neither is ever vendored here, committed, or turned into a
 * fixture. Point the seed at them with:
 *
 *   JUBILEE_DATA_DIR=/absolute/path/to/data     # defaults to DEFAULT_DATA_DIR
 *   JUBILEE_PHOTOS_DIR=/absolute/path/to/pngs   # defaults to DEFAULT_PHOTOS_DIR
 *   JUBILEE_ORG_ID=<better-auth organization id>   # required only with --write
 *
 * Usage:
 *   pnpm seed:jubilee                       # DRY RUN (default): reports only
 *   pnpm seed:jubilee -- --write --org-id=<orgId>
 *
 * Flags:
 *   --write             actually seed. Without it nothing is ever written.
 *   --org-id=<id>       the organization to seed into (or JUBILEE_ORG_ID)
 *   --data-dir=<path>   override JUBILEE_DATA_DIR
 *   --photos-dir=<path> override JUBILEE_PHOTOS_DIR
 *   --skip-photos       skip the photo upload entirely (fast reseed)
 *   --verbose           print the per-family stage assignment
 *
 * Node runs this file directly via its built-in TypeScript type stripping
 * (Node >= 22.18), so there is no build step and no extra dependency.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { budgetTarget } from '../src/lib/domain/budget.ts';
import type { AllocationLike, TransactionLike } from '../src/lib/domain/reconciliation.ts';
import { reconciliation } from '../src/lib/domain/reconciliation.ts';
import type {
	FamilyRow,
	FamilySponsorsFile,
	ProfileRow,
	SeedPlan,
	TransactionsFile
} from '../src/convex/seed/transform.ts';
import { buildSeedPlan } from '../src/convex/seed/transform.ts';

/**
 * Where the gitignored source data lives on the machine this seed was written
 * on. Override with JUBILEE_DATA_DIR — this is a path, not data, and a checkout
 * without that directory fails loudly rather than seeding nothing.
 */
const DEFAULT_DATA_DIR = '/Users/zeek/Projects/Project Jubilee/data';

/**
 * Where the family photos live. Gitignored in the reference repo for the same
 * reason they are not copied here: they identify people this app exists to
 * protect. Override with JUBILEE_PHOTOS_DIR, or skip with --skip-photos.
 */
const DEFAULT_PHOTOS_DIR =
	'/Users/zeek/Projects/Project Jubilee/next-shadcn-dashboard-starter/public/families';

/** Uploads in flight at once. Enough to be quick, not enough to hammer. */
const PHOTO_UPLOAD_CONCURRENCY = 5;

/** Photos per round trip: URLs generated, uploaded, then recorded together. */
const PHOTO_BATCH_SIZE = 12;

/** Sheet-header totals, in cents. Hard assertions, checked BEFORE any write. */
const EXPECTED = { received: 28735000, sent: 26875800, spent: 24647239 };

/** Documented expectations, printed next to the real counts for a quick diff. */
const EXPECTED_COUNTS: Record<string, number> = {
	projects: 59,
	budgets: 43,
	memberContacts: 79,
	sponsorContacts: 7,
	households: 17,
	householdMembers: 79,
	'projectMembers (member)': 79,
	'projectMembers (sponsor)': 10,
	customFieldCategories: 1,
	customFieldDefinitions: 3,
	pipelineStages: 6,
	costTemplates: 3,
	taskTemplates: 1,
	documents: 21,
	transactions: 175,
	'transactions (donation)': 22,
	'transactions (transfer)': 87,
	'transactions (expenditure)': 66,
	photos: 48
};

const EXPECTED_STAGES: Record<string, number> = {
	vetted: 26,
	funded: 17,
	identified: 9,
	freed_by_other: 7,
	published: 0
};

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface Options {
	write: boolean;
	orgId: string | undefined;
	dataDir: string;
	photosDir: string;
	skipPhotos: boolean;
	verbose: boolean;
}

function parseOptions(argv: string[]): Options {
	let write = false;
	let verbose = false;
	let skipPhotos = false;
	let orgId = process.env.JUBILEE_ORG_ID;
	let dataDir = process.env.JUBILEE_DATA_DIR ?? DEFAULT_DATA_DIR;
	let photosDir = process.env.JUBILEE_PHOTOS_DIR ?? DEFAULT_PHOTOS_DIR;

	for (const arg of argv) {
		if (arg === '--write') write = true;
		else if (arg === '--dry-run') write = false;
		else if (arg === '--verbose') verbose = true;
		else if (arg === '--skip-photos') skipPhotos = true;
		else if (arg.startsWith('--org-id=')) orgId = arg.slice('--org-id='.length);
		else if (arg.startsWith('--data-dir=')) dataDir = arg.slice('--data-dir='.length);
		else if (arg.startsWith('--photos-dir=')) photosDir = arg.slice('--photos-dir='.length);
		else throw new Error(`Unknown argument: ${arg}`);
	}

	return {
		write,
		orgId,
		dataDir: path.resolve(dataDir),
		photosDir: path.resolve(photosDir),
		skipPhotos,
		verbose
	};
}

function readJson<T>(dataDir: string, file: string): T {
	const fullPath = path.join(dataDir, file);
	let raw: string;
	try {
		raw = readFileSync(fullPath, 'utf8');
	} catch {
		throw new Error(
			`Missing source file: ${fullPath}\n` +
				'The Project Jubilee source data is deliberately kept outside this repository ' +
				'(it holds real personal data and is gitignored in the reference repo). Set ' +
				'JUBILEE_DATA_DIR, or pass --data-dir=<path>, to point at the directory holding ' +
				'families.json, profiles.json, family_sponsors.json and transactions.json.'
		);
	}
	return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Convex plumbing
// ---------------------------------------------------------------------------

/**
 * Runs an internal Convex function through the CLI, which supplies the admin
 * credentials for the deployment in .env.local. stdout carries only the
 * function's return value (as JSON, when piped), so it can be parsed; the CLI's
 * own logging goes to stderr and is passed straight through.
 */
function runConvex<T>(functionName: string, args: unknown): T {
	const result = spawnSync(
		'npx',
		[
			'convex',
			'run',
			functionName,
			JSON.stringify(args),
			'--typecheck',
			'disable',
			'--codegen',
			'disable'
		],
		{ cwd: repoRoot, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8', maxBuffer: 32 << 20 }
	);
	if (result.error) throw result.error;
	if (result.status !== 0) {
		throw new Error(`convex run ${functionName} failed with exit code ${result.status}`);
	}
	const stdout = result.stdout.trim();
	if (stdout === '') return null as T;
	try {
		return JSON.parse(stdout) as T;
	} catch {
		throw new Error(`Could not parse the result of ${functionName}:\n${stdout}`);
	}
}

function chunk<T>(items: T[], size: number): T[][] {
	const batches: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		batches.push(items.slice(index, index + size));
	}
	return batches;
}

/** Runs `worker` over `items`, at most `limit` at a time, preserving order. */
async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	worker: (item: T) => Promise<R>
): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const runners: Promise<void>[] = [];
	for (let slot = 0; slot < Math.min(limit, items.length); slot++) {
		runners.push(
			(async () => {
				for (;;) {
					const index = next++;
					if (index >= items.length) return;
					results[index] = await worker(items[index]);
				}
			})()
		);
	}
	await Promise.all(runners);
	return results;
}

// ---------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------

interface PhotoAudit {
	present: { projectNumber: string; fullPath: string; bytes: number }[];
	missing: { projectNumber: string; fullPath: string }[];
}

/**
 * Checks that every planned photo exists and how big it is. Reads directory
 * metadata only — never the image bytes — so it is safe in a dry run.
 */
function auditPhotos(plan: SeedPlan, photosDir: string): PhotoAudit {
	try {
		if (!statSync(photosDir).isDirectory()) throw new Error('not a directory');
	} catch {
		throw new Error(
			`Missing photos directory: ${photosDir}\n` +
				'The family photos are identifiable images of vulnerable people and are ' +
				'deliberately kept outside this repository (the reference repo gitignores ' +
				'them too). Set JUBILEE_PHOTOS_DIR, pass --photos-dir=<path>, or run with ' +
				'--skip-photos.'
		);
	}

	const audit: PhotoAudit = { present: [], missing: [] };
	for (const photo of plan.photos) {
		const fullPath = path.join(photosDir, photo.file);
		try {
			const stats = statSync(fullPath);
			audit.present.push({
				projectNumber: photo.projectNumber,
				fullPath,
				bytes: stats.size
			});
		} catch {
			audit.missing.push({ projectNumber: photo.projectNumber, fullPath });
		}
	}
	return audit;
}

function contentTypeFor(file: string): string {
	const extension = path.extname(file).toLowerCase();
	if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
	if (extension === '.webp') return 'image/webp';
	if (extension === '.gif') return 'image/gif';
	return 'image/png';
}

/**
 * Uploads the photos in batches: a batch's upload URLs are generated, the bytes
 * are POSTed with bounded concurrency, and the resulting storage ids are
 * recorded on their projects before the next batch starts. Batching bounds the
 * blast radius — a crash can orphan at most one batch of blobs, not all 48.
 */
async function uploadPhotos(
	orgId: string,
	audit: PhotoAudit
): Promise<{ uploaded: number; replaced: number; failed: { projectNumber: string }[] }> {
	let uploaded = 0;
	let replaced = 0;
	const failed: { projectNumber: string }[] = [];

	for (const batch of chunk(audit.present, PHOTO_BATCH_SIZE)) {
		const urls = runConvex<string[]>('seed/jubilee:generatePhotoUploadUrls', {
			orgId,
			count: batch.length
		});

		const results = await mapWithConcurrency(
			batch.map((photo, index) => ({ photo, url: urls[index] })),
			PHOTO_UPLOAD_CONCURRENCY,
			async ({ photo, url }) => {
				try {
					const bytes = readFileSync(photo.fullPath);
					const response = await fetch(url, {
						method: 'POST',
						headers: { 'Content-Type': contentTypeFor(photo.fullPath) },
						body: new Uint8Array(bytes)
					});
					if (!response.ok) {
						throw new Error(`upload failed with HTTP ${response.status}`);
					}
					const body = (await response.json()) as { storageId?: string };
					if (!body.storageId) throw new Error('upload response carried no storageId');
					return { projectNumber: photo.projectNumber, storageId: body.storageId };
				} catch (error) {
					console.error(
						`  ! ${photo.projectNumber}: ${error instanceof Error ? error.message : error}`
					);
					return null;
				}
			}
		);

		const photos = results.filter((result) => result !== null);
		for (let index = 0; index < results.length; index++) {
			if (results[index] === null) failed.push({ projectNumber: batch[index].projectNumber });
		}

		if (photos.length > 0) {
			const applied = runConvex<{ updated: number; replaced: number }>(
				'seed/jubilee:setProjectPhotos',
				{ orgId, photos }
			);
			uploaded += applied.updated;
			replaced += applied.replaced;
		}
	}

	return { uploaded, replaced, failed };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function money(cents: number): string {
	const sign = cents < 0 ? '-' : '';
	const abs = Math.abs(cents);
	return `${sign}$${(abs / 100).toFixed(2)}`;
}

function reportRow(label: string, actual: number, expected: number | undefined): string {
	const left = `  ${label.padEnd(30)}${String(actual).padStart(6)}`;
	if (expected === undefined) return left;
	const mark = actual === expected ? 'ok' : `EXPECTED ${expected}`;
	return `${left}   ${mark}`;
}

function planCounts(plan: SeedPlan): Record<string, number> {
	let memberContacts = 0;
	let householdMembers = 0;
	for (const group of plan.households) {
		memberContacts += group.members.length;
		householdMembers += group.members.length;
	}
	let sponsorLinks = 0;
	for (const sponsor of plan.sponsors) sponsorLinks += sponsor.links.length;

	let allocations = 0;
	let donations = 0;
	let transfers = 0;
	let expenditures = 0;
	for (const transaction of plan.transactions) {
		allocations += transaction.allocations.length;
		if (transaction.type === 'donation') donations++;
		else if (transaction.type === 'transfer') transfers++;
		else expenditures++;
	}

	return {
		projects: plan.projects.length,
		budgets: plan.budgets.length,
		memberContacts,
		sponsorContacts: plan.sponsors.length,
		households: plan.households.length,
		householdMembers,
		'projectMembers (member)': memberContacts,
		'projectMembers (sponsor)': sponsorLinks,
		campaignMemberships: memberContacts + plan.sponsors.length,
		customFieldCategories: 1,
		customFieldDefinitions: plan.fieldDefinitions.length,
		pipelineStages: plan.stages.length,
		costTemplates: plan.costTemplates.length,
		taskTemplates: 1,
		documents: plan.documents.length,
		transactions: plan.transactions.length,
		'transactions (donation)': donations,
		'transactions (transfer)': transfers,
		'transactions (expenditure)': expenditures,
		allocations
	};
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const options = parseOptions(process.argv.slice(2));

	console.log(`Project Jubilee seed — ${options.write ? 'WRITE' : 'DRY RUN'}`);
	console.log(`Source data: ${options.dataDir}`);
	console.log(`Photos:      ${options.skipPhotos ? 'skipped (--skip-photos)' : options.photosDir}`);

	const families = readJson<FamilyRow[]>(options.dataDir, 'families.json');
	const profiles = readJson<ProfileRow[]>(options.dataDir, 'profiles.json');
	const sponsors = readJson<FamilySponsorsFile>(options.dataDir, 'family_sponsors.json');
	const transactions = readJson<TransactionsFile>(options.dataDir, 'transactions.json');

	const plan = buildSeedPlan({ families, profiles, sponsors, transactions });

	// -- Validate BEFORE writing ---------------------------------------------
	// A mismatch must not be able to leave a half-seeded database: Convex
	// mutations are transactional per call, but the run spans several calls.
	const transactionLikes: TransactionLike[] = plan.transactions.map((row) => ({
		id: row.note,
		type: row.type,
		amountCents: row.amountCents
	}));
	const allocationLikes: AllocationLike[] = [];
	for (const row of plan.transactions) {
		for (const allocation of row.allocations) {
			allocationLikes.push({
				transactionId: row.note,
				projectId: allocation.projectNumber ?? null,
				amountCents: allocation.amountCents
			});
		}
	}
	// reconciliation() throws if any transaction is over-allocated.
	const totals = reconciliation(transactionLikes, allocationLikes);
	const diffs: Record<string, number> = {
		received: totals.receivedCents - EXPECTED.received,
		sent: totals.sentCents - EXPECTED.sent,
		spent: totals.spentCents - EXPECTED.spent
	};

	console.log('\nReconciliation (cents):');
	console.log(
		`  received  ${totals.receivedCents}  (expected ${EXPECTED.received}, diff ${diffs.received})`
	);
	console.log(`  sent      ${totals.sentCents}  (expected ${EXPECTED.sent}, diff ${diffs.sent})`);
	console.log(
		`  spent     ${totals.spentCents}  (expected ${EXPECTED.spent}, diff ${diffs.spent})`
	);
	console.log(
		`  usBalance ${totals.usBalanceCents}  pkBalance ${totals.pkBalanceCents}` +
			`  (${money(totals.usBalanceCents)} / ${money(totals.pkBalanceCents)})`
	);
	console.log(`  unallocated by type: ${JSON.stringify(totals.unallocatedByType)}`);

	for (const key of Object.keys(diffs)) {
		if (Math.abs(diffs[key]) > 1) {
			throw new Error(
				`Reconciliation mismatch on "${key}": off by ${diffs[key]} cents. Nothing was written.`
			);
		}
	}

	// -- Row counts ----------------------------------------------------------
	const counts = planCounts(plan);
	console.log('\nRow counts (planned):');
	for (const key of Object.keys(counts)) {
		if (key === 'allocations') continue;
		console.log(reportRow(key, counts[key], EXPECTED_COUNTS[key]));
	}
	console.log(
		reportRow('allocations', counts.allocations, undefined) +
			'   expected ~100-150' +
			` (${plan.notes.fundedAllocations} funded-family, ${plan.notes.catchAllAllocations} catch-all)`
	);

	console.log('\nStage distribution:');
	for (const key of Object.keys(EXPECTED_STAGES)) {
		console.log(reportRow(key, plan.notes.stageCounts[key] ?? 0, EXPECTED_STAGES[key]));
	}
	for (const key of Object.keys(plan.notes.stageCounts)) {
		if (!(key in EXPECTED_STAGES)) {
			console.log(reportRow(key, plan.notes.stageCounts[key], undefined) + '   UNEXPECTED STAGE');
		}
	}

	if (plan.notes.fundedShortfallCents > 0) {
		console.log(
			`\n! donation pool shortfall ${plan.notes.fundedShortfallCents} cents — ` +
				'some fully-funded families are under target'
		);
	}

	// -- Budget variance is a WARNING, never an assertion ---------------------
	// grand_total stays authoritative for targetCents; budgetTarget() is computed
	// only to surface the difference. P-009 is a known, real $500 variance.
	const variances = plan.budgets
		.map((budget) => ({
			projectNumber: budget.projectNumber,
			deltaCents: budget.targetCents - budgetTarget(budget.templateSnapshot, budget.debtCents, [])
		}))
		.filter((variance) => variance.deltaCents !== 0);
	if (variances.length > 0) {
		console.log('\nBudget target variances (sheet grand_total vs budgetTarget()) — WARNING only:');
		for (const variance of variances) {
			console.log(
				`  ${variance.projectNumber}  delta ${variance.deltaCents} cents ` +
					`(${money(variance.deltaCents)}) — sheet total kept as targetCents`
			);
		}
	} else {
		console.log('\nBudget target variances: none.');
	}

	// -- Photos ---------------------------------------------------------------
	// Audited up front, so a dry run reports exactly what a real run would
	// upload. Only file metadata is touched here — never the image bytes.
	let audit: PhotoAudit | null = null;
	if (options.skipPhotos) {
		console.log(`\nPhotos: SKIPPED (${plan.photos.length} planned, --skip-photos)`);
	} else {
		audit = auditPhotos(plan, options.photosDir);
		const totalBytes = audit.present.reduce((sum, photo) => sum + photo.bytes, 0);
		console.log('\nPhotos:');
		console.log(reportRow('planned', plan.photos.length, EXPECTED_COUNTS.photos));
		console.log(
			reportRow('found on disk', audit.present.length, EXPECTED_COUNTS.photos) +
				`   ${(totalBytes / 1024 / 1024).toFixed(1)} MB total`
		);
		console.log(
			reportRow('missing', audit.missing.length, undefined) +
				(audit.missing.length > 0 ? '   THESE PROJECTS WILL HAVE NO PHOTO' : '')
		);
		for (const missing of audit.missing) {
			console.log(`    ! ${missing.projectNumber}: no file at ${missing.fullPath}`);
		}
		console.log(
			`  ${'projects without a photo'.padEnd(30)}` +
				`${String(plan.projects.length - plan.photos.length).padStart(6)}`
		);
	}

	if (options.verbose) {
		console.log('\nProjects:');
		for (const project of plan.projects) {
			console.log(`  ${project.number}  ${project.stage.padEnd(16)}${project.name}`);
		}
	}

	if (!options.write) {
		console.log('\nDRY RUN — nothing was written and no image bytes were read.');
		console.log('Re-run with --write --org-id=<orgId> to seed.');
		return;
	}

	if (!options.orgId) {
		throw new Error('--write needs an organization: pass --org-id=<id> or set JUBILEE_ORG_ID.');
	}
	const orgId = options.orgId;

	// -- Write, in dependency order ------------------------------------------
	console.log('\n--- prepare ---');
	runConvex('seed/jubilee:prepare', { orgId });

	console.log('--- wipe ---');
	for (let attempt = 0; attempt < 50; attempt++) {
		const result = runConvex<{ deleted: number; done: boolean }>('seed/jubilee:wipe', { orgId });
		if (result.done) break;
		if (attempt === 49) throw new Error('wipe did not converge after 50 passes');
	}

	console.log('--- seedFoundation ---');
	runConvex('seed/jubilee:seedFoundation', {
		orgId,
		stages: plan.stages,
		costTemplates: plan.costTemplates,
		taskTemplate: plan.taskTemplate,
		fieldCategory: plan.fieldCategory,
		fieldDefinitions: plan.fieldDefinitions
	});

	console.log('--- seedProjects ---');
	for (const batch of chunk(plan.projects, 20)) {
		runConvex('seed/jubilee:seedProjects', { orgId, projects: batch });
	}

	console.log('--- seedBudgets ---');
	for (const batch of chunk(plan.budgets, 20)) {
		runConvex('seed/jubilee:seedBudgets', { orgId, budgets: batch });
	}

	console.log('--- seedDocuments ---');
	for (const batch of chunk(plan.documents, 25)) {
		runConvex('seed/jubilee:seedDocuments', { orgId, documents: batch });
	}

	console.log('--- seedPeople ---');
	for (const batch of chunk(plan.households, 5)) {
		runConvex('seed/jubilee:seedPeople', { orgId, households: batch });
	}

	console.log('--- seedSponsors ---');
	runConvex('seed/jubilee:seedSponsors', { orgId, sponsors: plan.sponsors });

	console.log('--- seedMoney ---');
	for (const batch of chunk(plan.transactions, 25)) {
		runConvex('seed/jubilee:seedMoney', { orgId, transactions: batch });
	}

	let photoResult = { uploaded: 0, replaced: 0, failed: [] as { projectNumber: string }[] };
	if (audit) {
		console.log(`--- seedPhotos (${audit.present.length} files) ---`);
		photoResult = await uploadPhotos(orgId, audit);
	}

	console.log('--- verify ---');
	const verified = runConvex<{
		counts: Record<string, number>;
		reconciliation: Record<string, number>;
		stageCounts: Record<string, number>;
	}>('seed/jubilee:verify', {
		orgId,
		expectedReceivedCents: EXPECTED.received,
		expectedSentCents: EXPECTED.sent,
		expectedSpentCents: EXPECTED.spent
	});

	console.log('\nRow counts (from the deployment):');
	for (const key of Object.keys(verified.counts)) {
		console.log(reportRow(key, verified.counts[key], undefined));
	}
	console.log('\nStage distribution (from the deployment):');
	for (const key of Object.keys(verified.stageCounts)) {
		console.log(reportRow(key, verified.stageCounts[key], EXPECTED_STAGES[key]));
	}

	console.log('\nPhotos:');
	console.log(reportRow('uploaded', photoResult.uploaded, audit ? audit.present.length : 0));
	console.log(
		reportRow('skipped', options.skipPhotos ? plan.photos.length : (audit?.missing.length ?? 0), 0)
	);
	console.log(reportRow('failed', photoResult.failed.length, 0));
	for (const failure of photoResult.failed) {
		console.log(`    ! ${failure.projectNumber}`);
	}
	if (photoResult.replaced > 0) {
		console.log(`  ${photoResult.replaced} displaced blob(s) deleted rather than orphaned.`);
	}
	if (photoResult.failed.length > 0) {
		throw new Error(
			`${photoResult.failed.length} photo(s) failed to upload — re-run to retry just those.`
		);
	}

	console.log('\nSeed complete.');
}

main().catch((error: unknown) => {
	console.error('\nSeed failed:', error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
