<script lang="ts">
	// One conversation in the queue.
	//
	// No avatar. The reference this borrows from puts a face on every row because
	// its rows are always people; ours may be a RECORD — a family's case, which
	// may have several contacts — and there is no photograph anywhere in this
	// product for either. A generated initial circle would be decoration standing
	// in for information.

	import { Badge } from '$lib/primitives/ui/badge';
	import { MAX_RESPONDER_TURNS } from '$lib/domain/checkin-objectives';

	import * as m from '$lib/i18n/messages';
	import { relativeAge } from './format';
	import {
		checkinKindLabel,
		checkinKindVariant,
		checkinStatusLabel,
		checkinStatusVariant,
		reviewReasonLabel
	} from './labels';
	import { conversationKind, type CheckinRow } from './types';

	let { row, selected, onSelect }: { row: CheckinRow; selected: boolean; onSelect: () => void } =
		$props();

	// "5m" has to keep meaning five minutes ago. The list is a live subscription,
	// so the rows redraw when a message lands, but a queue left open on a wall
	// screen gets no such nudge — hence a slow tick of its own.
	let now = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (now = Date.now()), 60_000);
		return () => clearInterval(timer);
	});

	const kind = $derived(conversationKind(row));

	// A conversation names a record, a person, or both, so the heading falls
	// through in that order. A thread with a sponsor carries no record at all,
	// and the old two-step fallback rendered it as a bare em dash — a queue of
	// nameless rows nobody can pick from.
	const title = $derived(row.projectName ?? row.projectNumber ?? row.contactName ?? '—');
	const age = $derived(relativeAge(row.lastMessageAt ?? row.openedAt, now));

	// The turn counter counts RESPONDER turns against the engine's cap. On a
	// conversation the engine has never touched there is no cap and nothing has
	// been spent, so "0 of 6 turns used" is a fact about a machine that was never
	// involved. Nothing is shown instead: `listCheckins` carries no message
	// preview to put there, and an invented second line is worse than none.
	const subtitle = $derived.by(() => {
		if (row.reviewReason) return reviewReasonLabel(row.reviewReason);
		if (kind !== 'checkin') return null;
		return m.checkinDetail_turnsSpent({ spent: row.turnsSpent, max: MAX_RESPONDER_TURNS });
	});
</script>

<!-- The `listitem` role sits on a wrapper rather than on the button itself. A
     `<button role="listitem">` is what the brief asked for, but it overwrites the
     button's own implicit role, so a screen reader would announce a list of
     unclickable items — Svelte's a11y check flags exactly this. The wrapper keeps
     the list semantics for the container and leaves the button a button. -->
<div role="listitem">
	<button
		type="button"
		aria-current={selected ? 'true' : undefined}
		onclick={onSelect}
		class="focus-visible:ring-ring relative flex w-full items-start gap-3 rounded-lg border border-transparent p-3 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none {selected
			? 'border-primary/40 bg-primary/10'
			: 'hover:border-border hover:bg-muted/50'}"
	>
		<div class="flex min-w-0 flex-1 flex-col gap-1">
			<div class="flex items-center gap-2">
				<span class="truncate text-sm font-medium">{title}</span>
				<Badge variant={checkinKindVariant(kind)}>{checkinKindLabel(kind)}</Badge>
				<Badge variant={checkinStatusVariant(row.status)}>{checkinStatusLabel(row.status)}</Badge>
				<span class="text-muted-foreground ml-auto shrink-0 text-xs">{age}</span>
			</div>
			{#if subtitle}
				<span class="text-muted-foreground truncate text-xs">{subtitle}</span>
			{/if}
		</div>
	</button>
</div>
