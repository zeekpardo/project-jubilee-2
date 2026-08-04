<script lang="ts">
	// Carta renders a toolbar icon as `<icon.component />` and passes it nothing,
	// so its `Icon['component']` type is a component with no props. A lucide icon
	// takes props, so it is wrapped here rather than handed over directly: the
	// wrapper is what satisfies that prop-less slot and what fixes the size, so
	// the two custom buttons sit at the same weight as Carta's own.
	import ImageIcon from '@lucide/svelte/icons/image';
</script>

<ImageIcon class="size-4" aria-hidden="true" />
