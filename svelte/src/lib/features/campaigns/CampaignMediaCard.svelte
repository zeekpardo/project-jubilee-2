<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Campaign } from './types';
	import CampaignImageUploader from './CampaignImageUploader.svelte';
	import * as m from '$lib/i18n/messages';

	let { campaign, canWrite }: { campaign: Campaign; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let coverImageUrl = $state('');
	let iconUrl = $state('');
	let promoVideoUrl = $state('');
	let isSaving = $state(false);

	// campaign.coverImageUrl/iconUrl are resolved at read time, preferring an
	// uploaded blob — when a blob is set, that field is a signed, temporary
	// URL for preview only. Seeding the pasted-URL input with it would let an
	// unrelated "Save changes" (e.g. just the promo video) silently persist a
	// signed URL as a permanent one and drop the upload, so a storage-backed
	// slot starts its text input blank instead.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		coverImageUrl = campaign.coverImageStorageId ? '' : (campaign.coverImageUrl ?? '');
		iconUrl = campaign.iconStorageId ? '' : (campaign.iconUrl ?? '');
		promoVideoUrl = campaign.promoVideoUrl ?? '';
		loaded = true;
	});

	// What the preview should show: unsaved typed text first, then whatever
	// the server resolved (a signed upload URL, or a previously saved one).
	const coverPreviewUrl = $derived(coverImageUrl.trim() || campaign.coverImageUrl || null);
	const iconPreviewUrl = $derived(iconUrl.trim() || campaign.iconUrl || null);

	/** After an upload/removal, the paired field the server just cleared may
	 *  still be reflected in stale local text — drop it so the preview falls
	 *  back to the (now up to date) resolved URL instead of re-persisting it. */
	function clearCoverText(): void {
		coverImageUrl = '';
	}
	function clearIconText(): void {
		iconUrl = '';
	}

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.campaigns.mutations.updateCampaign, {
				campaignId: campaign._id,
				coverImageUrl: coverImageUrl.trim() || undefined,
				iconUrl: iconUrl.trim() || undefined,
				promoVideoUrl: promoVideoUrl.trim() || undefined
			});
			toast.success(m.campaigns_updated());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.campaignDetail_mediaTitle()}</Card.Title>
		<Card.Description>{m.campaignDetail_mediaBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-6" onsubmit={save}>
			<div class="flex flex-col gap-2">
				<Label for="campaign-cover-image">{m.campaignDetail_coverImage()}</Label>
				<Input
					id="campaign-cover-image"
					bind:value={coverImageUrl}
					type="url"
					placeholder="https://…"
					disabled={!canWrite}
				/>
				<CampaignImageUploader
					campaignId={campaign._id}
					kind="cover"
					url={coverPreviewUrl}
					label={m.campaignDetail_coverImage()}
					{canWrite}
					frameClass="aspect-video w-full max-w-md"
					onchange={clearCoverText}
				/>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="campaign-icon">{m.campaignDetail_icon()}</Label>
				<Input
					id="campaign-icon"
					bind:value={iconUrl}
					type="url"
					placeholder="https://…"
					disabled={!canWrite}
				/>
				<CampaignImageUploader
					campaignId={campaign._id}
					kind="icon"
					url={iconPreviewUrl}
					label={m.campaignDetail_icon()}
					{canWrite}
					frameClass="size-16"
					onchange={clearIconText}
				/>
			</div>

			<p class="text-muted-foreground text-xs">{m.campaignDetail_imageUrlHelp()}</p>

			<div class="flex flex-col gap-2">
				<Label for="campaign-promo-video">{m.campaignDetail_promoVideo()}</Label>
				<Input
					id="campaign-promo-video"
					bind:value={promoVideoUrl}
					type="url"
					placeholder="https://youtube.com/watch?v=…"
					disabled={!canWrite}
				/>
			</div>

			{#if canWrite}
				<div>
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
