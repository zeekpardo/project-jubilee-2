<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { ConvexError } from 'convex/values';
	import { toast } from 'svelte-sonner';

	import { Spinner } from '$lib/primitives/ui/spinner';
	import { cn } from '$lib/primitives/utils';
	import ImageIcon from '@lucide/svelte/icons/image';
	import XIcon from '@lucide/svelte/icons/x';

	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	let {
		projectId,
		canWrite = false,
		class: className
	}: {
		projectId: Id<'projects'>;
		canWrite?: boolean;
		class?: string;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	const MAX_BYTES = 10 * 1024 * 1024;

	const photoResponse = useQuery(api.projects.detail.getProjectPhotoUrl, () => ({ projectId }));
	const photoUrl = $derived(photoResponse.data ?? null);

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
			const uploadUrl = await client.mutation(api.projects.detail.generatePhotoUploadUrl, {
				projectId
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

			await client.mutation(api.projects.detail.setProjectPhoto, {
				projectId,
				storageId: body.storageId
			});
			toast.success(m.projectDetail_photoSaved());
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
			toast.error(m.projectDetail_photoTooLarge());
			return;
		}
		void upload(file);
	}

	async function clear(): Promise<void> {
		working = true;
		try {
			await client.mutation(api.projects.detail.clearProjectPhoto, { projectId });
		} catch (error: unknown) {
			fail(error);
		} finally {
			working = false;
		}
	}
</script>

<div class={cn('relative size-32 shrink-0', className)}>
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
		aria-label={photoUrl ? m.projectDetail_changePhoto() : m.projectDetail_addPhoto()}
		title={photoUrl ? m.projectDetail_changePhoto() : m.projectDetail_addPhoto()}
		class={cn(
			'bg-muted border-border size-32 overflow-hidden rounded-xl border',
			canWrite && !working && 'hover:border-primary cursor-pointer'
		)}
		onclick={() => fileInput?.click()}
	>
		{#if photoUrl}
			<img src={photoUrl} alt="" class="size-full object-cover" />
		{:else}
			<span class="text-muted-foreground flex size-full items-center justify-center">
				<ImageIcon class="size-8" aria-hidden="true" />
			</span>
		{/if}
	</button>

	{#if working}
		<span class="bg-card/70 absolute inset-0 flex items-center justify-center rounded-xl">
			<Spinner size="sm" />
		</span>
	{/if}

	{#if photoUrl && canWrite}
		<button
			type="button"
			disabled={working}
			aria-label={m.projectDetail_removePhoto()}
			title={m.projectDetail_removePhoto()}
			class="bg-card text-muted-foreground hover:text-foreground border-border absolute -top-2 -right-2 rounded-full border p-1 shadow-sm"
			onclick={clear}
		>
			<XIcon class="size-3.5" aria-hidden="true" />
		</button>
	{/if}
</div>
