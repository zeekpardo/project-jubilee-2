<script lang="ts">
	// Primitives
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';

	import * as m from '$lib/i18n/messages';

	let {
		id,
		label = m.field_amount(),
		value = $bindable(''),
		error = null,
		help = m.money_amountHelp(),
		disabled = false
	}: {
		id: string;
		label?: string;
		/** Dollars, as typed. The caller converts it with `dollarsToCents`. */
		value?: string;
		error?: string | null;
		help?: string;
		disabled?: boolean;
	} = $props();
</script>

<div class="flex flex-col gap-1.5">
	<Label for={id}>{label}</Label>
	<Input
		{id}
		bind:value
		{disabled}
		inputmode="decimal"
		autocomplete="off"
		class="tabular-nums"
		aria-invalid={error !== null ? 'true' : undefined}
	/>
	{#if error !== null}
		<p class="text-error-700-300 text-xs">{error}</p>
	{:else}
		<p class="text-muted-foreground text-xs">{help}</p>
	{/if}
</div>
