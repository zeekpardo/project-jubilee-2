<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import ImageIcon from '@lucide/svelte/icons/image';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let { campaign, canWrite }: { campaign: Campaign; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let coverImageUrl = $state('');
	let iconUrl = $state('');
	let promoVideoUrl = $state('');
	let isSaving = $state(false);

	// This app stores media as plain URL strings (no upload/storage id), so the
	// form only needs a one-time seed rather than the upload/preview machinery
	// the reference app uses for its file inputs.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		coverImageUrl = campaign.coverImageUrl ?? '';
		iconUrl = campaign.iconUrl ?? '';
		promoVideoUrl = campaign.promoVideoUrl ?? '';
		loaded = true;
	});

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
				<div
					class="bg-muted flex aspect-video w-full max-w-md items-center justify-center overflow-hidden rounded-lg border"
				>
					{#if coverImageUrl}
						<img src={coverImageUrl} alt="" class="h-full w-full object-cover" />
					{:else}
						<ImageIcon class="text-muted-foreground size-8" aria-hidden="true" />
					{/if}
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="campaign-icon">{m.campaignDetail_icon()}</Label>
				<div class="flex items-center gap-3">
					<Input
						id="campaign-icon"
						class="flex-1"
						bind:value={iconUrl}
						type="url"
						placeholder="https://…"
						disabled={!canWrite}
					/>
					<div
						class="bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border"
					>
						{#if iconUrl}
							<img src={iconUrl} alt="" class="h-full w-full object-cover" />
						{:else}
							<ImageIcon class="text-muted-foreground size-5" aria-hidden="true" />
						{/if}
					</div>
				</div>
			</div>

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
