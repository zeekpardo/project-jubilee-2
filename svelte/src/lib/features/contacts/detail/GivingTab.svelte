<script lang="ts">
	import { resolve } from '$app/paths';
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import { getAccessContext } from '$lib/access';
	import { formatCents } from '$lib/features/money/format';
	import * as m from '$lib/i18n/messages';

	import * as Card from '$lib/primitives/ui/card';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import type { Id } from '$convex/_generated/dataModel';

	let {
		contactId,
		campaignId = null
	}: { contactId: Id<'contacts'>; campaignId?: Id<'campaigns'> | null } = $props();

	const { api } = getAuthContext();
	const auth = useAuth();
	const access = getAccessContext();

	const canRead = $derived(access.can('money:read', campaignId));

	const givingResponse = useQuery(api.contacts.detail.listDonationsForContact, () =>
		auth.isAuthenticated && canRead ? { contactId, campaignId: campaignId ?? undefined } : 'skip'
	);
	const donations = $derived(givingResponse?.data?.donations ?? []);
	const totalCents = $derived(givingResponse?.data?.totalCents ?? 0);
	const loading = $derived(givingResponse?.isLoading ?? false);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.contactDetail_donations()}</Card.Title>
		<Card.Action class="text-right">
			<p class="text-muted-foreground text-xs">{m.contactDetail_totalGiven()}</p>
			<p class="text-lg font-semibold tabular-nums">{formatCents(totalCents)}</p>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if loading}
			<div class="flex flex-col gap-2">
				<Skeleton class="h-12 w-full" />
				<Skeleton class="h-12 w-full" />
			</div>
		{:else if donations.length === 0}
			<EmptyState title={m.contactDetail_noDonations()} />
		{:else}
			<ul>
				{#each donations as donation (donation._id)}
					<li class="flex flex-wrap items-start justify-between gap-4 py-3 first:pt-0 last:pb-0">
						<div class="min-w-0">
							<p class="text-muted-foreground text-sm">{donation.occurredOn || '—'}</p>
							<p class="truncate text-sm">{donation.reference || donation.note || '—'}</p>
						</div>
						<div class="flex flex-col items-end gap-2">
							<span class="font-semibold tabular-nums">{formatCents(donation.amountCents)}</span>
							{#if donation.projects.length > 0}
								<div class="flex flex-wrap justify-end gap-1">
									{#each donation.projects as allocation, index (index)}
										{#if allocation.project}
											<Badge
												variant="secondary"
												href={resolve('/app/projects/[number]', {
													number: allocation.project.number
												})}
											>
												{allocation.project.number} · {formatCents(allocation.amountCents)}
											</Badge>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
