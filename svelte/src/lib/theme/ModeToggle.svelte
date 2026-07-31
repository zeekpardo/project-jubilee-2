<script lang="ts">
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import SunIcon from '@lucide/svelte/icons/sun';
	import { cn } from '$lib/primitives/utils.js';
	import * as m from '$lib/i18n/messages';
	import { MODES, type Mode } from './config';
	import { themeState } from './state.svelte';

	let { class: className }: { class?: string } = $props();

	const icons = { light: SunIcon, dark: MoonIcon, system: MonitorIcon };
	const labels = $derived<Record<Mode, string>>({
		light: m.theme_mode_light(),
		dark: m.theme_mode_dark(),
		system: m.theme_mode_system()
	});
</script>

<div
	role="radiogroup"
	aria-label={m.theme_modeLabel()}
	class={cn('bg-muted inline-flex items-center gap-0.5 rounded-lg p-[3px]', className)}
>
	{#each MODES as value (value)}
		{@const Icon = icons[value]}
		<button
			type="button"
			role="radio"
			aria-checked={themeState.mode === value}
			aria-label={labels[value]}
			title={labels[value]}
			class={cn(
				'flex size-7 items-center justify-center rounded-md border border-transparent transition-[color,box-shadow,background-color] duration-200',
				themeState.mode === value
					? 'bg-background text-foreground dark:border-input dark:bg-input/30 shadow-sm'
					: 'text-muted-foreground hover:text-foreground'
			)}
			onclick={() => themeState.setMode(value)}
		>
			<Icon class="size-4" />
		</button>
	{/each}
</div>
