<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Badge } from '$lib/primitives/ui/badge';
	import GlobeIcon from '@lucide/svelte/icons/globe';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CheckIcon from '@lucide/svelte/icons/check';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	import * as m from '$lib/i18n/messages';

	// There is no domains backend yet. The row shape below (the fields a future
	// `domains` table would carry) stays in the markup — same treatment as the
	// honeypot field in InterestForm.svelte — so wiring a real list later is a
	// data change, not a UI rewrite. It never renders today because this list
	// is always empty: no placeholder rows, so nothing here can be mistaken
	// for real data.
	type Domain = { id: string; hostname: string; verified: boolean; isPrimary: boolean };
	const domains: Domain[] = [];
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.publicSiteSettings_domainsTitle()}</Card.Title>
		<Card.Description>{m.publicSiteSettings_domainsBody()}</Card.Description>
	</Card.Header>
	<Card.Content class="flex flex-col gap-4">
		<form
			class="flex flex-col gap-2 sm:flex-row"
			novalidate
			onsubmit={(event) => event.preventDefault()}
		>
			<fieldset disabled class="flex flex-1 flex-col gap-2 sm:flex-row">
				<legend class="sr-only">{m.publicSiteSettings_domainsAdd()}</legend>
				<Input class="flex-1" placeholder={m.publicSiteSettings_domainsAddPlaceholder()} />
				<Button type="submit">
					<PlusIcon />
					{m.publicSiteSettings_domainsAdd()}
				</Button>
			</fieldset>
		</form>

		{#if domains.length === 0}
			<p class="text-muted-foreground text-sm">{m.publicSiteSettings_domainsEmpty()}</p>
		{:else}
			<ul class="divide-border divide-y rounded-md border">
				{#each domains as domain (domain.id)}
					<li class="flex flex-wrap items-center gap-3 p-4">
						<GlobeIcon class="text-muted-foreground size-4" aria-hidden="true" />
						<span class="font-medium">{domain.hostname}</span>
						<Badge variant={domain.verified ? 'default' : 'secondary'}>
							{domain.verified
								? m.publicSiteSettings_domainsVerified()
								: m.publicSiteSettings_domainsPending()}
						</Badge>
						{#if domain.isPrimary}
							<Badge variant="outline">{m.publicSiteSettings_domainsPrimary()}</Badge>
						{/if}
						<div class="ml-auto flex gap-2">
							{#if !domain.verified}
								<Button variant="outline" size="sm" disabled>
									<CheckIcon />
									{m.publicSiteSettings_domainsVerify()}
								</Button>
							{/if}
							{#if domain.verified && !domain.isPrimary}
								<Button variant="outline" size="sm" disabled>
									{m.publicSiteSettings_domainsSetPrimary()}
								</Button>
							{/if}
							<Button variant="ghost" size="sm" disabled>
								<TrashIcon />
								{m.publicSiteSettings_domainsRemove()}
							</Button>
						</div>
					</li>
				{/each}
			</ul>
		{/if}

		<p class="text-muted-foreground text-sm" role="status">
			{m.publicSiteSettings_domainsNotice()}
		</p>
	</Card.Content>
</Card.Root>
