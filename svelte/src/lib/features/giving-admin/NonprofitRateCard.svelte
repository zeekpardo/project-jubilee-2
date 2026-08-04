<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as m from '$lib/i18n/messages';

	// Costs us nothing and is a genuine differentiator: because this platform
	// uses direct charges, the org applies for Stripe's nonprofit rate itself
	// and KEEPS the benefit. On a destination-charge platform the discount is
	// structurally unreachable, so most of this org's alternatives cannot offer
	// it at all.
	//
	// The 80% warning is the part orgs get wrong. Running a gala's ticket sales
	// through the same Stripe account can push tax-deductible volume below the
	// threshold and cost them the discount entirely.
	const HELP_URL = 'https://support.stripe.com/questions/fee-discount-for-nonprofit-organizations';
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.giving_nonprofitTitle()}</Card.Title>
	</Card.Header>
	<Card.Content class="flex flex-col gap-3">
		<p class="text-muted-foreground text-sm leading-relaxed">{m.giving_nonprofitBody()}</p>
		<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
		<a
			href={HELP_URL}
			target="_blank"
			rel="noopener noreferrer"
			class="text-primary text-sm underline underline-offset-4"
		>
			{m.giving_nonprofitCta()}
		</a>
	</Card.Content>
</Card.Root>
