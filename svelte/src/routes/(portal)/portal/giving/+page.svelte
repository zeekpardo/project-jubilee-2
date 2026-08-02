<script lang="ts">
	import { useQuery } from '@mmailaender/convex-svelte';
	import { useAuth } from '@mmailaender/convex-better-auth-svelte/svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { resolve } from '$app/paths';
	import { formatCents } from '$lib/features/money/format';
	import { EmptyState } from '$lib/primitives/ui/empty-state';
	import * as m from '$lib/i18n/messages';

	const { api } = getAuthContext();
	const auth = useAuth();

	const givingResponse = useQuery(api.portal.queries.listPortalGiving, () =>
		auth.isAuthenticated ? {} : 'skip'
	);
	const giving = $derived(givingResponse.data);

	function formatDate(occurredOn: string | null): string {
		return occurredOn ? new Date(occurredOn).toLocaleDateString() : m.portal_giftDateUnknown();
	}
</script>

<svelte:head>
	<title>{m.portal_givingTitle()}</title>
</svelte:head>

<header>
	<h1 class="ps-serif text-foreground text-3xl leading-tight">{m.portal_givingTitle()}</h1>
	<p class="text-muted-foreground mt-2 max-w-xl text-sm leading-relaxed">
		{m.portal_givingSubtitle()}
	</p>
</header>

{#if giving}
	{#if giving.truncated}
		<p class="text-muted-foreground mt-4 text-xs">{m.portal_givingTruncated()}</p>
	{/if}

	{#if giving.gifts.length === 0}
		<div class="mt-8">
			<EmptyState title={m.portal_givingEmpty()} />
		</div>
	{:else}
		<ul class="mt-6 flex flex-col gap-4">
			{#each giving.gifts as gift (gift.id)}
				<li class="bg-card ring-border rounded-xl p-5 shadow-xs ring-1">
					<div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
						<p class="text-muted-foreground text-sm">{formatDate(gift.occurredOn)}</p>
						<p class="ps-serif text-foreground text-xl">{formatCents(gift.amountCents)}</p>
					</div>

					{#if gift.method || gift.reference}
						<p class="text-muted-foreground mt-1 text-xs">
							{[gift.method, gift.reference].filter(Boolean).join(' · ')}
						</p>
					{/if}

					{#if gift.receiptUrl}
						<!-- An arbitrary URL an admin filed against the gift, so there is no
						     route to resolve — it leaves the app entirely, which is what
						     target and rel are saying. -->
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							href={gift.receiptUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="text-primary mt-2 inline-block text-sm font-medium hover:underline"
						>
							{m.portal_giftReceipt()}
						</a>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					{/if}

					{#if gift.allocations.length > 0}
						<ul class="border-border/60 mt-3 flex flex-col gap-1 border-t pt-3">
							{#each gift.allocations as allocation, index (index)}
								<li class="flex items-baseline justify-between gap-4 text-sm">
									{#if allocation.number}
										<a
											href={resolve('/(portal)/portal/records/[number]', {
												number: allocation.number
											})}
											class="text-foreground hover:text-primary transition-colors"
										>
											{allocation.name ?? allocation.number}
										</a>
									{:else}
										<span class="text-muted-foreground">{m.portal_giftUnallocated()}</span>
									{/if}
									<span class="text-muted-foreground">{formatCents(allocation.amountCents)}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
{/if}
