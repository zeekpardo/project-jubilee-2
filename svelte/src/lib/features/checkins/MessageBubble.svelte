<script lang="ts">
	// One line of the transcript.
	//
	// Three deliberate departures from the messenger this borrows its shape from:
	//
	// 1. No author name inside the bubble. This is a two-party transcript, and
	//    alignment plus colour already say who spoke. A name repeated on every
	//    bubble is noise that pushes the words themselves down the page. The
	//    sender is carried on `aria-label` instead, so a screen reader loses
	//    nothing that a sighted reader gets from the layout.
	//
	// 2. No delivery ticks. The reference renders a double-tick on every outbound
	//    message unconditionally — driven by nothing, true by assertion. Here the
	//    WhatsApp transport is not built at all, so a tick would be a claim that a
	//    family received something when nobody has any idea whether they did.
	//
	// 3. Dates are shown. A check-in runs for weeks, so the clock time alone is
	//    ambiguous; the day separators above and the `title` here fix that.

	import * as m from '$lib/i18n/messages';
	import { absoluteTimestamp, messageTime } from './format';
	import type { CheckinMessageRow } from './types';

	let { message }: { message: CheckinMessageRow } = $props();

	const outbound = $derived(message.direction === 'outbound');
	const sender = $derived(outbound ? m.checkinDetail_fromUs() : m.checkinDetail_fromFamily());
</script>

<div class="flex flex-col gap-1">
	<div
		aria-label={sender}
		class="max-w-[85%] rounded-2xl border px-4 py-3 text-sm leading-relaxed {outbound
			? 'bg-primary text-primary-foreground ml-auto border-transparent'
			: 'bg-muted border-transparent'}"
	>
		<!-- Plain text, deliberately: no markdown and no link detection. These are a
		     family's own words, and rendering them as anything other than what was
		     typed would be the transcript editing its own evidence. -->
		<p class="whitespace-pre-wrap">{message.text}</p>
	</div>

	<div
		class="text-muted-foreground flex items-center gap-2 text-xs {outbound
			? 'justify-end'
			: 'justify-start'}"
	>
		<span title={absoluteTimestamp(message.at)}>{messageTime(message.at)}</span>
		<span>{m.checkinObjectives_turn({ number: message.turnNumber })}</span>
	</div>
</div>
