<script lang="ts">
	// Mirrors ProjectPhoto.svelte's upload flow, parameterized by which slot
	// (cover/icon) this instance manages. The caller owns the pasted-URL text
	// input and the "effective" preview URL — this component only ever talks
	// to the campaign-image mutations and reports back when it changes them,
	// so the caller can drop its stale pasted-URL text.
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';

	import { Spinner } from '$lib/primitives/ui/spinner';
	import { cn } from '$lib/primitives/utils';
	import ImageIcon from '@lucide/svelte/icons/image';
	import UploadIcon from '@lucide/svelte/icons/upload';
	import XIcon from '@lucide/svelte/icons/x';

	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	const MAX_BYTES = 10 * 1024 * 1024;

	let {
		campaignId,
		kind,
		url,
		label,
		canWrite = false,
		frameClass,
		onchange
	}: {
		campaignId: Id<'campaigns'>;
		kind: 'cover' | 'icon';
		url: string | null;
		label: string;
		canWrite?: boolean;
		frameClass: string;
		/** Fired after a successful upload or removal, so the caller can drop its stale pasted-URL text. */
		onchange: () => void;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let fileInput = $state<HTMLInputElement | null>(null);
	let working = $state(false);

	function fail(error: unknown): void {
		toast.error(
			error instanceof ConvexError
				? String(error.data)
				: error instanceof Error
					? error.message
					: m.state_saveFailed()
		);
	}

	async function upload(file: File): Promise<void> {
		working = true;
		try {
			const uploadUrl = await client.mutation(api.campaigns.detail.generateCampaignImageUploadUrl, {
				campaignId
			});
			const response = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': file.type },
				body: file
			});
			// The bytes must land before the record points at them, so a failed POST
			// throws here instead of falling through to a mutation with no blob.
			if (!response.ok) throw new Error(m.state_saveFailed());
			const body = (await response.json()) as { storageId: Id<'_storage'> };

			await client.mutation(api.campaigns.detail.setCampaignImage, {
				campaignId,
				kind,
				storageId: body.storageId
			});
			toast.success(m.campaignDetail_imageSaved({ label }));
			onchange();
		} catch (error: unknown) {
			fail(error);
		} finally {
			working = false;
		}
	}

	function handleChange(event: Event): void {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.item(0) ?? null;
		target.value = '';
		if (!file) return;
		if (file.size > MAX_BYTES) {
			toast.error(m.campaignDetail_imageTooLarge());
			return;
		}
		void upload(file);
	}

	async function clear(): Promise<void> {
		working = true;
		try {
			await client.mutation(api.campaigns.detail.clearCampaignImage, { campaignId, kind });
			toast.success(m.campaignDetail_imageRemoved({ label }));
			onchange();
		} catch (error: unknown) {
			fail(error);
		} finally {
			working = false;
		}
	}
</script>

<div class={cn('relative shrink-0', frameClass)}>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		class="hidden"
		onchange={handleChange}
	/>

	<button
		type="button"
		disabled={!canWrite || working}
		aria-label={url
			? m.campaignDetail_changeImage({ label })
			: m.campaignDetail_addImage({ label })}
		title={url ? m.campaignDetail_changeImage({ label }) : m.campaignDetail_addImage({ label })}
		class={cn(
			'group/img bg-muted border-border relative block size-full overflow-hidden rounded-lg border',
			canWrite && !working && 'hover:border-primary cursor-pointer'
		)}
		onclick={() => fileInput?.click()}
	>
		{#if url}
			<img src={url} alt="" class="size-full object-cover" />
		{:else}
			<span class="text-muted-foreground flex size-full items-center justify-center">
				<ImageIcon class="size-8" aria-hidden="true" />
			</span>
		{/if}
		{#if canWrite && !working}
			<span
				class="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50 text-white opacity-0 transition-opacity group-hover/img:opacity-100"
			>
				<UploadIcon class="size-5" aria-hidden="true" />
				<span class="text-xs font-medium">{m.campaignDetail_uploadImage()}</span>
			</span>
		{/if}
	</button>

	{#if working}
		<span class="bg-card/70 absolute inset-0 flex items-center justify-center rounded-lg">
			<Spinner size="sm" />
		</span>
	{/if}

	{#if url && canWrite && !working}
		<button
			type="button"
			aria-label={m.campaignDetail_removeImage({ label })}
			title={m.campaignDetail_removeImage({ label })}
			class="bg-card text-muted-foreground hover:text-foreground border-border absolute -top-2 -right-2 rounded-full border p-1 shadow-sm"
			onclick={clear}
		>
			<XIcon class="size-3.5" aria-hidden="true" />
		</button>
	{/if}
</div>
