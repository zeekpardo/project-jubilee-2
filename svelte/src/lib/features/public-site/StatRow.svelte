<script lang="ts">
	import { formatCents } from '$lib/features/money/format';

	type Stat = {
		key: string;
		label: string;
		value: number;
		format?: 'number' | 'money';
	};

	let { stats }: { stats: Stat[] } = $props();

	const DURATION_MS = 1400;

	let container = $state<HTMLDivElement | null>(null);

	// Starts at 1, NOT 0, so the server renders the real figures. Counting is a
	// client-side flourish; a visitor without JS, or a crawler, must still read
	// "17 families freed" rather than a page reporting zero impact.
	let progress = $state(1);

	function displayValue(stat: Stat, fraction: number): string {
		// `money` values arrive as cents, same as everywhere else in this app.
		const value = Math.round(stat.value * fraction);
		return stat.format === 'money' ? formatCents(value) : value.toLocaleString('en-US');
	}

	$effect(() => {
		const node = container;
		if (!node) return;

		// Counting numbers is motion; someone who has asked for less of it gets
		// the final figures immediately.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		let frame = 0;
		let startedAt: number | null = null;

		const tick = (timestamp: number) => {
			startedAt ??= timestamp;
			const elapsed = Math.min((timestamp - startedAt) / DURATION_MS, 1);
			// easeOutCubic — quick off the mark, settling onto the real number.
			progress = 1 - Math.pow(1 - elapsed, 3);
			if (elapsed < 1) frame = requestAnimationFrame(tick);
		};

		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				// Once only: re-counting every time the strip scrolls back into
				// view reads as a glitch rather than an effect.
				observer.disconnect();
				progress = 0;
				frame = requestAnimationFrame(tick);
			},
			{ threshold: 0.4 }
		);
		observer.observe(node);

		return () => {
			observer.disconnect();
			cancelAnimationFrame(frame);
		};
	});
</script>

{#if stats.length > 0}
	<div bind:this={container} class="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-8">
		{#each stats as stat (stat.key)}
			<div class="text-center sm:text-left">
				<!-- tabular-nums keeps the digits from reflowing as they count. -->
				<p class="ps-serif text-primary text-3xl tabular-nums sm:text-4xl">
					{displayValue(stat, progress)}
				</p>
				<p class="text-muted-foreground mt-1 text-[11px] font-medium tracking-[0.18em] uppercase">
					{stat.label}
				</p>
			</div>
		{/each}
	</div>
{/if}
