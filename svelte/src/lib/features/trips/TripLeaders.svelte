<script lang="ts">
	// "Eman Hernandez (Coordinator)" — three fields from three sources: the name
	// from the contact, the parenthetical from `role`, and membership of this list
	// from `isLeader`. No string matching on the role, which is free text an org
	// spells however it likes.

	import { resolve } from '$app/paths';
	import * as Card from '$lib/primitives/ui/card';
	import { Skeleton } from '$lib/primitives/ui/skeleton';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import { contactDisplayName } from '$lib/features/contacts/contact-name';
	import * as m from '$lib/i18n/messages';

	let { tripId }: { tripId: Id<'trips'> } = $props();

	const { api } = getAuthContext();

	const leadersResponse = useQuery(api.tripAttendees.queries.listTripLeaders, () => ({ tripId }));
	const leaders = $derived(leadersResponse.data ?? []);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.tripDetail_leaders()}</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if leadersResponse.isLoading}
			<Skeleton class="h-5 w-64" />
		{:else if leaders.length === 0}
			<p class="text-muted-foreground text-sm">{m.tripDetail_noLeaders()}</p>
		{:else}
			<ul class="flex flex-wrap gap-x-6 gap-y-2 text-sm">
				{#each leaders as leader (leader._id)}
					<li>
						{#if leader.contact}
							<a
								class="font-medium hover:underline"
								href={resolve('/app/admin/contacts/[id]', { id: leader.contact._id })}
							>
								{contactDisplayName(leader.contact)}
							</a>
						{:else}
							<span class="font-medium">—</span>
						{/if}
						{#if leader.role}
							<span class="text-muted-foreground">({leader.role})</span>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</Card.Content>
</Card.Root>
