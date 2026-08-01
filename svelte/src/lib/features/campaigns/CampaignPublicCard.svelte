<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Switch } from '$lib/primitives/ui/switch';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { THEMES } from '$lib/theme/config';
	import { campaignPublicPath } from './publicUrl';
	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		campaign,
		canWrite,
		orgSlug
	}: { campaign: Campaign; canWrite: boolean; orgSlug: string | null } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let summary = $state('');
	let story = $state('');
	let accent = $state('');
	let theme = $state('');
	let isPublished = $state(false);
	let isSaving = $state(false);

	// One-time seed — the parent page only mounts this card once the campaign
	// has finished loading, so a live update never has a chance to fight
	// in-progress typing.
	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		summary = campaign.summary ?? '';
		story = campaign.story ?? '';
		accent = campaign.accent ?? '';
		theme = campaign.theme ?? '';
		isPublished = campaign.isPublished;
		loaded = true;
	});

	const themeCollection = createListCollection({
		items: THEMES.map((option) => ({ value: option.value, label: option.label }))
	});

	// Reflects the campaign as actually saved, not the pending toggle below —
	// there is nothing to view until the published state has been saved.
	const publicPath = $derived(
		campaign.isPublished ? campaignPublicPath(orgSlug, campaign.slug, campaign.objectSlug) : null
	);

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		isSaving = true;
		try {
			await client.mutation(api.campaigns.mutations.updateCampaign, {
				campaignId: campaign._id,
				summary: summary.trim() || undefined,
				story: story.trim() || undefined,
				accent: accent.trim() || undefined,
				theme: theme || undefined,
				isPublished
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
		<Card.Title>{m.campaignDetail_publicTitle()}</Card.Title>
		<Card.Description>{m.campaignDetail_publicBody()}</Card.Description>
		{#if publicPath}
			<Card.Action>
				<Button variant="outline" href={publicPath} target="_blank" rel="noreferrer">
					<ExternalLinkIcon class="size-4" aria-hidden="true" />
					{m.campaignDetail_viewPublicPage()}
				</Button>
			</Card.Action>
		{/if}
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-8" onsubmit={save}>
			<div class="flex flex-col gap-4">
				<div class="text-muted-foreground text-xs font-medium tracking-wide uppercase">
					{m.campaignDetail_sectionPresentation()}
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-theme">{m.theme_label()}</Label>
						<Select.Root
							collection={themeCollection}
							ids={{ trigger: 'campaign-settings-theme' }}
							value={theme ? [theme] : []}
							disabled={!canWrite}
							onValueChange={(details: { value: string[] }): void => {
								theme = details.value[0] ?? '';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.theme_selectPlaceholder()} />
							<Select.Content>
								{#each themeCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
					<div class="flex flex-col gap-2">
						<Label for="campaign-settings-accent">{m.campaignDetail_accent()}</Label>
						<Input
							id="campaign-settings-accent"
							bind:value={accent}
							placeholder={m.campaignDetail_accentPlaceholder()}
							disabled={!canWrite}
						/>
					</div>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-summary">{m.campaignDetail_summary()}</Label>
					<Textarea
						id="campaign-settings-summary"
						bind:value={summary}
						rows={3}
						placeholder={m.campaignDetail_summaryPlaceholder()}
						disabled={!canWrite}
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label for="campaign-settings-story">{m.campaignDetail_story()}</Label>
					<Textarea
						id="campaign-settings-story"
						bind:value={story}
						rows={5}
						placeholder={m.campaignDetail_storyPlaceholder()}
						disabled={!canWrite}
					/>
				</div>
				<div class="flex items-start justify-between gap-4 rounded-md border p-4">
					<div class="min-w-0">
						<Label>{m.campaigns_published()}</Label>
						<p class="text-muted-foreground mt-1 text-sm">
							{m.campaignDetail_isPublishedHelp()}
						</p>
					</div>
					<Switch
						checked={isPublished}
						disabled={!canWrite}
						onCheckedChange={(details: SwitchCheckedChangeDetails): void => {
							isPublished = details.checked;
						}}
					/>
				</div>
			</div>

			{#if canWrite}
				<div class="flex justify-end">
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
