<script lang="ts">
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import * as m from '$lib/i18n/messages';

	let { canEdit = false }: { canEdit?: boolean } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const client = useConvexClient();

	const settingsResponse = useQuery(api.orgSettings.queries.getOrgSettings, () =>
		auth.isAuthenticated && canEdit ? {} : 'skip'
	);
	const settings = $derived(settingsResponse?.data);
	const loading = $derived(settingsResponse?.isLoading ?? false);

	let slug = $state('');
	let publicName = $state('');
	let publicTagline = $state('');
	let campaignLabel = $state('');
	let campaignLabelPlural = $state('');
	let saving = $state(false);
	let errorMessage = $state('');
	let loaded = $state(false);

	// Seed once from the server; re-seeding on every response would fight typing.
	$effect(() => {
		if (loaded || !settings) return;
		slug = settings.slug ?? '';
		publicName = settings.publicName ?? '';
		publicTagline = settings.publicTagline ?? '';
		campaignLabel = settings.campaignLabel ?? '';
		campaignLabelPlural = settings.campaignLabelPlural ?? '';
		loaded = true;
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		saving = true;
		errorMessage = '';
		try {
			await client.mutation(api.orgSettings.mutations.upsertOrgSettings, {
				slug: slug.trim() || undefined,
				publicName: publicName.trim() || undefined,
				publicTagline: publicTagline.trim() || undefined,
				campaignLabel: campaignLabel.trim() || undefined,
				campaignLabelPlural: campaignLabelPlural.trim() || undefined
			});
			toast.success(m.org_settingsSaved());
		} catch (error) {
			errorMessage = error instanceof ConvexError ? String(error.data) : m.state_saveFailed();
		} finally {
			saving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.org_settingsTitle()}</Card.Title>
		<Card.Description>{m.org_settingsBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		{#if loading}
			<div class="flex flex-col gap-2">
				<Skeleton class="h-9 w-full" />
				<Skeleton class="h-9 w-full" />
			</div>
		{:else}
			<form class="flex flex-col gap-4" onsubmit={save}>
				<div class="flex flex-col gap-1.5">
					<Label for="org-slug">{m.org_slug()}</Label>
					<Input id="org-slug" bind:value={slug} disabled={!canEdit} />
					<p class="text-muted-foreground text-xs">{m.org_slugHelp()}</p>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="org-public-name">{m.org_publicName()}</Label>
						<Input id="org-public-name" bind:value={publicName} disabled={!canEdit} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="org-tagline">{m.org_publicTagline()}</Label>
						<Input id="org-tagline" bind:value={publicTagline} disabled={!canEdit} />
					</div>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-1.5">
						<Label for="org-campaign-label">{m.org_campaignLabel()}</Label>
						<Input id="org-campaign-label" bind:value={campaignLabel} disabled={!canEdit} />
					</div>
					<div class="flex flex-col gap-1.5">
						<Label for="org-campaign-plural">{m.org_campaignLabelPlural()}</Label>
						<Input id="org-campaign-plural" bind:value={campaignLabelPlural} disabled={!canEdit} />
					</div>
				</div>

				{#if errorMessage}
					<p class="text-destructive text-sm">{errorMessage}</p>
				{/if}

				{#if canEdit}
					<div>
						<Button type="submit" loading={saving}>{m.action_saveChanges()}</Button>
					</div>
				{/if}
			</form>
		{/if}
	</Card.Content>
</Card.Root>
