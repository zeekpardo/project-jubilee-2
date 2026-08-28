<script lang="ts">
	// One objective, and the four decisions an author makes about it: what a
	// satisfying answer looks like, whether the question applies to this
	// household at all, what happens to the answer, and how strictly it is
	// marked.
	//
	// The objective object is MUTATED IN PLACE. It is a node of the page's one
	// `$state` draft, so an edit here survives a tab switch without this
	// component owning anything, and there is no copy to keep in step.

	// Primitives
	import { Checkbox } from '$lib/primitives/ui/checkbox';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { Button } from '$lib/primitives/ui/button';
	import * as Select from '$lib/primitives/ui/select';
	import { createListCollection } from '@ark-ui/svelte/select';
	import TrashIcon from '@lucide/svelte/icons/trash-2';

	import { HOUSEHOLD_FACTS, type HouseholdFact } from '$lib/domain/workflows';
	import {
		CONFIDENCE_ACCEPT,
		MAX_RESPONDER_TURNS,
		RATING_ANSWERED
	} from '$lib/domain/checkin-objectives';
	import {
		captureChoice,
		numberText,
		optionalNumber,
		withCaptureChoice,
		type CaptureChoice,
		type FieldOption,
		type WorkflowObjective
	} from './types';
	import { CAPTURE_CHOICES, captureChoiceLabel, householdFactLabel } from './labels';
	import * as m from '$lib/i18n/messages';

	let {
		objective,
		id,
		projectFields,
		contactFields,
		onRemove
	}: {
		objective: WorkflowObjective;
		/** Unique within the page, so every label points at its own control. */
		id: string;
		projectFields: FieldOption[];
		contactFields: FieldOption[];
		onRemove: () => void;
	} = $props();

	const choice = $derived(captureChoice(objective.capture));

	const captureCollection = createListCollection({
		items: CAPTURE_CHOICES.map((value) => ({ value, label: captureChoiceLabel(value) }))
	});

	const fields = $derived(choice === 'contact' ? contactFields : projectFields);

	const fieldCollection = $derived(
		createListCollection({
			items: fields.map((field) => ({ value: field.key, label: field.label }))
		})
	);

	const captureFieldKey = $derived(
		objective.capture && objective.capture.kind === 'field' ? objective.capture.fieldKey : ''
	);

	const selectedField = $derived(fields.find((field) => field.key === captureFieldKey) ?? null);

	function setChoice(next: CaptureChoice): void {
		objective.capture = withCaptureChoice(objective, next);
	}

	/**
	 * Picking the field also fixes the ALLOWED VALUES, taken from the definition
	 * rather than typed again here. A `select` field is a picklist and
	 * `captureValueFor` refuses an answer outside its options — copying the list
	 * by hand would be a second place for it to be wrong, and a stale copy
	 * silently drops a valid answer. A non-select field carries no list, which
	 * is what "accept anything the judge accepted" looks like.
	 */
	function setFieldKey(key: string): void {
		const capture = objective.capture;
		if (!capture || capture.kind !== 'field') return;
		const definition = fields.find((field) => field.key === key);
		capture.fieldKey = key;
		capture.options =
			definition && definition.type === 'select' && definition.options?.length
				? [...definition.options]
				: undefined;
	}

	function toggleFact(fact: HouseholdFact, checked: boolean): void {
		const current = objective.requires ?? [];
		objective.requires = checked
			? [...current, fact]
			: current.filter((existing) => existing !== fact);
	}
</script>

<div class="border-border flex flex-col gap-4 rounded-lg border p-4">
	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-2">
			<Label for={`${id}-key`}>{m.workflows_objectiveKey()}</Label>
			<Input
				id={`${id}-key`}
				class="font-mono text-xs"
				bind:value={objective.key}
				autocomplete="off"
			/>
			<p class="text-muted-foreground text-xs">{m.workflows_objectiveKeyHelp()}</p>
		</div>
		<div class="flex flex-col gap-2">
			<Label for={`${id}-label`}>{m.workflows_objectiveLabel()}</Label>
			<Input id={`${id}-label`} bind:value={objective.label} autocomplete="off" />
			<p class="text-muted-foreground text-xs">{m.workflows_objectiveLabelHelp()}</p>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<Label for={`${id}-description`}>{m.workflows_objectiveDescription()}</Label>
		<Textarea id={`${id}-description`} bind:value={objective.description} rows={3} />
		<p class="text-muted-foreground text-xs">{m.workflows_objectiveDescriptionHelp()}</p>
	</div>

	<!--
		Applicability, and it is NOT the same question as skipIfKnown below: this
		asks whether the household has the thing at all, that one asks whether we
		were already told. See the note on `requires` in lib/domain/workflows.ts.
	-->
	<fieldset class="flex flex-col gap-2">
		<legend class="text-sm font-medium">{m.workflows_requires()}</legend>
		<div class="flex flex-wrap gap-4 pt-1">
			{#each HOUSEHOLD_FACTS as fact (fact)}
				<Checkbox
					checked={objective.requires?.includes(fact) ?? false}
					onCheckedChange={(details: { checked: boolean | 'indeterminate' }) =>
						toggleFact(fact, details.checked === true)}
				>
					{householdFactLabel(fact)}
				</Checkbox>
			{/each}
		</div>
		<p class="text-muted-foreground text-xs">{m.workflows_requiresHelp()}</p>
	</fieldset>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="flex flex-col gap-2">
			<Label for={`${id}-capture`}>{m.workflows_capture()}</Label>
			<Select.Root
				collection={captureCollection}
				value={[choice]}
				onValueChange={(details: { value: string[] }): void => {
					const next = details.value[0];
					if (next) setChoice(next as CaptureChoice);
				}}
			>
				<Select.Trigger id={`${id}-capture`} class="w-full" placeholder={m.workflows_capture()} />
				<Select.Content>
					{#each captureCollection.items as option (option.value)}
						<Select.Item item={option}>
							<Select.ItemText>{option.label}</Select.ItemText>
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</div>

		{#if choice !== 'none'}
			<div class="flex flex-col gap-2">
				<Label for={`${id}-field`}>{m.workflows_captureField()}</Label>
				{#if fields.length === 0}
					<p class="text-muted-foreground text-sm">{m.workflows_captureNoFields()}</p>
				{:else}
					<Select.Root
						collection={fieldCollection}
						value={captureFieldKey ? [captureFieldKey] : []}
						onValueChange={(details: { value: string[] }): void => {
							const next = details.value[0];
							if (next) setFieldKey(next);
						}}
					>
						<Select.Trigger
							id={`${id}-field`}
							class="w-full"
							placeholder={m.workflows_captureFieldPlaceholder()}
						/>
						<Select.Content>
							{#each fieldCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
			</div>
		{/if}
	</div>

	{#if choice !== 'none'}
		{#if selectedField && selectedField.type === 'select' && selectedField.options?.length}
			<p class="text-muted-foreground text-xs">
				{m.workflows_captureOptions({ options: selectedField.options.join(', ') })}
			</p>
		{/if}
		<!--
			Only rendered for a field capture. `skipIfKnown` means "the record
			already holds this objective's answer", and an objective that files
			nothing has nowhere for that answer to be — the domain ignores the flag
			there rather than treating it as false, and offering a control that
			does nothing would be the UI disagreeing with the engine.
		-->
		<Checkbox
			checked={objective.skipIfKnown === true}
			onCheckedChange={(details: { checked: boolean | 'indeterminate' }) => {
				objective.skipIfKnown = details.checked === true;
			}}
		>
			{m.workflows_skipIfKnown()}
		</Checkbox>
	{/if}

	<!--
		A native disclosure rather than an accordion primitive: three optional
		numbers that almost every objective leaves blank should not cost four
		rows of height on every card, and there is nothing here to animate.
	-->
	<details class="border-border rounded-md border px-3 py-2">
		<summary class="cursor-pointer text-sm font-medium">{m.workflows_advanced()}</summary>
		<div class="grid gap-4 pt-3 sm:grid-cols-3">
			<div class="flex flex-col gap-2">
				<Label for={`${id}-min-rating`}>{m.workflows_minRating()}</Label>
				<!--
					Not `bind:value`. A number input binds back a real number and an
					emptied box would arrive as something other than "leave it to the
					default" — which is a different instruction from "accept anything".
					`optionalNumber` is the one place blank becomes `undefined`.
				-->
				<Input
					id={`${id}-min-rating`}
					type="number"
					min={0}
					max={1}
					step="0.05"
					inputmode="decimal"
					value={numberText(objective.minRating)}
					oninput={(event) => {
						objective.minRating = optionalNumber(event.currentTarget.value);
					}}
				/>
				<p class="text-muted-foreground text-xs">
					{m.workflows_defaultHint({ value: RATING_ANSWERED })}
				</p>
			</div>
			<div class="flex flex-col gap-2">
				<Label for={`${id}-min-confidence`}>{m.workflows_minConfidence()}</Label>
				<Input
					id={`${id}-min-confidence`}
					type="number"
					min={0}
					max={1}
					step="0.05"
					inputmode="decimal"
					value={numberText(objective.minConfidence)}
					oninput={(event) => {
						objective.minConfidence = optionalNumber(event.currentTarget.value);
					}}
				/>
				<p class="text-muted-foreground text-xs">
					{m.workflows_defaultHint({ value: CONFIDENCE_ACCEPT })}
				</p>
			</div>
			<div class="flex flex-col gap-2">
				<Label for={`${id}-max-attempts`}>{m.workflows_maxAttempts()}</Label>
				<Input
					id={`${id}-max-attempts`}
					type="number"
					min={1}
					step="1"
					inputmode="numeric"
					value={numberText(objective.maxAttempts)}
					oninput={(event) => {
						objective.maxAttempts = optionalNumber(event.currentTarget.value);
					}}
				/>
				<p class="text-muted-foreground text-xs">
					{m.workflows_maxAttemptsHelp({ count: MAX_RESPONDER_TURNS })}
				</p>
			</div>
		</div>
	</details>

	<div class="flex justify-end">
		<Button variant="ghost" size="sm" onclick={onRemove}>
			<TrashIcon class="size-4" aria-hidden="true" />
			{m.workflows_removeObjective()}
		</Button>
	</div>
</div>
