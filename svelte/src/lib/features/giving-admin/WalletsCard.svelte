<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import * as m from '$lib/i18n/messages';
	import type { ConnectAccount } from './types';

	let { account }: { account: ConnectAccount } = $props();

	// Reported rather than assumed, because the failure is invisible: an
	// unregistered domain does not error at checkout, it just makes the Apple
	// Pay / Google Pay / Link buttons not render. Nobody notices except as
	// unexplained conversion loss, so it has to be stated somewhere an owner
	// will actually look.
	const registered = $derived(account.walletDomainsRegistered);
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.giving_walletsTitle()}</Card.Title>
	</Card.Header>
	<Card.Content>
		{#if registered.length > 0}
			<p class="text-muted-foreground text-sm">
				{m.giving_walletsActive({ domains: registered.join(', ') })}
			</p>
		{:else}
			<p class="text-muted-foreground text-sm leading-relaxed">
				{m.giving_walletsNone()}
			</p>
		{/if}
	</Card.Content>
</Card.Root>
