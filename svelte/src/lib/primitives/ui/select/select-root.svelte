<script lang="ts" generics="T extends CollectionItem = CollectionItem">
	// Ark's Root, with one default changed.
	//
	// TRIGGER ID. Zag finds the element to position against by id —
	// `getTriggerEl` is `getById('select:<machine id>:trigger')`. A caller that
	// set `id` directly on `Select.Trigger` overwrote that, the lookup returned
	// null, floating-ui never ran, and the menu stayed where the positioner's
	// static style leaves it: `inset: 0 auto auto 0`, the top-left of the page.
	// Every select in the app did this, which is why it looked like a styling
	// quirk rather than a broken element reference.
	//
	// So the id is owned HERE and handed to the machine through `ids`, which is
	// zag's supported override. The rendered trigger then really does carry the
	// caller's id, so `<Label for={id}>` still points at it and the accessible
	// name survives. `Select.Trigger` refuses an `id` of its own precisely so
	// this cannot be undone one call site at a time.
	//
	// POSITIONING STRATEGY. Zag positions the menu `absolute` by default, which
	// means its coordinates are resolved against the nearest positioned
	// ancestor. The app shell wraps every page in
	// `<div class="bg-background relative ...">`, so that div is the offsetParent
	// for every select on every screen — and the menu landed at the top of the
	// content column instead of under its trigger, everywhere, for the same
	// reason each time.
	//
	// `fixed` resolves against the viewport instead, so no ancestor's
	// positioning can move it. It is set HERE rather than at each call site
	// because the fault was never in any one usage: a shared primitive that only
	// works outside a positioned container is a trap that every future select
	// falls into.
	//
	// Portalling to `<body>` is the other standard fix and is what tooltip does.
	// Not used here on purpose: a select inside a dialog would then render
	// outside the dialog's DOM, and its focus trap is the thing most likely to
	// swallow the menu. `fixed` fixes the geometry without moving the element.
	import { Select as SelectPrimitive } from '@ark-ui/svelte/select';
	import type { CollectionItem } from '@ark-ui/svelte/collection';

	// `value` and `ref` are re-declared as bindable because a wrapper does not
	// inherit the primitive's bindability, and call sites already use them.
	// `open` is deliberately NOT among them — Ark exposes it as a plain prop with
	// `onOpenChange`, so it forwards through restProps like everything else.
	let {
		positioning = { strategy: 'fixed' as const },
		triggerId,
		ids,
		value = $bindable(),
		ref = $bindable(null),
		...restProps
	}: SelectPrimitive.RootProps<T> & { triggerId?: string } = $props();

	const mergedIds = $derived(triggerId ? { ...ids, trigger: triggerId } : ids);
</script>

<SelectPrimitive.Root {positioning} ids={mergedIds} bind:value bind:ref {...restProps} />
