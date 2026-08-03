<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { formatCents } from '$lib/features/money/format';
	import { getSiteViewerContext } from '$lib/features/site/context.svelte';
	import * as m from '$lib/i18n/messages';

	// Everything a Stripe Connect charge needs EXCEPT the payment details.
	// Card numbers must never touch an input this app renders — Stripe's own
	// Checkout or Payment Element collects them, so the org stays out of PCI
	// scope. This form gathers the amount, cadence and donor identity, then
	// hands off.
	//
	// `disabled` renders it honestly non-interactive; there is no submit handler
	// in either case, because there is no Stripe account wired up yet.
	let { disabled, remainingCents = null }: { disabled: boolean; remainingCents?: number | null } =
		$props();

	// Sensible defaults until a campaign can configure its own ladder.
	const PRESETS_CENTS = [2500, 5000, 10000, 25000];

	let selectedCents = $state<number | null>(5000);
	let customAmount = $state('');
	let frequency = $state<'once' | 'monthly'>('once');
	let coverFees = $state(false);
	let anonymous = $state(false);

	function choosePreset(cents: number): void {
		selectedCents = cents;
		customAmount = '';
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

	// The name the field is BUILT with, never a value pushed into a field the
	// donor is already using. It changes only when the viewer changes or the
	// donor dismisses the greeting, and both of those also change
	// `donorFieldKey` below, so every change here arrives as a fresh input
	// rather than as an overwrite. The failure this shape exists to avoid is a
	// reactive assignment that keeps restoring the account holder's name over
	// the spouse's name a donor is typing in on their behalf.
	const prefilledName = $derived(
		viewerName !== null && viewerName !== dismissedName ? viewerName : ''
	);

	// Remounting the name field is what makes a change of person a clean slate
	// instead of a merge of two people's half-entered details.
	//
	// The key is the display name because the display name is all this surface
	// has. An id would be the stabler key — two donors can share a name, and one
	// person can change theirs — but `SiteGreeting` deliberately carries no
	// contact id, on the grounds that an id sitting in a browser is an argument
	// waiting to be accepted by the next mutation that takes one "because the
	// client already has it". That trade is right here: the worst this weaker key
	// admits is a form that keeps a half-typed value across a change of viewer
	// that happened to preserve the name, which costs a donor one correction. The
	// id would cost the privacy boundary the whole site projection is built on.
	//
	// Only the name field is keyed. Every other control's value lives in `$state`
	// in this component, which a remount would not reset anyway; the name input
	// is the one whose value is owned by the DOM.
	const donorFieldKey = $derived(`${viewerName ?? ''}|${dismissedName ?? ''}`);

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

<form class="space-y-5" novalidate onsubmit={(event) => event.preventDefault()}>
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
			<!--
				Offered only to a visitor this page does not recognise, so nobody is
				ever invited to sign in to the session they are already in.

				It lives INSIDE the fieldset on purpose. `disabled` on a fieldset
				disables the form controls it contains, not the links, so an anchor
				here stays focusable and clickable while giving is switched off —
				which is exactly the state this form is in today. Hoisting it out of
				the fieldset would buy nothing and would separate the prompt from the
				fields it is offering to fill in.
			-->
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
						<!--
							Clears the greeting, and clears only the greeting — someone
							giving on behalf of a spouse is still the person signed in, and
							dropping their session to relabel one field would be a
							disproportionate answer to a typo.

							A button rather than a link, and so genuinely inert while the
							fieldset is disabled: it edits a form field, and every other way
							of editing a form field is switched off too. The sign-in link
							above stays live because it navigates away rather than typing
							here.
						-->
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
					{#key donorFieldKey}
						<Input
							id="donate-name"
							name="name"
							value={prefilledName}
							minlength={2}
							maxlength={120}
							autocomplete="name"
						/>
					{/key}
				</div>
				<div class="space-y-1.5">
					<Label for="donate-email">{m.publicSite_donateEmail()}</Label>
					<!--
						Left empty for a recognised donor too, and that is a decision
						rather than an omission. `src/convex/model/site.ts` lists the
						viewer's own email among the things the public site projection
						never returns — an address belongs to the portal, which is served
						from routes that are never cached — so there is nothing here to
						prefill from and nothing may be added to fetch it. Revisit when
						online giving is switched on: a receipt address is worth asking
						the portal for over an uncached path, on a form that is actually
						taking payments.
					-->
					<Input id="donate-email" name="email" type="email" maxlength={200} autocomplete="email" />
					<p class="text-muted-foreground text-xs">{m.publicSite_donateEmailHint()}</p>
				</div>
			</div>
		</div>

		<div class="space-y-3">
			<div class="flex items-start justify-between gap-4">
				<Label for="donate-cover-fees" class="font-normal">
					{m.publicSite_donateCoverFees()}
				</Label>
				<Switch
					id="donate-cover-fees"
					checked={coverFees}
					onCheckedChange={(details: SwitchCheckedChangeDetails) => (coverFees = details.checked)}
				/>
			</div>
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
			<Textarea id="donate-message" name="message" maxlength={2000} rows={3} />
		</div>

		<!-- Honeypot — hidden from people, tempting to bots. Kept in the markup
		     now so the real submit handler can drop straight in later. -->
		<div class="ps-honeypot" aria-hidden="true">
			<label for="donate-website">{m.publicSite_interestWebsite()}</label>
			<input
				id="donate-website"
				name="website"
				type="text"
				tabindex="-1"
				autocomplete="off"
				aria-label={m.publicSite_interestWebsite()}
			/>
		</div>

		<Button type="submit" size="lg" class="w-full" {disabled}>
			{m.publicSite_donateSubmit()}
		</Button>
	</fieldset>

	{#if disabled}
		<p class="text-muted-foreground text-sm leading-relaxed" role="status">
			{m.publicSite_donateClosedNotice()}
		</p>
	{/if}

	<p class="text-muted-foreground text-xs leading-relaxed">
		{m.publicSite_donateSecureNote()}
	</p>
</form>
