<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { resolve } from '$app/paths';

	import * as Card from '$lib/primitives/ui/card';
	import * as Table from '$lib/primitives/ui/table';
	import { Button } from '$lib/primitives/ui/button';
	import { Skeleton } from '$lib/primitives/ui/skeleton';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import HandCoinsIcon from '@lucide/svelte/icons/hand-coins';
	import { Can } from '$lib/access';
	import { formatCents } from './format';
	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import RecordDonationDialog from './RecordDonationDialog.svelte';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';

	let {
		projectId,
		campaignId,
		canRead = false
	}: {
		projectId: Id<'projects'>;
		campaignId: Id<'campaigns'>;
		canRead?: boolean;
	} = $props();

	let donationOpen = $state(false);

	const { api } = getAuthContext();
	const auth = useAuth();

	const givingResponse = useQuery(api.projects.detail.listDonationsForProject, () =>
		auth.isAuthenticated && canRead ? { projectId } : 'skip'
	);
	const giving = $derived(givingResponse?.data);
	const loading = $derived(givingResponse?.isLoading ?? false);
	const donations = $derived(giving?.donations ?? []);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">{m.projectDetail_givingTitle()}</Card.Title>
		<Card.Action>
			<div class="flex items-center gap-3">
				<span class="text-muted-foreground text-sm">
					{m.projectDetail_totalRaised()}
					<span class="text-foreground font-semibold tabular-nums">
						{formatCents(giving?.totalCents ?? 0)}
					</span>
				</span>
				<!-- The UI gate is a courtesy; the mutation re-checks money:write. -->
				<Can do="money:write" {campaignId}>
					<Button variant="outline" size="sm" onclick={() => (donationOpen = true)}>
						<HandCoinsIcon class="size-4" aria-hidden="true" />
						{m.money_newDonation()}
					</Button>
				</Can>
			</div>
		</Card.Action>
	</Card.Header>
	<Card.Content>
		{#if loading}
			<div class="flex flex-col gap-2">
				<Skeleton class="h-10 w-full" />
				<Skeleton class="h-10 w-full" />
			</div>
		{:else if donations.length === 0}
			<EmptyState variant="plain" size="sm" title={m.projectDetail_noDonations()} />
		{:else}
			<Table.Root>
				<Table.Header class="bg-muted">
					<Table.Row>
						<Table.Head>{m.field_date()}</Table.Head>
						<Table.Head>{m.projectDetail_donor()}</Table.Head>
						<Table.Head>{m.money_method()}</Table.Head>
						<Table.Head class="text-right">{m.field_amount()}</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each donations as donation (donation.allocationId)}
						<Table.Row>
							<Table.Cell class="text-muted-foreground">{donation.occurredOn ?? '—'}</Table.Cell>
							<Table.Cell>
								{#if donation.contact}
									<a
										href={resolve('/app/admin/contacts/[id]', { id: donation.contact._id })}
										class="hover:underline"
									>
										{contactDisplayName(donation.contact)}
									</a>
								{:else}
									<span class="text-muted-foreground">{m.projectDetail_unattributed()}</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">
								{donation.method ?? '—'}{donation.reference ? ` (${donation.reference})` : ''}
							</Table.Cell>
							<Table.Cell class="text-right font-medium tabular-nums">
								{formatCents(donation.amountCents)}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		{/if}
	</Card.Content>
</Card.Root>

<RecordDonationDialog bind:open={donationOpen} {projectId} {campaignId} />
