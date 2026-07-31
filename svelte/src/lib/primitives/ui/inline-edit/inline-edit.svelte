<script lang="ts">
	import { tick } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { cn } from '$lib/primitives/utils';
	import { Input } from '$lib/primitives/ui/input';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Spinner } from '$lib/primitives/ui/spinner';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import CheckIcon from '@lucide/svelte/icons/check';
	import XIcon from '@lucide/svelte/icons/x';
	import * as m from '$lib/i18n/messages';

	let {
		value,
		onSave,
		placeholder = '',
		multiline = false,
		type = 'text',
		ariaLabel,
		disabled = false,
		class: className,
		inputClass
	}: {
		value: string | null | undefined;
		/** Callers map '' to null themselves and patch a single field. */
		onSave: (next: string) => Promise<unknown>;
		placeholder?: string;
		multiline?: boolean;
		type?: 'text' | 'tel' | 'url';
		ariaLabel: string;
		disabled?: boolean;
		class?: string;
		inputClass?: string;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let saving = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);
	let textareaEl = $state<HTMLTextAreaElement | null>(null);
	const field = $derived<HTMLInputElement | HTMLTextAreaElement | null>(
		multiline ? textareaEl : inputEl
	);
	let container = $state<HTMLElement | null>(null);

	const display = $derived(value ?? '');

	async function begin() {
		if (disabled || saving) return;
		draft = display;
		editing = true;
		await tick();
		field?.focus();
		const end = draft.length;
		field?.setSelectionRange?.(end, end);
	}

	function cancel() {
		editing = false;
		draft = display;
	}

	async function commit() {
		if (saving) return;
		const next = draft.trim();
		if (next === display.trim()) {
			editing = false;
			return;
		}
		saving = true;
		try {
			await onSave(next);
			editing = false;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : m.state_saveFailed());
			draft = display;
			editing = false;
		} finally {
			saving = false;
		}
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}
		if (event.key !== 'Enter') return;
		// A newline is the point of a multiline field, so it commits on modifier.
		if (multiline && !(event.metaKey || event.ctrlKey)) return;
		event.preventDefault();
		void commit();
	}

	function onBlur(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (next && container?.contains(next)) return;
		void commit();
	}
</script>

<div bind:this={container} class={cn('group/inline min-w-0', className)}>
	{#if editing}
		<div class="flex items-start gap-1">
			{#if multiline}
				<Textarea
					bind:ref={textareaEl}
					bind:value={draft}
					rows={4}
					aria-label={ariaLabel}
					class={cn('flex-1', inputClass)}
					onkeydown={onKeydown}
					onblur={onBlur}
				/>
			{:else}
				<Input
					bind:ref={inputEl}
					bind:value={draft}
					{type}
					aria-label={ariaLabel}
					class={cn('flex-1', inputClass)}
					onkeydown={onKeydown}
					onblur={onBlur}
				/>
			{/if}
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground p-1"
				aria-label={m.action_save()}
				onmousedown={(e) => e.preventDefault()}
				onclick={commit}
			>
				{#if saving}<Spinner size="xs" />{:else}<CheckIcon class="size-4" />{/if}
			</button>
			<button
				type="button"
				class="text-muted-foreground hover:text-foreground p-1"
				aria-label={m.action_cancel()}
				onmousedown={(e) => e.preventDefault()}
				onclick={cancel}
			>
				<XIcon class="size-4" />
			</button>
		</div>
	{:else}
		<button
			type="button"
			{disabled}
			class={cn(
				'flex w-full items-start gap-1.5 text-left',
				disabled ? 'cursor-default' : 'hover:text-foreground'
			)}
			aria-label={ariaLabel}
			onclick={begin}
		>
			<span class={cn('min-w-0 flex-1', !display && 'text-muted-foreground italic')}>
				{display || placeholder}
			</span>
			{#if !disabled}
				<PencilIcon
					class="text-muted-foreground mt-0.5 size-3.5 shrink-0 opacity-0 transition-opacity group-hover/inline:opacity-100"
				/>
			{/if}
			{#if saving}<Spinner size="xs" />{/if}
		</button>
	{/if}
</div>
