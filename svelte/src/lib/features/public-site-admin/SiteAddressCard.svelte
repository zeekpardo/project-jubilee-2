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
	import type { Doc } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';

	let { settings, canWrite }: { settings: Doc<'orgSettings'> | null; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let slug = $state('');
	let isSaving = $state(false);
	let errorMessage = $state('');

	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		slug = settings?.slug ?? '';
		loaded = true;
	});

	// The public site is served at /{slug}, not a real subdomain — see
	// src/routes/(site)/[orgSlug]. Read origin at render time so this stays
	// correct in every environment without an env var to keep in sync.
	const origin = typeof window === 'undefined' ? '' : window.location.origin;
	const address = $derived(slug ? `${origin}/${slug}` : '');

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		errorMessage = '';
		try {
			await client.mutation(api.orgSettings.mutations.upsertOrgSettings, {
				slug: slug.trim() || undefined
			});
			toast.success(m.publicSiteSettings_addressSaved());
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.publicSiteSettings_addressTitle()}</Card.Title>
		<Card.Description>
			{#if address}
				{m.publicSiteSettings_addressLiveAt({ address })}
			{:else}
				{m.publicSiteSettings_addressBody()}
			{/if}
		</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-2" onsubmit={save}>
			<Label for="public-site-address">{m.org_slug()}</Label>
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center">
				<Input
					id="public-site-address"
					bind:value={slug}
					placeholder="your-org"
					disabled={!canWrite}
					class="flex-1"
				/>
				{#if canWrite}
					<Button type="submit" loading={isSaving} disabled={isSaving || !slug.trim()}>
						{m.action_saveChanges()}
					</Button>
				{/if}
			</div>
			{#if !address}
				<p class="text-muted-foreground text-xs">{m.publicSiteSettings_addressChoose()}</p>
			{/if}
			{#if errorMessage}
				<p class="text-destructive text-sm">{errorMessage}</p>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
