<script lang="ts" module>
	export type PaginationProps = {
		/**
		 * The page on screen, 1-based. The OWNER clamps it — this control renders
		 * what it is given and would otherwise be a second opinion on which page
		 * exists. `clampPage` is exported alongside so that clamping is one line.
		 */
		page: number;
		/** How many rows there are in total, across every page. */
		total: number;
		pageSize: number;
		onPageChange: (page: number) => void;
		/**
		 * The sizes to offer. Omitted — or a single size — hides the picker, so a
		 * list with a fixed page length does not grow a control that cannot change
		 * anything.
		 */
		pageSizes?: readonly number[];
		onPageSizeChange?: (size: number) => void;
		/** How many page numbers to draw either side of the current one. */
		siblingCount?: number;
		class?: string;
	};
</script>

<script lang="ts">
	// ============================================================
	// Pagination — one control, no opinion about what is being paged
	// ============================================================
	// Deliberately KNOWS NOTHING but three numbers and two callbacks. Whether the
	// pages are sliced on the client or fetched from a server, whether the rows
	// are tasks or contacts, and where the page number is stored are all the
	// owner's business; this renders a page picker and reports clicks.
	//
	// It does not hold the current page in state either. The page lives wherever
	// the owner keeps it — for a list whose filters are in the URL, that is the
	// URL — and a copy here would be a second source of truth that drifts the
	// first time the owner clamps or resets it.
	// ============================================================

	import { Button } from '$lib/primitives/ui/button';
	import * as Select from '$lib/primitives/ui/select';
	import { Separator } from '$lib/primitives/ui/separator';
	import { cn } from '$lib/primitives/utils';
	import { createListCollection } from '@ark-ui/svelte/select';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import * as m from '$lib/i18n/messages';
	import { clampPage, countPages, pageRange, paginationItems } from './utils';

	let {
		page,
		total,
		pageSize,
		onPageChange,
		pageSizes,
		onPageSizeChange,
		siblingCount = 1,
		class: className
	}: PaginationProps = $props();

	const pageCount = $derived(countPages(total, pageSize));
	// Clamped for rendering as well, even though the owner is expected to clamp:
	// highlighting a page that is not in the row of buttons looks broken, and the
	// cost of being sure is one call.
	const current = $derived(clampPage(page, pageCount));
	const range = $derived(pageRange(current, pageSize, total));
	const items = $derived(paginationItems(current, pageCount, siblingCount));

	const showSizes = $derived(Boolean(onPageSizeChange) && (pageSizes?.length ?? 0) > 1);

	// Numerals, not translated strings: a page size renders the same in every
	// locale, and routing "50" through the message catalogue would only invite a
	// translator to change it.
	const sizeCollection = $derived(
		createListCollection({
			items: (pageSizes ?? []).map((size) => ({ value: String(size), label: String(size) }))
		})
	);

	function go(next: number): void {
		const target = clampPage(next, pageCount);
		// A click that lands where we already are is not a navigation. Reporting it
		// would push the owner into a redundant URL write on every end-stop click.
		if (target !== current) onPageChange(target);
	}

	function resize(value: string): void {
		const next = Number(value);
		if (!Number.isFinite(next) || next <= 0 || next === pageSize) return;
		onPageSizeChange?.(next);
	}
</script>

<!-- Nothing to page through is nothing to say. The empty state speaks for an
     empty list; a pager under it would be a control with no rows behind it. -->
{#if total > 0}
	<nav
		aria-label={m.pagination_label()}
		class={cn('flex flex-wrap items-center gap-2 px-1', className)}
	>
		<!-- POLITE, not assertive: the count changes on every page click, and it is
		     confirmation of a move the reader just made rather than an interruption. -->
		<p class="text-muted-foreground text-xs" aria-live="polite">
			{m.pagination_summary({ start: range.start, end: range.end, total })}
		</p>

		{#if showSizes}
			<Separator orientation="vertical" class="h-4" />
			<!-- Visible for sighted readers, hidden from the accessible tree: the
			     select carries the same words as its own label just below, and
			     announcing both would say "rows per page" twice. -->
			<span class="text-muted-foreground text-xs" aria-hidden="true">
				{m.pagination_rowsPerPage()}
			</span>
			<Select.Root
				collection={sizeCollection}
				value={[String(pageSize)]}
				onValueChange={(details: { value: string[] }): void => resize(details.value[0] ?? '')}
			>
				<Select.Label class="sr-only">{m.pagination_rowsPerPage()}</Select.Label>
				<Select.Trigger size="sm" class="w-20" placeholder={String(pageSize)} />
				<Select.Content>
					{#each sizeCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}

		{#if pageCount > 1}
			<div class="ms-auto flex items-center gap-1">
				<Button
					size="sm"
					variant="outline"
					disabled={current <= 1}
					aria-label={m.pagination_previous()}
					onclick={() => go(current - 1)}
				>
					<ChevronLeftIcon aria-hidden="true" />
				</Button>

				<!-- Keyed by position: the list holds repeated 'gap' entries, so the item
				     itself is not unique and its index is the only honest key. -->
				{#each items as item, index (index)}
					{#if item === 'gap'}
						<span class="text-muted-foreground flex size-8 items-center justify-center text-sm">
							<span aria-hidden="true">…</span>
							<span class="sr-only">{m.pagination_morePages()}</span>
						</span>
					{:else}
						<Button
							size="icon"
							class="size-8"
							variant={item === current ? 'default' : 'ghost'}
							aria-label={m.pagination_goToPage({ page: item })}
							aria-current={item === current ? 'page' : undefined}
							onclick={() => go(item)}
						>
							{item}
						</Button>
					{/if}
				{/each}

				<Button
					size="sm"
					variant="outline"
					disabled={current >= pageCount}
					aria-label={m.pagination_next()}
					onclick={() => go(current + 1)}
				>
					<ChevronRightIcon aria-hidden="true" />
				</Button>
			</div>
		{/if}
	</nav>
{/if}
