<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
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

	let publicName = $state('');
	let publicTagline = $state('');
	let isSaving = $state(false);

	// The page only mounts this card once the settings query has resolved, so
	// a plain one-time seed is enough — a later live update never fights
	// in-progress typing.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		publicName = settings?.publicName ?? '';
		publicTagline = settings?.publicTagline ?? '';
		loaded = true;
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.orgSettings.mutations.upsertOrgSettings, {
				publicName: publicName.trim() || undefined,
				publicTagline: publicTagline.trim() || undefined
			});
			toast.success(m.publicSiteSettings_identitySaved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.publicSiteSettings_identityTitle()}</Card.Title>
		<Card.Description>{m.publicSiteSettings_identityBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-4" onsubmit={save}>
			<div class="flex flex-col gap-1.5">
				<Label for="public-site-name">{m.org_publicName()}</Label>
				<Input id="public-site-name" bind:value={publicName} disabled={!canWrite} />
				<p class="text-muted-foreground text-xs">{m.publicSiteSettings_publicNameHelp()}</p>
			</div>
			<div class="flex flex-col gap-1.5">
				<Label for="public-site-tagline">{m.org_publicTagline()}</Label>
				<Textarea
					id="public-site-tagline"
					bind:value={publicTagline}
					rows={2}
					disabled={!canWrite}
				/>
				<p class="text-muted-foreground text-xs">{m.publicSiteSettings_taglineHelp()}</p>
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
