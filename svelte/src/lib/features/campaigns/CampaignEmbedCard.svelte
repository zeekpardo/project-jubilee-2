<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import CheckIcon from '@lucide/svelte/icons/check';
	import { toast } from 'svelte-sonner';
	import * as m from '$lib/i18n/messages';
	import type { Doc } from '$convex/_generated/dataModel';

	let { campaign, orgSlug }: { campaign: Doc<'campaigns'>; orgSlug: string | null } = $props();

	// Built from the browser's own origin so the snippet an admin copies points
	// at whatever host they are actually using — dev, staging or production —
	// rather than a value baked in at build time.
	const origin = $derived(typeof window === 'undefined' ? '' : window.location.origin);

	const snippets = $derived(
		orgSlug === null
			? []
			: [
					{
						key: 'stats',
						label: m.campaignEmbed_stats(),
						hint: null,
						code: `<div data-jubilee-embed="stats"\n     data-org="${orgSlug}"\n     data-campaign="${campaign.slug}"></div>`
					},
					{
						key: 'grid',
						label: m.campaignEmbed_grid(),
						hint: null,
						code: `<div data-jubilee-embed="grid"\n     data-org="${orgSlug}"\n     data-campaign="${campaign.slug}"\n     data-object="${campaign.objectSlug}"></div>`
					},
					{
						key: 'record',
						label: m.campaignEmbed_record(),
						hint: m.campaignEmbed_recordHint({ number: `${campaign.numberPrefix}-001` }),
						code: `<div data-jubilee-embed="record"\n     data-org="${orgSlug}"\n     data-campaign="${campaign.slug}"\n     data-object="${campaign.objectSlug}"\n     data-number="${campaign.numberPrefix}-001"></div>`
					}
				]
	);

	const scriptTag = $derived(`<script src="${origin}/embed.js" async><\/script>`);

	let copiedKey = $state<string | null>(null);

	async function copy(key: string, text: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			copiedKey = key;
			setTimeout(() => {
				if (copiedKey === key) copiedKey = null;
			}, 2000);
		} catch {
			// Clipboard access can be refused outright (permissions, or a
			// non-secure origin), and a silent no-op would look like the button
			// is broken.
			toast.error(m.state_saveFailed());
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.campaignEmbed_title()}</Card.Title>
		<Card.Description>{m.campaignEmbed_body()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-5">
		{#if orgSlug === null}
			<p class="text-muted-foreground text-sm">{m.campaignEmbed_noSlug()}</p>
		{:else}
			{#if !campaign.isPublished}
				<p class="text-muted-foreground text-sm">{m.campaignEmbed_unpublished()}</p>
			{/if}

			{#each snippets as snippet (snippet.key)}
				<div class="flex flex-col gap-1.5">
					<div class="flex items-center justify-between gap-3">
						<span class="text-sm font-medium">{snippet.label}</span>
						<Button
							variant="outline"
							size="sm"
							onclick={() => copy(snippet.key, snippet.code)}
							aria-label="{m.campaignEmbed_copy()} — {snippet.label}"
						>
							{#if copiedKey === snippet.key}
								<CheckIcon class="size-3.5" aria-hidden="true" />
								{m.campaignEmbed_copied()}
							{:else}
								<CopyIcon class="size-3.5" aria-hidden="true" />
								{m.campaignEmbed_copy()}
							{/if}
						</Button>
					</div>
					<pre
						class="bg-muted/50 ring-border overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed ring-1"><code
							>{snippet.code}</code
						></pre>
					{#if snippet.hint}
						<p class="text-muted-foreground text-xs">{snippet.hint}</p>
					{/if}
				</div>
			{/each}

			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between gap-3">
					<span class="text-sm font-medium">{m.campaignEmbed_scriptNote()}</span>
					<Button
						variant="outline"
						size="sm"
						onclick={() => copy('script', scriptTag)}
						aria-label="{m.campaignEmbed_copy()} — script"
					>
						{#if copiedKey === 'script'}
							<CheckIcon class="size-3.5" aria-hidden="true" />
							{m.campaignEmbed_copied()}
						{:else}
							<CopyIcon class="size-3.5" aria-hidden="true" />
							{m.campaignEmbed_copy()}
						{/if}
					</Button>
				</div>
				<pre
					class="bg-muted/50 ring-border overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed ring-1"><code
						>{scriptTag}</code
					></pre>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
