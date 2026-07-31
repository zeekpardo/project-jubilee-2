<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import InfoIcon from '@lucide/svelte/icons/info';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useQuery, useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc, Id } from '$convex/_generated/dataModel';

	import { dollarsToCents, centsToDollarInput } from '$lib/features/settings/amount';
	import type { BudgetExtra } from '$lib/domain/budget';
	import * as m from '$lib/i18n/messages';
	import { formatCents, targetCentsFor } from './format';

	let {
		open = $bindable(false),
		projectId,
		campaignId,
		budget = null
	}: {
		open?: boolean;
		projectId: Id<'projects'>;
		campaignId: Id<'campaigns'>;
		/** Null creates the project's one budget, a row edits it. */
		budget?: Doc<'budgets'> | null;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	type ExtraRow = { id: number; label: string; amount: string };

	let nextRowId = 0;
	let templateId = $state('');
	let debt = $state('');
	let rows = $state<ExtraRow[]>([]);
	let isSaving = $state(false);

	const isEdit = $derived(budget !== null);

	const templatesResponse = useQuery(api.costTemplates.queries.listCostTemplates, () =>
		open ? { campaignId } : 'skip'
	);
	const templates = $derived(templatesResponse.data ?? []);

	function blankRow(): ExtraRow {
		nextRowId += 1;
		return { id: nextRowId, label: '', amount: '' };
	}

	$effect(() => {
		if (!open) return;
		const source = budget;
		templateId = '';
		debt = source ? centsToDollarInput(source.debtCents) : '';
		rows = (source?.extras ?? []).map((extra) => ({
			...blankRow(),
			label: extra.label,
			amount: centsToDollarInput(extra.amount_cents)
		}));
	});

	// The list is newest-first, so an untouched picker offers the current rate
	// card on create and the budget's own snapshotted version on edit.
	const defaultTemplateId = $derived.by(() => {
		const stored = budget
			? templates.find((template) => template.version === budget.templateVersion)
			: undefined;
		return stored?._id ?? templates[0]?._id ?? '';
	});

	const selectedTemplateId = $derived(templateId === '' ? defaultTemplateId : templateId);

	const selectedTemplate = $derived(
		templates.find((template) => template._id === selectedTemplateId) ?? null
	);

	const templateCollection = $derived(
		createListCollection({
			items: templates.map((template) => ({
				value: template._id as string,
				label: template.version
			}))
		})
	);

	const snapshot = $derived.by(() => {
		if (budget && selectedTemplate?.version === budget.templateVersion) {
			return budget.templateSnapshot;
		}
		return selectedTemplate?.lineItems ?? budget?.templateSnapshot ?? {};
	});

	const filled = $derived(
		rows.filter((row) => row.label.trim() !== '' || row.amount.trim() !== '')
	);

	const debtCents = $derived(debt.trim() === '' ? 0 : dollarsToCents(debt));

	const amountsValid = $derived(
		debtCents !== null &&
			filled.every((row) => row.label.trim() !== '' && dollarsToCents(row.amount) !== null)
	);

	const extras = $derived(
		filled.map((row) => ({
			label: row.label.trim(),
			amount_cents: dollarsToCents(row.amount) ?? 0
		}))
	);

	// Read-only: the target is derived from the snapshot, debt and extras and is
	// never typed by a user.
	const targetCents = $derived(
		targetCentsFor({ templateSnapshot: snapshot, debtCents: debtCents ?? 0, extras })
	);

	const canSubmit = $derived(amountsValid && (isEdit || selectedTemplateId !== ''));

	function addRow(): void {
		rows = [...rows, blankRow()];
	}

	function removeRow(id: number): void {
		rows = rows.filter((row) => row.id !== id);
	}

	function buildExtras(): BudgetExtra[] | null {
		const built: BudgetExtra[] = [];
		for (const row of filled) {
			const cents = dollarsToCents(row.amount);
			if (cents === null || row.label.trim() === '') return null;
			built.push({ label: row.label.trim(), amount_cents: cents });
		}
		return built;
	}

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;

		const built = buildExtras();
		const cents = debtCents;
		if (built === null || cents === null) return;

		isSaving = true;
		try {
			if (budget) {
				if (selectedTemplate && selectedTemplate.version !== budget.templateVersion) {
					await client.mutation(api.budgets.mutations.reapplyTemplate, {
						budgetId: budget._id,
						costTemplateId: selectedTemplate._id
					});
				}
				await client.mutation(api.budgets.mutations.updateBudget, {
					budgetId: budget._id,
					debtCents: cents,
					extras: built
				});
			} else {
				await client.mutation(api.budgets.mutations.createBudget, {
					projectId,
					costTemplateId: selectedTemplateId as Id<'costTemplates'>,
					debtCents: cents,
					extras: built
				});
			}
			toast.success(m.projects_budgetSaved());
			open = false;
		} catch (error: unknown) {
			toast.error(
				error instanceof ConvexError
					? String(error.data)
					: error instanceof Error
						? error.message
						: m.state_saveFailed()
			);
		} finally {
			isSaving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-2xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{isEdit ? m.projects_budgetEdit() : m.projects_budgetCreate()}</Dialog.Title>
		</Dialog.Header>

		{#if !templatesResponse.isLoading && templates.length === 0}
			<Alert.Root variant="warning" class="w-full">
				<InfoIcon class="size-4" />
				<Alert.Description>{m.settings_costEmpty()}</Alert.Description>
			</Alert.Root>
		{/if}

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label>{m.projects_budgetTemplate()}</Label>
				<Select.Root
					collection={templateCollection}
					value={selectedTemplateId === '' ? [] : [selectedTemplateId]}
					onValueChange={(details: { value: string[] }): void => {
						templateId = details.value[0] ?? '';
					}}
				>
					<Select.Trigger class="w-full" placeholder={m.projects_budgetTemplate()} />
					<Select.Content>
						{#each templateCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				{#if isEdit}
					<p class="text-muted-foreground text-xs">{m.projects_budgetReapply()}</p>
				{/if}
			</div>

			{#if Object.keys(snapshot).length > 0}
				<dl class="bg-muted/40 flex flex-col gap-1 rounded-md p-3 text-sm">
					{#each Object.entries(snapshot) as [key, cents] (key)}
						<div class="flex items-center justify-between gap-4">
							<dt class="text-muted-foreground font-mono text-xs">{key}</dt>
							<dd class="tabular-nums">{formatCents(cents)}</dd>
						</div>
					{/each}
				</dl>
			{/if}

			<div class="flex flex-col gap-2">
				<Label for="budget-debt">{m.projects_budgetDebt()}</Label>
				<Input
					id="budget-debt"
					class="max-w-48 text-right tabular-nums"
					inputmode="decimal"
					bind:value={debt}
					aria-invalid={debtCents === null ? true : undefined}
				/>
				<p class="text-muted-foreground text-xs">{m.settings_amountsInDollars()}</p>
			</div>

			<div class="flex flex-col gap-2">
				<Label>{m.projects_budgetExtras()}</Label>
				<div class="flex flex-col gap-2">
					{#each rows as row (row.id)}
						<div class="flex items-center gap-2">
							<Input
								bind:value={row.label}
								placeholder={m.projects_budgetExtraLabel()}
								aria-label={m.projects_budgetExtraLabel()}
							/>
							<Input
								bind:value={row.amount}
								class="max-w-40 text-right tabular-nums"
								inputmode="decimal"
								placeholder={m.field_amount()}
								aria-label={m.field_amount()}
							/>
							<Button
								type="button"
								variant="ghost"
								size="icon"
								aria-label={m.action_remove()}
								title={m.action_remove()}
								onclick={() => removeRow(row.id)}
							>
								<Trash2Icon />
							</Button>
						</div>
					{/each}
				</div>
				<div>
					<Button type="button" variant="outline" size="sm" onclick={addRow}>
						<PlusIcon />
						{m.action_add()}
					</Button>
				</div>
			</div>

			{#if !amountsValid}
				<p class="text-error-700-300 text-xs">{m.settings_amountInvalid()}</p>
			{/if}

			<div class="flex items-center justify-between gap-4 border-t pt-4">
				<span class="text-sm font-medium">{m.projects_budgetTarget()}</span>
				<output class="text-base font-semibold tabular-nums">{formatCents(targetCents)}</output>
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{isEdit ? m.action_save() : m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
