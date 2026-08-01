<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Label } from '$lib/primitives/ui/label';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { THEMES, DEFAULT_THEME } from '$lib/theme/config';
	import * as m from '$lib/i18n/messages';

	let { settings, canWrite }: { settings: Doc<'orgSettings'> | null; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let theme = $state(DEFAULT_THEME as string);
	let isSaving = $state(false);

	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		theme = settings?.theme ?? DEFAULT_THEME;
		loaded = true;
	});

	const themeCollection = createListCollection({
		items: THEMES.map((option) => ({ value: option.value, label: option.label }))
	});

	// A single-field card, so — like the reference — the select saves on
	// change rather than needing a separate button.
	async function handleChange(next: string): Promise<void> {
		if (!canWrite || !next || next === theme || isSaving) return;
		const previous = theme;
		theme = next;
		isSaving = true;
		try {
			await client.mutation(api.orgSettings.mutations.upsertOrgSettings, { theme: next });
			toast.success(m.publicSiteSettings_themeSaved());
		} catch (error) {
			theme = previous;
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.publicSiteSettings_themeTitle()}</Card.Title>
		<Card.Description>{m.publicSiteSettings_themeBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<div class="flex flex-col gap-1.5">
			<Label for="public-site-theme">{m.theme_label()}</Label>
			<!--
				The trigger's id goes through `ids`, never as an `id` prop on
				Select.Trigger. zag finds its positioning anchor with
				getElementById(ids.trigger ?? `select:<id>:trigger`), so overwriting
				the element's id makes that lookup return null — the popper then
				bails before writing --x/--y and the menu renders at the document's
				top-left instead of under the trigger.
			-->
			<Select.Root
				collection={themeCollection}
				ids={{ trigger: 'public-site-theme' }}
				value={[theme]}
				disabled={!canWrite || isSaving}
				onValueChange={(details: { value: string[] }): void => {
					const next = details.value[0];
					if (next) void handleChange(next);
				}}
			>
				<Select.Trigger class="w-full sm:w-64" placeholder={m.theme_selectPlaceholder()} />
				<Select.Content>
					{#each themeCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	</Card.Content>
</Card.Root>
