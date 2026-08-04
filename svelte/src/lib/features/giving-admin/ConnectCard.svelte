<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Badge } from '$lib/primitives/ui/badge';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';

	import * as m from '$lib/i18n/messages';
	import type { ConnectAccount } from './types';

	let { account }: { account: ConnectAccount | null } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let isWorking = $state(false);

	const STATUS_LABELS: Record<string, () => string> = {
		onboarding: m.giving_status_onboarding,
		pending_review: m.giving_status_pending_review,
		action_required: m.giving_status_action_required,
		charges_only: m.giving_status_charges_only,
		active: m.giving_status_active,
		restricted: m.giving_status_restricted,
		rejected: m.giving_status_rejected
	};

	// `charges_only` is not a success and not a failure: money is arriving but
	// the org cannot withdraw it. Colouring it like `active` would bury the one
	// state that costs an org real money while looking fine.
	const STATUS_VARIANTS: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
		onboarding: 'secondary',
		pending_review: 'secondary',
		action_required: 'destructive',
		charges_only: 'destructive',
		active: 'default',
		restricted: 'destructive',
		rejected: 'destructive'
	};

	/**
	 * Both buttons redirect rather than opening a dialog, because an Account
	 * Link is single-use and expires in five minutes. Minting one into a page
	 * that might sit open, or emailing it, produces a dead link and a confused
	 * finance director.
	 */
	async function start(): Promise<void> {
		if (isWorking) return;
		isWorking = true;
		try {
			const result = account
				? await client.action(api.stripe.accounts.createOnboardingLink, {
						origin: window.location.origin
					})
				: await client.action(api.stripe.accounts.createConnectedAccount, {
						origin: window.location.origin
					});
			window.location.href = result.url;
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
			isWorking = false;
		}
	}

	async function recheck(): Promise<void> {
		if (isWorking) return;
		isWorking = true;
		try {
			await client.action(api.stripe.accounts.refreshAccountStatus, {});
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isWorking = false;
		}
	}

	const deadline = $derived(
		account?.requirementsCurrentDeadline
			? new Date(account.requirementsCurrentDeadline * 1000).toLocaleDateString()
			: null
	);
</script>

<Card.Root>
	<Card.Header>
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0">
				<Card.Title>{m.giving_title()}</Card.Title>
				<Card.Description>
					{account ? m.giving_accountLabel() : m.giving_notConnectedBody()}
				</Card.Description>
			</div>
			{#if account}
				<Badge variant={STATUS_VARIANTS[account.status] ?? 'secondary'}>
					{STATUS_LABELS[account.status]?.() ?? account.status}
				</Badge>
			{/if}
		</div>
	</Card.Header>

	<Card.Content class="flex flex-col gap-4">
		{#if account}
			<p class="text-muted-foreground font-mono text-xs">{account.stripeAccountId}</p>

			{#if !account.livemode}
				<p class="text-muted-foreground text-sm" role="status">
					{m.giving_testModeNotice()}
				</p>
			{/if}

			{#if account.status === 'charges_only'}
				<div class="border-destructive/40 bg-destructive/5 rounded-lg border p-3">
					<p class="text-sm font-medium">{m.giving_chargesOnlyTitle()}</p>
					<p class="text-muted-foreground mt-1 text-sm">{m.giving_chargesOnlyBody()}</p>
				</div>
			{/if}

			{#if account.requirementsPastDue.length > 0 || account.requirementsCurrentlyDue.length > 0}
				<div class="border-border rounded-lg border p-3">
					<p class="text-sm font-medium">
						{account.requirementsPastDue.length > 0
							? m.giving_pastDueTitle()
							: m.giving_requirementsTitle()}
					</p>
					<p class="text-muted-foreground mt-1 text-sm">{m.giving_requirementsBody()}</p>
					{#if deadline}
						<p class="text-muted-foreground mt-1 text-sm">
							{m.giving_deadlineNotice({ date: deadline })}
						</p>
					{/if}
					<!--
						Stripe's own requirement keys, shown verbatim. They are not
						pretty ('company.verification.document'), but they are precise,
						and an owner on the phone to Stripe support is far better served
						by the exact key than by our paraphrase of it.
					-->
					<ul class="text-muted-foreground mt-2 list-inside list-disc font-mono text-xs">
						{#each [...account.requirementsPastDue, ...account.requirementsCurrentlyDue] as requirement (requirement)}
							<li>{requirement}</li>
						{/each}
					</ul>
				</div>
			{/if}
		{:else}
			<p class="text-muted-foreground text-sm leading-relaxed">
				{m.giving_notConnectedNext()}
			</p>
		{/if}

		<div class="flex flex-wrap gap-2">
			<Button onclick={start} loading={isWorking} disabled={isWorking}>
				{#if !account}
					{isWorking ? m.giving_connectStarting() : m.giving_connectCta()}
				{:else}
					{m.giving_continueSetup()}
				{/if}
			</Button>
			{#if account}
				<Button variant="outline" onclick={recheck} disabled={isWorking}>
					{isWorking ? m.giving_rechecking() : m.giving_recheck()}
				</Button>
			{/if}
		</div>
	</Card.Content>
</Card.Root>
