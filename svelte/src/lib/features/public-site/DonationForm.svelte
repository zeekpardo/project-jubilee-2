<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';

	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { formatCents } from '$lib/features/money/format';
	import { getSiteViewerContext } from '$lib/features/site/context.svelte';
	import * as m from '$lib/i18n/messages';

	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { api } from '$convex/_generated/api';
	import { ConvexError } from 'convex/values';
	import PaymentElement from '$lib/features/donate/PaymentElement.svelte';
	import { hasPublishableKey } from '$lib/features/donate/stripe-client';
	import { MIN_FEE_COVER_CENTS, computeGiftAmounts, giftAmountProblem } from '$lib/domain/giving';

	// Everything a Stripe Connect charge needs EXCEPT the payment details.
	// Card numbers must never touch an input this app renders — Stripe's
	// Payment Element collects them in an iframe on Stripe's origin, so the org
	// stays out of PCI scope. This form gathers the amount, cadence and donor
	// identity, then hands off to that element.
	let {
		orgSlug,
		campaignSlug,
		projectNumber,
		remainingCents = null
	}: {
		orgSlug: string;
		campaignSlug: string;
		projectNumber?: string;
		remainingCents?: number | null;
	} = $props();

	const client = useConvexClient();

	// Whether giving is on is DERIVED from the org's Stripe account status, not
	// passed in as a prop. A hardcoded flag is how a campaign ends up showing a
	// working form for an account Stripe has restricted.
	const givingResponse = useQuery(api.stripe.donations.getGivingStatus, () => ({
		orgSlug,
		campaignSlug
	}));
	const giving = $derived(givingResponse.data ?? null);

	const disabled = $derived(
		!hasPublishableKey() || giving === null || giving.acceptsGifts === false
	);

	// Sensible defaults until a campaign can configure its own ladder.
	const PRESETS_CENTS = [2500, 5000, 10000, 25000];

	let selectedCents = $state<number | null>(5000);
	let customAmount = $state('');
	let frequency = $state<'once' | 'monthly'>('once');
	let coverFees = $state(false);
	let anonymous = $state(false);

	// Owned by the DOM rather than $state in the original, but the payment step
	// has to send them to Convex for the receipt, so they are bound now.
	let donorName = $state('');
	let donorEmail = $state('');
	let message = $state('');
	let website = $state('');

	function choosePreset(cents: number): void {
		selectedCents = cents;
		customAmount = '';
	}

	const intendedCents = $derived.by(() => {
		if (customAmount.trim() !== '') {
			const dollars = Number(customAmount);
			return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
		}
		return selectedCents ?? 0;
	});

	// The same function the server runs, from `$lib/domain/giving`. Two
	// implementations of this formula would eventually disagree, and the
	// disagreement would be a donor charged a total they never saw.
	const amounts = $derived(
		giving && intendedCents > 0
			? computeGiftAmounts({
					intendedCents,
					coverFees,
					feeRate: giving.feeRate,
					feeFixedCents: giving.feeFixedCents,
					platformFeeBps: 0
				})
			: null
	);

	// Offered only where it is not absurd. Below the floor the fixed 30¢
	// dominates and the ask reads as a surcharge.
	const feeCoverAvailable = $derived(intendedCents >= MIN_FEE_COVER_CENTS);
	const feeCoverAddition = $derived(
		amounts && amounts.coverFees ? amounts.chargedCents - amounts.intendedCents : 0
	);

	// --- Payment step ---------------------------------------------------
	// Two steps rather than one, because the Payment Element cannot be mounted
	// until a PaymentIntent exists, and creating an intent needs the amount.

	type Started = {
		clientSecret: string;
		stripeAccountId: string;
		donationIntentId: string;
		chargedCents: number;
	};

	let started = $state<Started | null>(null);
	let isStarting = $state(false);
	let formError = $state<string | null>(null);
	let paymentElement = $state<ReturnType<typeof PaymentElement> | null>(null);

	// Stripe appends `payment_intent` to the return URL but NOT the connected
	// account id, which `retrievePaymentIntent` would need. So our own donation
	// id goes in the URL and the thanks page resolves everything from that —
	// by subscribing to the row, which updates live as the webhook lands.
	const thanksUrl = $derived(
		started
			? `${page.url.origin}${resolve('/(site)/[orgSlug]/[campaignSlug]/thanks', {
					orgSlug,
					campaignSlug
				})}?d=${started.donationIntentId}`
			: ''
	);

	async function startGift(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isStarting || disabled) return;

		formError = null;

		if (giftAmountProblem(intendedCents) !== null) {
			formError = m.publicSite_donateAmountInvalid();
			return;
		}
		if (donorEmail.trim() === '') {
			formError = m.publicSite_donateEmailRequired();
			return;
		}

		isStarting = true;
		try {
			const args = {
				orgSlug,
				campaignSlug,
				projectNumber,
				intendedCents,
				coverFees,
				donorName: donorName.trim() || undefined,
				donorEmail: donorEmail.trim(),
				anonymous,
				message: message.trim() || undefined,
				website: website.trim() || undefined
			};

			// The once/monthly toggle costs one endpoint, not one flow. Both
			// return a client secret and the same Payment Element confirms
			// either — which is precisely why this is the Payment Element and
			// not hosted Checkout.
			started =
				frequency === 'monthly'
					? await client
							.action(api.stripe.recurring.createRecurringGift, args)
							.then((r) => ({ ...r, donationIntentId: r.recurringGiftId }))
					: await client.action(api.stripe.donations.createDonationIntent, args);
		} catch (error) {
			formError = error instanceof ConvexError ? String(error.data) : m.publicSite_donateError();
		} finally {
			isStarting = false;
		}
	}

	async function onPaid(result: { ok: boolean; message?: string }): Promise<void> {
		if (!result.ok) {
			formError = result.message ?? m.publicSite_donateError();
			return;
		}
		// `thanksUrl` is already built from a resolve() of a literal route id;
		// the rule only recognises the call when it sits at the argument itself,
		// which the origin prefix and the `?d=` query string rule out. Same
		// exemption, and the same reason, as `signInHref` below.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(thanksUrl);
	}

	// Who is reading the page, if anyone. Taken from context rather than a prop
	// because this form is dropped onto project and campaign pages that know
	// nothing about identity, and the `(site)` layout is the single place the
	// answer is established. That getter throws when there is no provider, which
	// is the behaviour we want: the `(embed)` group does not inherit the `(site)`
	// layout, so an embedded copy of this form would fail loudly at the seam
	// instead of quietly rendering the signed-out version to a donor we could
	// have recognised — or, worse, a recognised donor's name onto someone else's
	// domain.
	const site = getSiteViewerContext();

	// The `(site)` layout is cached publicly at `s-maxage=300`, so its HTML is
	// shared by every visitor a CDN hands it to. A name rendered on the server
	// would therefore be one donor's identity served to the next stranger who
	// asks for the page. `hydrated` is only ever set from an effect, which does
	// not run during SSR and runs after the first client render, so the cached
	// markup and the first client render are both the anonymous form and the
	// greeting is filled in afterwards.
	//
	// `svelte/prefer-writable-derived` is disabled rather than followed here: a
	// `$derived` evaluates during SSR, which is precisely the render this flag
	// exists to keep anonymous. The rule's fix would put the donor's name back
	// into the cached HTML.
	// eslint-disable-next-line svelte/prefer-writable-derived
	let hydrated = $state(false);
	$effect(() => {
		hydrated = true;
	});

	// Null while loading, while signed out, and on any failure — all three are
	// the anonymous form, because a personalization that cannot resolve must only
	// ever cost the personalization, never the ability to give.
	const viewerName = $derived(hydrated ? (site.viewer?.displayName ?? null) : null);

	// "Not you?" records WHICH name it dismissed rather than flipping a boolean,
	// so the answer stays attached to the person it was about: if the viewer ever
	// changes underneath the form, the previous dismissal no longer matches and
	// the new donor is greeted normally.
	let dismissedName = $state<string | null>(null);

	const prefilledName = $derived(
		viewerName !== null && viewerName !== dismissedName ? viewerName : ''
	);

	// Seeds the bound field once per identity change rather than continuously,
	// so a donor typing a spouse's name is never overwritten by their own.
	let seededFor = $state<string | null>(null);
	$effect(() => {
		const key = `${viewerName ?? ''}|${dismissedName ?? ''}`;
		if (seededFor === key) return;
		seededFor = key;
		donorName = prefilledName;
	});

	// Back to this exact page after signing in, so a donor returns to the project
	// they were reading rather than to the org's front door. The login page runs
	// the value through `safeRedirectTo` before it is used, and this one is built
	// from `page.url` rather than from anything a visitor supplied.
	const signInHref = $derived(
		`${resolve('/(site)/[orgSlug]/login', { orgSlug: site.orgSlug })}?redirectTo=${encodeURIComponent(
			page.url.pathname + page.url.search
		)}`
	);
</script>

<form class="space-y-5" novalidate onsubmit={startGift}>
	{#if started}
		<!--
			The details step is replaced rather than hidden. Leaving it editable
			beside a mounted Payment Element would let a donor change the amount
			after the intent was created, so the figure on screen would stop
			matching the figure Stripe is about to charge.
		-->
		<div class="space-y-4">
			<div class="flex items-baseline justify-between gap-2">
				<h3 class="text-base font-semibold">{m.publicSite_donatePayTitle()}</h3>
				<span class="text-sm font-semibold tabular-nums">
					{m.publicSite_donateTotalCharged({ amount: formatCents(started.chargedCents) })}
				</span>
			</div>

			<!--
				`{#key}` on the client secret is load-bearing: `clientSecret` is
				NOT an updatable Elements option, so a new intent needs a whole
				new Elements instance rather than an update to the existing one.
			-->
			{#key started.clientSecret}
				<PaymentElement
					bind:this={paymentElement}
					stripeAccountId={started.stripeAccountId}
					clientSecret={started.clientSecret}
					returnUrl={thanksUrl}
					donorName={donorName.trim()}
					donorEmail={donorEmail.trim()}
					onResult={onPaid}
				/>
			{/key}

			{#if formError}
				<p role="alert" class="text-destructive text-sm">{formError}</p>
			{/if}

			<div class="flex flex-col gap-2">
				<Button type="button" size="lg" class="w-full" onclick={() => paymentElement?.confirm()}>
					{m.publicSite_donateSubmit()}
				</Button>
				<Button type="button" variant="ghost" onclick={() => (started = null)}>
					{m.publicSite_donateBack()}
				</Button>
			</div>
		</div>
	{:else}
		<fieldset {disabled} class="space-y-5">
			<legend class="sr-only">{m.publicSite_donateSubmit()}</legend>

			<div class="space-y-2">
				<div class="flex flex-wrap items-baseline justify-between gap-2">
					<Label>{m.publicSite_donateAmount()}</Label>
					{#if remainingCents !== null && remainingCents > 0}
						<span class="text-muted-foreground text-xs">
							{m.publicSite_donateRemaining({ amount: formatCents(remainingCents) })}
						</span>
					{/if}
				</div>

				<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each PRESETS_CENTS as cents (cents)}
						<button
							type="button"
							onclick={() => choosePreset(cents)}
							aria-pressed={selectedCents === cents && customAmount === ''}
							class="ring-border hover:bg-muted/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-primary rounded-lg px-3 py-2 text-sm font-semibold tabular-nums ring-1 transition-colors"
						>
							{formatCents(cents)}
						</button>
					{/each}
				</div>

				<div class="space-y-1.5">
					<Label for="donate-custom" class="text-muted-foreground text-xs font-normal">
						{m.publicSite_donateCustomAmount()}
					</Label>
					<Input
						id="donate-custom"
						name="customAmount"
						type="number"
						min={1}
						step="0.01"
						inputmode="decimal"
						bind:value={customAmount}
						oninput={() => (selectedCents = null)}
						placeholder={m.publicSite_donateOther()}
					/>
				</div>
			</div>

			<div class="space-y-2">
				<Label>{m.publicSite_donateFrequency()}</Label>
				<div class="grid grid-cols-2 gap-2">
					{#each [{ value: 'once', label: m.publicSite_donateOnce() }, { value: 'monthly', label: m.publicSite_donateMonthly() }] as option (option.value)}
						<button
							type="button"
							onclick={() => (frequency = option.value as 'once' | 'monthly')}
							aria-pressed={frequency === option.value}
							class="ring-border hover:bg-muted/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:ring-primary rounded-lg px-3 py-2 text-sm font-semibold ring-1 transition-colors"
						>
							{option.label}
						</button>
					{/each}
				</div>
			</div>

			<div class="space-y-3">
				<!-- `signInHref` is already a resolve() of a literal route id with a
				     query string appended; the rule only recognises the call when it
				     sits at the attribute itself, which a query string rules out. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				{#if viewerName === null}
					<a
						href={signInHref}
						class="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-block rounded-sm text-xs underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
					>
						{m.publicSite_donateSignInPrompt()}
					</a>
				{/if}

				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-1.5">
						<div class="flex flex-wrap items-baseline justify-between gap-2">
							<Label for="donate-name">{m.publicSite_donateName()}</Label>
							{#if prefilledName !== ''}
								<button
									type="button"
									onclick={() => (dismissedName = viewerName)}
									class="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-xs underline underline-offset-4 transition-colors focus-visible:ring-2 focus-visible:outline-none"
								>
									{m.publicSite_donateNotYou()}
								</button>
							{/if}
						</div>
						<Input
							id="donate-name"
							name="name"
							bind:value={donorName}
							minlength={2}
							maxlength={120}
							autocomplete="name"
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="donate-email">{m.publicSite_donateEmail()}</Label>
						<!--
							Still not prefilled for a recognised donor, and that is
							still a decision rather than an omission:
							`src/convex/model/site.ts` keeps the viewer's own email out
							of the public site projection, because an address belongs to
							the portal, which is served from routes that are never
							cached. Required now, though — it is where the tax receipt
							goes, and a gift we cannot acknowledge is a compliance
							problem for the nonprofit.
						-->
						<Input
							id="donate-email"
							name="email"
							type="email"
							required
							bind:value={donorEmail}
							maxlength={200}
							autocomplete="email"
						/>
						<p class="text-muted-foreground text-xs">{m.publicSite_donateEmailHint()}</p>
					</div>
				</div>
			</div>

			<div class="space-y-3">
				{#if feeCoverAvailable}
					<div class="flex items-start justify-between gap-4">
						<div class="space-y-0.5">
							<Label for="donate-cover-fees" class="font-normal">
								{m.publicSite_donateCoverFees()}
							</Label>
							{#if feeCoverAddition > 0}
								<p class="text-muted-foreground text-xs">
									{m.publicSite_donateCoverFeesHint({
										amount: formatCents(feeCoverAddition)
									})}
								</p>
							{/if}
						</div>
						<!--
							Default OFF, and it must stay that way. A pre-checked
							fee-cover toggle is a dark pattern that several state
							attorneys general have said so about in as many words.
						-->
						<Switch
							id="donate-cover-fees"
							checked={coverFees}
							onCheckedChange={(details: SwitchCheckedChangeDetails) =>
								(coverFees = details.checked)}
						/>
					</div>
				{/if}
				<div class="flex items-start justify-between gap-4">
					<Label for="donate-anonymous" class="font-normal">
						{m.publicSite_donateAnonymous()}
					</Label>
					<Switch
						id="donate-anonymous"
						checked={anonymous}
						onCheckedChange={(details: SwitchCheckedChangeDetails) => (anonymous = details.checked)}
					/>
				</div>
			</div>

			<div class="space-y-1.5">
				<Label for="donate-message">
					{m.publicSite_donateMessage()}
					<span class="text-muted-foreground font-normal">{m.publicSite_donateMessageHint()}</span>
				</Label>
				<Textarea
					id="donate-message"
					name="message"
					bind:value={message}
					maxlength={2000}
					rows={3}
				/>
			</div>

			<!-- Honeypot — hidden from people, tempting to bots. A non-empty value
			     is rejected server-side with the same generic message a real
			     failure gets, so a bot learns nothing from the difference. -->
			<div class="ps-honeypot" aria-hidden="true">
				<label for="donate-website">{m.publicSite_interestWebsite()}</label>
				<input
					id="donate-website"
					name="website"
					type="text"
					tabindex="-1"
					autocomplete="off"
					bind:value={website}
					aria-label={m.publicSite_interestWebsite()}
				/>
			</div>

			{#if formError}
				<p role="alert" class="text-destructive text-sm">{formError}</p>
			{/if}

			<!-- Shown prominently and always: the donor consents to THIS number,
			     not to the amount they picked above. -->
			{#if amounts && amounts.chargedCents > 0}
				<p class="text-sm font-semibold tabular-nums">
					{m.publicSite_donateTotalCharged({ amount: formatCents(amounts.chargedCents) })}
				</p>
			{/if}

			<Button type="submit" size="lg" class="w-full" loading={isStarting} {disabled}>
				{isStarting ? m.publicSite_donateProcessing() : m.publicSite_donateSubmit()}
			</Button>
		</fieldset>

		{#if disabled}
			<p class="text-muted-foreground text-sm leading-relaxed" role="status">
				{m.publicSite_donateClosedNotice()}
			</p>
		{/if}
	{/if}

	<p class="text-muted-foreground text-xs leading-relaxed">
		{m.publicSite_donateSecureNote()}
	</p>
</form>
