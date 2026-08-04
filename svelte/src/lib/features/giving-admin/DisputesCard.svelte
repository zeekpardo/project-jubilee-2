<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { api } from '$convex/_generated/api';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	let { canRead }: { canRead: boolean } = $props();

	const auth = useAuth();
	const response = useQuery(api.stripe.queries.listDisputes, () =>
		auth.isAuthenticated && canRead ? {} : 'skip'
	);
	const disputes = $derived(response.data ?? []);

	// Resolved either way — the money is settled and there is nothing left to
	// do. Kept in the list but not counted as needing attention.
	const CLOSED = new Set(['won', 'lost', 'warning_closed']);
	const open = $derived(disputes.filter((dispute) => !CLOSED.has(dispute.status)));
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">{m.donations_disputesTitle()}</Card.Title>
		{#if open.length > 0}
			<Card.Description>{m.donations_disputeBody()}</Card.Description>
		{/if}
	</Card.Header>
	<Card.Content>
		{#if disputes.length === 0}
			<p class="text-muted-foreground text-sm">{m.donations_disputesEmpty()}</p>
		{:else}
			<ul class="flex flex-col gap-3">
				{#each disputes as dispute (dispute._id)}
					<li class="flex flex-wrap items-start justify-between gap-2 text-sm">
						<div>
							<div class="flex flex-wrap items-center gap-2">
								<span class="font-medium tabular-nums">{formatCents(dispute.amountCents)}</span>
								<Badge variant={CLOSED.has(dispute.status) ? 'secondary' : 'destructive'}>
									{dispute.status}
								</Badge>
							</div>
							<!-- Stripe's own reason code, verbatim. Not pretty, but it is
							     the exact word their support will ask for. -->
							<p class="text-muted-foreground mt-0.5 font-mono text-xs">{dispute.reason}</p>
						</div>
						{#if dispute.evidenceDueBy && !CLOSED.has(dispute.status)}
							<!-- A deadline that passes in silence and loses the dispute
							     by default, on money that came out of the nonprofit's
							     balance rather than ours. -->
							<span class="text-destructive text-xs font-medium">
								{m.donations_disputeRespondBy({
									date: new Date(dispute.evidenceDueBy).toLocaleDateString()
								})}
							</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
