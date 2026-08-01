/**
 * Standalone validator for the Project Jubilee seed dataset.
 *
 * Reads the source JSON files from JUBILEE_DATA_DIR (never copies their
 * contents into this repo) and checks shape, counts, money totals, budget
 * consistency, and referential integrity before anyone trusts the data
 * enough to load it into a database.
 *
 * This file is intentionally self-contained: it does not import from
 * src/convex/seed/** or scripts/seed-jubilee.ts, and it never prints names,
 * narratives, religion, or contact details — only counts, sums, and row
 * identifiers (`number` / `row`).
 *
 * Usage:
 *   npx tsx scripts/verify-seed-data.ts
 *   JUBILEE_DATA_DIR=/path/to/data pnpm verify:seed-data
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATA_DIR =
	process.env.JUBILEE_DATA_DIR ?? join(homedir(), 'Projects', 'Project Jubilee', 'data');

const EXPECTED_COUNTS = {
	families: 50,
	profiles: 49,
	received: 22,
	sent: 87,
	pk_spend: 66
} as const;

// Authoritative expected totals, in cents.
const EXPECTED_CENTS = {
	received: 28735000,
	sent: 26875800,
	pk_spend: 24647239
} as const;

const FAMILY_EXPECTED_KEYS = [
	'number',
	'raw_name',
	'note',
	'link',
	'debt',
	'fixed',
	'grand_total',
	'milestones',
	'sponsor',
	'row',
	'family_name',
	'name_extra',
	'template_version'
] as const;

const PROFILE_EXPECTED_KEYS = [
	'number',
	'status',
	'family_name',
	'years_enslaved',
	'duration_raw',
	'reason',
	'family_size',
	'religion',
	'members',
	'link',
	'photo'
] as const;

const KNOWN_NON_FAMILY_FUNDS = new Set(['other-projects', 'family-batch-unallocated']);

// ---------------------------------------------------------------------------
// Minimal shape types (loose — this file validates untyped JSON)
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

interface FamilyRow extends JsonRecord {
	number?: unknown;
	debt?: unknown;
	fixed?: unknown;
	grand_total?: unknown;
	milestones?: unknown;
	sponsor?: unknown;
	template_version?: unknown;
}

interface ProfileRow extends JsonRecord {
	number?: unknown;
	members?: unknown;
}

interface TransactionsFile extends JsonRecord {
	received?: unknown;
	sent?: unknown;
	pk_spend?: unknown;
}

interface FamilySponsorsFile extends JsonRecord {
	family_sponsors?: unknown;
	sponsor_details?: unknown;
	fully_funded?: unknown;
}

// ---------------------------------------------------------------------------
// Reporting infrastructure
// ---------------------------------------------------------------------------

let hardFailures = 0;
const output: string[] = [];

function print(line = ''): void {
	output.push(line);
}

function section(title: string): void {
	print();
	print(`=== ${title} ===`);
}

/** Records a check result. Hard checks flip the process exit code on failure. */
function assertCheck(ok: boolean, message: string, hard = true): void {
	const status = ok ? 'PASS' : 'FAIL';
	print(`[${status}] ${message}`);
	if (!ok && hard) hardFailures += 1;
}

function info(message: string): void {
	print(`[INFO] ${message}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toCents(amount: number): number {
	return Math.round(amount * 100);
}

function isPlainObject(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function loadJson(filename: string): unknown {
	const path = join(DATA_DIR, filename);
	if (!existsSync(path)) {
		throw new Error(`missing file: ${path}`);
	}
	const raw = readFileSync(path, 'utf-8');
	try {
		return JSON.parse(raw);
	} catch (err) {
		throw new Error(`failed to parse ${path} as JSON: ${(err as Error).message}`, { cause: err });
	}
}

/** Applies the known P-041-2 -> P-041 fix-up used across the dataset. */
function normalizeFamilyNumber(number: string): string {
	return number === 'P-041-2' ? 'P-041' : number;
}

function normalizeSponsorName(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main(): number {
	print('Jubilee seed data validator');
	print(`Data dir: ${DATA_DIR}`);

	if (!existsSync(DATA_DIR)) {
		print();
		print(`[FAIL] data directory not found: ${DATA_DIR}`);
		print('       Set JUBILEE_DATA_DIR to point at the Project Jubilee data export.');
		return 1;
	}

	let families: unknown;
	let profiles: unknown;
	let transactions: unknown;
	let familySponsors: unknown;

	try {
		families = loadJson('families.json');
		profiles = loadJson('profiles.json');
		transactions = loadJson('transactions.json');
		familySponsors = loadJson('family_sponsors.json');
	} catch (err) {
		print();
		print(`[FAIL] ${(err as Error).message}`);
		return 1;
	}

	// -------------------------------------------------------------------
	// 1. Shape
	// -------------------------------------------------------------------
	section('1. Shape');

	const familiesIsArray = Array.isArray(families);
	assertCheck(familiesIsArray, 'families.json parses as an array');
	const profilesIsArray = Array.isArray(profiles);
	assertCheck(profilesIsArray, 'profiles.json parses as an array');
	const transactionsIsObject = isPlainObject(transactions);
	assertCheck(transactionsIsObject, 'transactions.json parses as an object');
	const familySponsorsIsObject = isPlainObject(familySponsors);
	assertCheck(familySponsorsIsObject, 'family_sponsors.json parses as an object');

	if (!familiesIsArray || !profilesIsArray || !transactionsIsObject || !familySponsorsIsObject) {
		print();
		print('[FAIL] Top-level shape checks failed — aborting further checks.');
		hardFailures += 1;
		printReport();
		return 1;
	}

	const familyRows = families as FamilyRow[];
	const profileRows = profiles as ProfileRow[];
	const tx = transactions as TransactionsFile;
	const fs = familySponsors as FamilySponsorsFile;

	function checkRowKeys(
		rows: JsonRecord[],
		expectedKeys: readonly string[],
		label: string,
		idField: string
	): { missing: number; extra: number } {
		const expectedSet = new Set(expectedKeys);
		let missingRows = 0;
		let extraRows = 0;
		const missingSamples: string[] = [];
		const extraSamples: string[] = [];

		for (const row of rows) {
			const id = String(row[idField] ?? '<unknown>');
			const rowKeys = Object.keys(row);
			const missing = expectedKeys.filter((k) => !rowKeys.includes(k));
			const extra = rowKeys.filter((k) => !expectedSet.has(k));
			if (missing.length > 0) {
				missingRows += 1;
				if (missingSamples.length < 10) missingSamples.push(`${id}:[${missing.join(',')}]`);
			}
			if (extra.length > 0) {
				extraRows += 1;
				if (extraSamples.length < 10) extraSamples.push(`${id}:[${extra.join(',')}]`);
			}
		}

		assertCheck(
			missingRows === 0,
			`${label}: every row has all expected keys (${missingRows} row(s) missing keys)`
		);
		if (missingRows > 0) info(`${label} rows missing keys: ${missingSamples.join(', ')}`);

		// Extra keys are drift worth knowing about but are informational only —
		// they must not affect the exit code.
		info(`${label}: ${extraRows} row(s) carry unexpected extra keys`);
		if (extraRows > 0) info(`${label} rows with extra keys: ${extraSamples.join(', ')}`);

		return { missing: missingRows, extra: extraRows };
	}

	checkRowKeys(familyRows, FAMILY_EXPECTED_KEYS, 'families.json', 'number');
	checkRowKeys(profileRows, PROFILE_EXPECTED_KEYS, 'profiles.json', 'number');

	const receivedIsArray = Array.isArray(tx.received);
	const sentIsArray = Array.isArray(tx.sent);
	const pkSpendIsArray = Array.isArray(tx.pk_spend);
	assertCheck(receivedIsArray, 'transactions.received is an array');
	assertCheck(sentIsArray, 'transactions.sent is an array');
	assertCheck(pkSpendIsArray, 'transactions.pk_spend is an array');

	const familySponsorsMapIsObject = isPlainObject(fs.family_sponsors);
	const fullyFundedIsArray = Array.isArray(fs.fully_funded);
	assertCheck(familySponsorsMapIsObject, 'family_sponsors.family_sponsors is an object');
	assertCheck(fullyFundedIsArray, 'family_sponsors.fully_funded is an array');

	if (
		!receivedIsArray ||
		!sentIsArray ||
		!pkSpendIsArray ||
		!familySponsorsMapIsObject ||
		!fullyFundedIsArray
	) {
		print();
		print('[FAIL] transactions/family_sponsors shape checks failed — aborting further checks.');
		hardFailures += 1;
		printReport();
		return 1;
	}

	const received = tx.received as JsonRecord[];
	const sent = tx.sent as JsonRecord[];
	const pkSpend = tx.pk_spend as JsonRecord[];
	const familySponsorsMap = fs.family_sponsors as JsonRecord;
	const fullyFunded = fs.fully_funded as unknown[];

	// -------------------------------------------------------------------
	// 2. Counts
	// -------------------------------------------------------------------
	section('2. Counts');

	function checkCount(label: string, actual: number, expected: number): void {
		assertCheck(actual === expected, `${label}: actual ${actual} vs expected ${expected}`);
	}

	checkCount('families', familyRows.length, EXPECTED_COUNTS.families);
	checkCount('profiles', profileRows.length, EXPECTED_COUNTS.profiles);
	checkCount('received', received.length, EXPECTED_COUNTS.received);
	checkCount('sent', sent.length, EXPECTED_COUNTS.sent);
	checkCount('pk_spend', pkSpend.length, EXPECTED_COUNTS.pk_spend);

	// -------------------------------------------------------------------
	// 3. Money totals
	// -------------------------------------------------------------------
	section('3. Money totals');

	function sumCents(rows: JsonRecord[], label: string): number {
		let total = 0;
		let badRows = 0;
		for (const row of rows) {
			const amount = row.amount;
			if (typeof amount !== 'number' || !Number.isFinite(amount)) {
				badRows += 1;
				continue;
			}
			total += toCents(amount);
		}
		if (badRows > 0)
			info(`${label}: ${badRows} row(s) had a non-numeric amount and were excluded from the sum`);
		return total;
	}

	function checkTotal(label: string, actualCents: number, expectedCents: number): void {
		const delta = actualCents - expectedCents;
		assertCheck(
			delta === 0,
			`${label}: actual ${actualCents}c vs expected ${expectedCents}c (delta ${delta > 0 ? '+' : ''}${delta}c)`
		);
	}

	const receivedCents = sumCents(received, 'received');
	const sentCents = sumCents(sent, 'sent');
	const pkSpendCents = sumCents(pkSpend, 'pk_spend');

	checkTotal('received', receivedCents, EXPECTED_CENTS.received);
	checkTotal('sent', sentCents, EXPECTED_CENTS.sent);
	checkTotal('pk_spend', pkSpendCents, EXPECTED_CENTS.pk_spend);

	// -------------------------------------------------------------------
	// 4. Budget consistency
	// -------------------------------------------------------------------
	section('4. Budget consistency');

	interface BudgetOffender {
		number: string;
		deltaCents: number;
	}

	let checkedFamilies = 0;
	const offenders: BudgetOffender[] = [];

	for (const row of familyRows) {
		const hasTemplateVersion = row.template_version != null;
		const grandTotal = row.grand_total;
		if (!hasTemplateVersion || grandTotal == null || typeof grandTotal !== 'number') continue;

		checkedFamilies += 1;

		const debtValue = row.debt;
		const debtCents = typeof debtValue === 'number' ? toCents(debtValue) : 0;

		const fixed = isPlainObject(row.fixed) ? row.fixed : {};
		let fixedCents = 0;
		for (const value of Object.values(fixed)) {
			if (typeof value === 'number') fixedCents += toCents(value);
		}

		const expectedTotalCents = debtCents + fixedCents;
		const actualTotalCents = toCents(grandTotal);
		const deltaCents = actualTotalCents - expectedTotalCents;

		if (deltaCents !== 0) {
			offenders.push({ number: String(row.number ?? '<unknown>'), deltaCents });
		}
	}

	info(
		`checked ${checkedFamilies} family row(s) with both template_version and non-null grand_total`
	);
	assertCheck(
		offenders.length === 0,
		`budget consistency: ${offenders.length} offending family row(s) (grand_total != debt + sum(fixed))`
	);
	for (const offender of offenders) {
		info(
			`  offender ${offender.number}: delta ${offender.deltaCents > 0 ? '+' : ''}${offender.deltaCents}c`
		);
	}

	// -------------------------------------------------------------------
	// 5. Referential integrity
	// -------------------------------------------------------------------
	section('5. Referential integrity');

	const rawFamilyNumbers = familyRows
		.map((r) => r.number)
		.filter((n): n is string => typeof n === 'string');

	const stillHasLegacySuffix = rawFamilyNumbers.includes('P-041-2');
	info(
		stillHasLegacySuffix
			? 'raw families.json still contains "P-041-2" — the fix-up to "P-041" is still required'
			: 'raw families.json no longer contains "P-041-2" — the fix-up may be obsolete, double check normalizeFamilyNumber'
	);

	const normalizedFamilyNumbers = rawFamilyNumbers.map(normalizeFamilyNumber);
	const normalizedFamilySet = new Set(normalizedFamilyNumbers);
	const duplicatesAfterFixup = normalizedFamilyNumbers.length - normalizedFamilySet.size;
	assertCheck(
		duplicatesAfterFixup === 0,
		`family numbers unique after P-041-2 -> P-041 fix-up (${duplicatesAfterFixup} collision(s))`
	);

	function unresolvedNumbers(candidates: string[]): string[] {
		return candidates.filter((n) => !normalizedFamilySet.has(normalizeFamilyNumber(n)));
	}

	const sponsorKeyIssues = unresolvedNumbers(Object.keys(familySponsorsMap));
	assertCheck(
		sponsorKeyIssues.length === 0,
		`every family_sponsors.family_sponsors key resolves to a family number (${sponsorKeyIssues.length} unresolved)`
	);
	if (sponsorKeyIssues.length > 0)
		info(`unresolved family_sponsors keys: ${sponsorKeyIssues.join(', ')}`);

	const fullyFundedStrings = fullyFunded.filter((n): n is string => typeof n === 'string');
	const fullyFundedTypeIssues = fullyFunded.length - fullyFundedStrings.length;
	if (fullyFundedTypeIssues > 0)
		info(`fully_funded contains ${fullyFundedTypeIssues} non-string entr(y/ies)`);
	const fullyFundedIssues = unresolvedNumbers(fullyFundedStrings);
	assertCheck(
		fullyFundedIssues.length === 0,
		`every family_sponsors.fully_funded entry resolves to a family number (${fullyFundedIssues.length} unresolved)`
	);
	if (fullyFundedIssues.length > 0)
		info(`unresolved fully_funded entries: ${fullyFundedIssues.join(', ')}`);

	const profileOnlyPattern = /^P-05[1-9]$/;
	const profileNumberIssues: string[] = [];
	for (const row of profileRows) {
		const num = row.number;
		if (typeof num !== 'string') continue;
		const normalized = normalizeFamilyNumber(num);
		if (normalizedFamilySet.has(normalized)) continue;
		if (profileOnlyPattern.test(num)) continue;
		profileNumberIssues.push(num);
	}
	assertCheck(
		profileNumberIssues.length === 0,
		`every profiles.json number matches a family or a known profile-only number P-051..P-059 (${profileNumberIssues.length} unresolved)`
	);
	if (profileNumberIssues.length > 0)
		info(`unresolved profile numbers: ${profileNumberIssues.join(', ')}`);

	const unknownFunds = new Set<string>();
	for (const row of pkSpend) {
		const fund = row.fund;
		if (typeof fund !== 'string') continue;
		const normalized = normalizeFamilyNumber(fund);
		if (normalizedFamilySet.has(normalized)) continue;
		if (KNOWN_NON_FAMILY_FUNDS.has(fund)) continue;
		unknownFunds.add(fund);
	}
	assertCheck(
		unknownFunds.size === 0,
		`every pk_spend.fund is a family number, "other-projects", or "family-batch-unallocated" (${unknownFunds.size} unknown slug(s))`
	);
	if (unknownFunds.size > 0) info(`unknown fund slugs: ${[...unknownFunds].join(', ')}`);

	// -------------------------------------------------------------------
	// 6. Distributions worth eyeballing
	// -------------------------------------------------------------------
	section('6. Distributions worth eyeballing');

	let withTemplateVersion = 0;
	let withGrandTotal = 0;
	let withDebt = 0;
	let withSponsorName = 0;
	const fundedForms = new Map<string, number>();
	const familySponsorNames: string[] = [];

	for (const row of familyRows) {
		if (row.template_version != null) withTemplateVersion += 1;
		if (row.grand_total != null) withGrandTotal += 1;
		if (row.debt != null) withDebt += 1;

		const sponsor = isPlainObject(row.sponsor) ? row.sponsor : {};
		const sponsorName = sponsor.name;
		if (typeof sponsorName === 'string' && sponsorName.trim() !== '') {
			withSponsorName += 1;
			familySponsorNames.push(sponsorName);
		}

		const milestones = isPlainObject(row.milestones) ? row.milestones : {};
		const funded = milestones.funded;
		const key = funded === null || funded === undefined ? '(null)' : String(funded);
		fundedForms.set(key, (fundedForms.get(key) ?? 0) + 1);
	}

	info(`families with template_version: ${withTemplateVersion}/${familyRows.length}`);
	info(`families with non-null grand_total: ${withGrandTotal}/${familyRows.length}`);
	info(`families with non-null debt: ${withDebt}/${familyRows.length}`);
	info(`families with a sponsor.name set: ${withSponsorName}/${familyRows.length}`);
	info(
		`milestones.funded forms: ${[...fundedForms.entries()].map(([k, v]) => `${k}=${v}`).join(', ')}`
	);

	let profilesWithMembers = 0;
	let totalMemberCount = 0;
	for (const row of profileRows) {
		const members = row.members;
		if (Array.isArray(members) && members.length > 0) {
			profilesWithMembers += 1;
			totalMemberCount += members.length;
		}
	}
	info(`profiles with a non-empty members array: ${profilesWithMembers}/${profileRows.length}`);
	info(`total member count across all profiles: ${totalMemberCount}`);

	const normalizedFromFamilies = new Set(familySponsorNames.map(normalizeSponsorName));
	info(
		`distinct normalized sponsor names (families.json sponsor.name): ${normalizedFromFamilies.size}`
	);

	const sponsorMapNames = Object.values(familySponsorsMap).filter(
		(v): v is string => typeof v === 'string'
	);
	const normalizedFromSponsorMap = new Set(sponsorMapNames.map(normalizeSponsorName));
	info(
		`distinct normalized sponsor names (family_sponsors.family_sponsors): ${normalizedFromSponsorMap.size}`
	);

	// -------------------------------------------------------------------
	printReport();
	return hardFailures > 0 ? 1 : 0;
}

function printReport(): void {
	section('Summary');
	info(`hard failures: ${hardFailures}`);
	print();
	console.log(output.join('\n'));
	// Clear so a hypothetical second call to main() (not expected) doesn't duplicate output.
	output.length = 0;
}

const exitCode = main();
process.exit(exitCode);
