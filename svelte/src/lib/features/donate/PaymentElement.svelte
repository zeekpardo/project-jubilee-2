<script lang="ts">
	// Stripe's Payment Element, mounted directly.
	//
	// Deliberately not `svelte-stripe`. That library is genuinely Svelte 5 and
	// reasonably maintained, but its Elements wrapper runs
	// `$effect(() => elements?.update(options))` across all spread props, which
	// fights the one constraint that matters here: `clientSecret` is NOT an
	// updatable Elements option. Every amount change mints a new intent and so
	// requires a full teardown, which the parent does with `{#key}`. It also
	// attributes the integration to itself via `registerAppInfo`. Forty lines
	// is cheaper than working around all of that.

	import type { Stripe, StripeElements, StripePaymentElement } from '@stripe/stripe-js';
	import { stripeForAccount } from './stripe-client';
	import * as m from '$lib/i18n/messages';

	let {
		stripeAccountId,
		clientSecret,
		returnUrl,
		donorName,
		donorEmail,
		onResult
	}: {
		stripeAccountId: string;
		clientSecret: string;
		returnUrl: string;
		donorName: string;
		donorEmail: string;
		onResult: (result: { ok: boolean; message?: string }) => void;
	} = $props();

	let mountNode = $state<HTMLDivElement>();
	let stripe: Stripe | null = null;
	let elements: StripeElements | null = null;
	let paymentElement: StripePaymentElement | null = null;

	let ready = $state(false);
	let complete = $state(false);
	let submitting = $state(false);
	let errorMessage = $state<string | null>(null);

	$effect(() => {
		const account = stripeAccountId;
		const secret = clientSecret;
		const node = mountNode;
		if (!node || !secret || !account) return;

		// Guards the async gap: an unmount between `await` and `mount` would
		// otherwise attach an element to a detached node and leak it.
		let cancelled = false;

		void (async () => {
			const instance = await stripeForAccount(account);
			if (cancelled || !instance) return;

			const els = instance.elements({ clientSecret: secret, loader: 'auto' });
			const element = els.create('payment', {
				// Expanded accordion: a donor should see that Apple Pay or a bank
				// debit is on offer without having to open anything. `radios` is
				// an enum here rather than the boolean older Stripe examples use,
				// and 'auto' is what shows selectors only when there is a choice
				// worth making.
				layout: { type: 'accordion', defaultCollapsed: false, radios: 'auto' },
				// We collect name and email ourselves, because we have to write
				// them to Convex for the receipt. Asking twice on one form is the
				// kind of friction that loses gifts.
				fields: { billingDetails: { name: 'never', email: 'never' } }
			});

			element.on('change', (event) => {
				complete = event.complete;
				errorMessage = null;
			});
			element.on('ready', () => {
				ready = true;
			});

			element.mount(node);
			stripe = instance;
			elements = els;
			paymentElement = element;
		})();

		return () => {
			cancelled = true;
			paymentElement?.destroy();
			paymentElement = null;
			elements = null;
			stripe = null;
			ready = false;
			complete = false;
		};
	});

	export async function confirm(): Promise<void> {
		if (!stripe || !elements || submitting) return;
		submitting = true;
		errorMessage = null;

		const { error, paymentIntent } = await stripe.confirmPayment({
			elements,
			confirmParams: {
				return_url: returnUrl,
				payment_method_data: {
					billing_details: { name: donorName || undefined, email: donorEmail }
				}
			},
			// Stripe's default is 'always', which redirects even for plain cards.
			// 'if_required' keeps card and wallet donors on the page and only
			// leaves it for 3DS or a bank redirect — so the common case never
			// loses the thank-you context.
			redirect: 'if_required'
		});

		submitting = false;

		if (error) {
			errorMessage = error.message ?? m.publicSite_donateError();
			onResult({ ok: false, message: errorMessage });
			return;
		}

		// 'processing' is a success for our purposes: an ACH debit is genuinely
		// under way. It is emphatically not money yet, which is why the thanks
		// page reads the donation row rather than assuming from this.
		const status = paymentIntent?.status;
		onResult({ ok: status === 'succeeded' || status === 'processing' });
	}

	export function canConfirm(): boolean {
		return ready && complete && !submitting;
	}
</script>

<div class="space-y-2">
	<div bind:this={mountNode}></div>
	{#if errorMessage}
		<p role="alert" class="text-destructive text-sm">{errorMessage}</p>
	{/if}
</div>
