<script lang="ts">
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Switch } from '$lib/primitives/ui/switch';
	import type { SwitchCheckedChangeDetails } from '$lib/primitives/ui/switch';
	import { formatCents } from '$lib/features/money/format';
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

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="donate-name">{m.publicSite_donateName()}</Label>
				<Input id="donate-name" name="name" minlength={2} maxlength={120} autocomplete="name" />
			</div>
			<div class="space-y-1.5">
				<Label for="donate-email">{m.publicSite_donateEmail()}</Label>
				<Input id="donate-email" name="email" type="email" maxlength={200} autocomplete="email" />
				<p class="text-muted-foreground text-xs">{m.publicSite_donateEmailHint()}</p>
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
