import type { useConvexClient } from '@mmailaender/convex-svelte';
import type { api as convexApi } from '$convex/_generated/api';
import type { Id } from '$convex/_generated/dataModel';
import * as m from '$lib/i18n/messages';

/** Matches the reference app's MAX_UPLOAD_BYTES. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type ConvexClient = ReturnType<typeof useConvexClient>;
type Api = typeof convexApi;

/**
 * Put a receipt in storage and hand back the id a transaction can point at.
 *
 * Shared by every "record money" dialog: a receipt belongs to a transaction of
 * any type, so the upload and its cleanup live here rather than being copied
 * per money flow. The Convex mutations behind it stay in `transactions/spend`,
 * where they were first written — they are gated on `money:write` for the
 * campaign, which is the same gate every caller already passes.
 */
export async function uploadReceipt(
	client: ConvexClient,
	api: Api,
	campaignId: Id<'campaigns'>,
	file: File
): Promise<Id<'_storage'>> {
	const uploadUrl = await client.mutation(api.transactions.spend.generateReceiptUploadUrl, {
		campaignId
	});
	const response = await fetch(uploadUrl, {
		method: 'POST',
		headers: { 'Content-Type': file.type },
		body: file
	});
	// The bytes must land before the transaction points at them, so a failed
	// POST throws here instead of recording money with a dangling receipt.
	if (!response.ok) throw new Error(m.state_saveFailed());
	const body = (await response.json()) as { storageId: Id<'_storage'> };
	return body.storageId;
}

/**
 * Take an already-uploaded receipt back out of storage. Best effort by
 * design: this only ever runs while another error is on its way to the user,
 * so a failure here is swallowed rather than replacing the reason the record
 * did not save.
 *
 * This closes the window between a successful upload and a failed mutation.
 * It does NOT close every window — a closed tab, a reload, or a dropped
 * connection in that same gap leaves the blob stranded with nothing pointing
 * at it. Accepted: the bucket is private, the bytes are invisible to the
 * app, and a sweeper job is more machinery than the leak is worth.
 */
export async function discardReceipt(
	client: ConvexClient,
	api: Api,
	campaignId: Id<'campaigns'>,
	storageId: Id<'_storage'>
): Promise<void> {
	try {
		await client.mutation(api.transactions.spend.discardReceipt, { campaignId, storageId });
	} catch {
		// Intentionally ignored — see above.
	}
}
