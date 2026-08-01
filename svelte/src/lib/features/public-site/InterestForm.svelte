<script lang="ts">
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import * as m from '$lib/i18n/messages';

	// This slice has no backend to submit to yet, so this form never submits
	// — regardless of `disabled`. `disabled` only controls whether the
	// fields render as honestly non-interactive (with the "not open yet"
	// notice) versus a preview of the live layout. There is no submit
	// handler in either case; wiring the real POST is a later slice.
	let { objectLabel, disabled }: { objectLabel: string; disabled: boolean } = $props();

	const objectLower = $derived(objectLabel.toLowerCase());
</script>

<form class="space-y-4" novalidate onsubmit={(event) => event.preventDefault()}>
	<fieldset {disabled} class="space-y-4">
		<legend class="sr-only">{m.publicSite_interestSubmit({ object: objectLower })}</legend>

		<div class="grid gap-4 sm:grid-cols-2">
			<div class="space-y-1.5">
				<Label for="interest-name">{m.publicSite_interestName()}</Label>
				<Input
					id="interest-name"
					name="name"
					minlength={2}
					maxlength={120}
					autocomplete="name"
					placeholder={m.publicSite_interestNamePlaceholder()}
				/>
			</div>
			<div class="space-y-1.5">
				<Label for="interest-email">{m.publicSite_interestEmail()}</Label>
				<Input
					id="interest-email"
					name="email"
					type="email"
					maxlength={200}
					autocomplete="email"
					placeholder={m.publicSite_interestEmailPlaceholder()}
				/>
			</div>
		</div>

		<div class="space-y-1.5">
			<Label for="interest-amount">
				{m.publicSite_interestAmount()}
				<span class="text-muted-foreground font-normal">{m.publicSite_interestAmountHint()}</span>
			</Label>
			<Input
				id="interest-amount"
				name="amount"
				type="number"
				min={1}
				step={1}
				inputmode="numeric"
				placeholder={m.publicSite_interestAmountPlaceholder()}
			/>
		</div>

		<div class="space-y-1.5">
			<Label for="interest-message">
				{m.publicSite_interestMessage()}
				<span class="text-muted-foreground font-normal">{m.publicSite_interestMessageHint()}</span>
			</Label>
			<Textarea
				id="interest-message"
				name="message"
				maxlength={2000}
				rows={3}
				placeholder={m.publicSite_interestMessagePlaceholder()}
			/>
		</div>

		<!-- Honeypot — hidden from people, tempting to bots. Kept in the markup
		     now so the real submit handler can drop straight in later. -->
		<div class="ps-honeypot" aria-hidden="true">
			<label for="interest-website">{m.publicSite_interestWebsite()}</label>
			<input
				id="interest-website"
				name="website"
				type="text"
				tabindex="-1"
				autocomplete="off"
				aria-label={m.publicSite_interestWebsite()}
			/>
		</div>

		<Button type="submit" size="lg" class="w-full" {disabled}>
			{m.publicSite_interestSubmit({ object: objectLower })}
		</Button>
	</fieldset>

	{#if disabled}
		<p class="text-muted-foreground text-sm leading-relaxed" role="status">
			{m.publicSite_interestClosedNotice()}
		</p>
	{/if}

	<p class="text-muted-foreground text-xs leading-relaxed">
		{m.publicSite_interestNoPayment()}
	</p>
</form>
