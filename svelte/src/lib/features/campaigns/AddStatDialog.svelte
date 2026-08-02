<script lang="ts">
	// ONE way in. An impact stat can come from four places, and the old card
	// offered a flat picker for three of them plus a separate builder for the
	// fourth — which read as two unrelated features. Here the first question is
	// always "what should this count?", and the rest of the form follows from
	// the answer.

	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import * as Select from '$lib/primitives/ui/select';
	import { Button } from '$lib/primitives/ui/button';
	import { Label } from '$lib/primitives/ui/label';
	import { createListCollection } from '@ark-ui/svelte/select';
	import { toast } from 'svelte-sonner';

	// API
	import { useQuery } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Id } from '$convex/_generated/dataModel';

	import {
		humanizeToken,
		memberStatLabel,
		statConfigId,
		STAT_METRIC_KEYS,
		STAT_METRICS,
		resolveStatLabel,
		type MemberAmong,
		type MemberCount,
		type MemberFilter,
		type StatSource
	} from '$lib/domain/campaign-stats';
	import { isProtectedFieldKey } from '$lib/domain/field-definitions';
	import type { Campaign } from './types';
	import * as m from '$lib/i18n/messages';

	let {
		open = $bindable(false),
		campaign,
		/** Ids already in the list, so the same number cannot be added twice. */
		taken,
		onAdd
	}: {
		open?: boolean;
		campaign: Campaign;
		taken: Set<string>;
		onAdd: (source: StatSource) => void;
	} = $props();

	const { api } = getAuthContext();
	const campaignId = $derived(campaign._id as Id<'campaigns'>);

	const fieldsResponse = useQuery(api.customFields.queries.resolveFields, () =>
		open ? { entity: 'project' as const, campaignId } : 'skip'
	);
	const fields = $derived(
		(fieldsResponse.data ?? []).filter((def) => !isProtectedFieldKey(def.key))
	);

	const tagsResponse = useQuery(api.taskTemplates.queries.listImpactTags, () =>
		open ? { campaignId } : 'skip'
	);
	const tags = $derived(tagsResponse.data ?? []);

	const dimensionsResponse = useQuery(api.campaigns.queries.listMemberDimensions, () =>
		open ? { campaignId } : 'skip'
	);
	const dimensions = $derived(
		dimensionsResponse.data ?? { householdRoles: [], relationships: [], contactFields: [] }
	);

	const labelCtx = $derived({
		objectLabelPlural: campaign.objectLabelPlural,
		goalLabel: campaign.goalLabel
	});

	type Kind = 'builtin' | 'field' | 'task' | 'member';

	let kind = $state<Kind>('builtin');
	let metric = $state('');
	let fieldKey = $state('');
	let aggregate = $state('count');
	let impactTag = $state('');
	let memberAmong = $state('goalMet');
	let memberFilter = $state('');
	let memberCount = $state<MemberCount>('people');

	$effect(() => {
		if (!open) return;
		kind = 'builtin';
		metric = '';
		fieldKey = '';
		aggregate = 'count';
		impactTag = '';
		memberAmong = 'goalMet';
		memberFilter = '';
		memberCount = 'people';
	});

	const kindCollection = createListCollection({
		items: [
			{ value: 'builtin', label: m.campaignStats_kindBuiltin() },
			{ value: 'field', label: m.campaignStats_kindField() },
			{ value: 'task', label: m.campaignStats_kindTask() },
			{ value: 'member', label: m.campaignStats_kindMember() }
		]
	});

	const kindHelp = $derived.by(() => {
		switch (kind) {
			case 'builtin':
				return m.campaignStats_kindBuiltinHelp();
			case 'field':
				return m.campaignStats_kindFieldHelp();
			case 'task':
				return m.campaignStats_kindTaskHelp();
			case 'member':
				return m.campaignStats_kindMemberHelp();
		}
	});

	// ---- Built-in ------------------------------------------------------------
	const metricCollection = $derived(
		createListCollection({
			items: STAT_METRIC_KEYS.filter(
				(key) => !taken.has(statConfigId({ kind: 'builtin', metric: key }))
			).map((key) => ({ value: key, label: resolveStatLabel(STAT_METRICS[key], labelCtx) }))
		})
	);

	// ---- Field ---------------------------------------------------------------
	const fieldCollection = $derived(
		createListCollection({
			items: fields.map((def) => ({ value: def.key, label: def.label }))
		})
	);

	const selectedField = $derived(fields.find((def) => def.key === fieldKey) ?? null);

	/**
	 * How to turn a column of values into one number. The choices depend on the
	 * field's type — you can total a number, but not a date — and a `select`
	 * field additionally offers one bucket per choice.
	 */
	const aggregateCollection = $derived.by(() => {
		const def = selectedField;
		const items: { value: string; label: string }[] = [];
		if (def && (def.type === 'number' || def.type === 'money')) {
			items.push({ value: 'sum', label: m.campaignStats_aggregateSum() });
		}
		items.push({ value: 'count', label: m.campaignStats_aggregateCount() });
		for (const option of def?.options ?? []) {
			items.push({
				value: `countWhere:${option}`,
				label: m.campaignStats_aggregateCountWhere({ value: option })
			});
		}
		return createListCollection({ items });
	});

	// ---- Checklist -----------------------------------------------------------
	const tagCollection = $derived(
		createListCollection({
			items: tags
				.filter((tag) => !taken.has(statConfigId({ kind: 'task', impactTag: tag.tag })))
				.map((tag) => ({ value: tag.tag, label: humanizeToken(tag.tag) }))
		})
	);

	// ---- People --------------------------------------------------------------
	const amongCollection = $derived(
		createListCollection({
			items: [
				{ value: 'all', label: m.campaignStats_amongAll({ objects: campaign.objectLabelPlural }) },
				{
					value: 'goalMet',
					label: m.campaignStats_amongGoalMet({
						objects: campaign.objectLabelPlural,
						goal: campaign.goalLabel
					})
				},
				...tags.map((tag) => ({
					value: `task:${tag.tag}`,
					label: m.campaignStats_amongTask({ tag: humanizeToken(tag.tag) })
				}))
			]
		})
	);

	const filterCollection = $derived(
		createListCollection({
			items: [
				{ value: '', label: m.campaignStats_filterAnyone() },
				...dimensions.householdRoles.map((role) => ({
					value: `householdRole:${role}`,
					label: m.campaignStats_filterHouseholdRole({ role: humanizeToken(role) })
				})),
				...dimensions.relationships.map((relationship) => ({
					value: `relationship:${relationship}`,
					label: m.campaignStats_filterRelationship({ relationship: humanizeToken(relationship) })
				})),
				...dimensions.contactFields.flatMap((field) => [
					{
						value: `contactField:${field.key}`,
						label: m.campaignStats_filterContactField({ field: field.label })
					},
					...field.options.map((option) => ({
						value: `contactField:${field.key}:${option}`,
						label: m.campaignStats_filterContactFieldValue({ field: field.label, value: option })
					}))
				])
			]
		})
	);

	const countCollection = $derived(
		createListCollection({
			items: [
				{ value: 'people', label: m.campaignStats_countPeople() },
				{
					value: 'records',
					label: m.campaignStats_countRecords({ objects: campaign.objectLabelPlural })
				}
			]
		})
	);

	function parseAmong(value: string): MemberAmong {
		if (value.startsWith('task:')) return { kind: 'task', impactTag: value.slice(5) };
		return value === 'all' ? { kind: 'all' } : { kind: 'goalMet' };
	}

	function parseFilter(value: string): MemberFilter | undefined {
		if (!value) return undefined;
		if (value.startsWith('householdRole:')) {
			return { dimension: 'householdRole', value: value.slice('householdRole:'.length) };
		}
		if (value.startsWith('relationship:')) {
			return { dimension: 'relationship', value: value.slice('relationship:'.length) };
		}
		const rest = value.slice('contactField:'.length);
		const separator = rest.indexOf(':');
		return separator === -1
			? { dimension: 'contactField', fieldKey: rest }
			: {
					dimension: 'contactField',
					fieldKey: rest.slice(0, separator),
					matchValue: rest.slice(separator + 1)
				};
	}

	// ---- The declaration being built ----------------------------------------

	const source = $derived.by((): StatSource | null => {
		switch (kind) {
			case 'builtin':
				return metric ? { kind: 'builtin', metric } : null;
			case 'field': {
				if (!fieldKey) return null;
				if (aggregate.startsWith('countWhere:')) {
					return {
						kind: 'field',
						fieldKey,
						aggregate: 'countWhere',
						matchValue: aggregate.slice('countWhere:'.length)
					};
				}
				return { kind: 'field', fieldKey, aggregate: aggregate === 'sum' ? 'sum' : 'count' };
			}
			case 'task':
				return impactTag ? { kind: 'task', impactTag } : null;
			case 'member':
				return {
					kind: 'member',
					among: parseAmong(memberAmong),
					filter: parseFilter(memberFilter),
					count: memberCount
				};
		}
	});

	/** What the stat will be called before an admin renames it. */
	const previewLabel = $derived.by(() => {
		if (!source) return null;
		switch (source.kind) {
			case 'builtin':
				return resolveStatLabel(STAT_METRICS[source.metric as never], labelCtx);
			case 'field':
				return fields.find((def) => def.key === source.fieldKey)?.label ?? source.fieldKey;
			case 'task':
				return humanizeToken(source.impactTag);
			case 'member':
				return memberStatLabel(
					source,
					labelCtx,
					(key) => dimensions.contactFields.find((field) => field.key === key)?.label ?? key
				);
		}
	});

	const alreadyAdded = $derived(source !== null && taken.has(statConfigId(source)));
	const canAdd = $derived(source !== null && !alreadyAdded);

	function add(): void {
		if (!source || alreadyAdded) {
			if (alreadyAdded) toast.error(m.campaignStats_alreadyAdded());
			return;
		}
		onAdd(source);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="md:max-w-xl">
		<Dialog.Header class="w-full">
			<Dialog.Title>{m.campaignStats_addTitle()}</Dialog.Title>
		</Dialog.Header>

		<div class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="stat-kind">{m.campaignStats_kindLabel()}</Label>
				<Select.Root
					collection={kindCollection}
					ids={{ trigger: 'stat-kind' }}
					value={[kind]}
					onValueChange={(details: { value: string[] }): void => {
						kind = (details.value[0] as Kind) ?? 'builtin';
					}}
				>
					<Select.Trigger class="w-full" placeholder="" />
					<Select.Content>
						{#each kindCollection.items as option (option.value)}
							<Select.Item item={option}>
								<Select.ItemText>{option.label}</Select.ItemText>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-muted-foreground text-xs">{kindHelp}</p>
			</div>

			{#if kind === 'builtin'}
				<div class="flex flex-col gap-2">
					<Label for="stat-metric">{m.campaignStats_pickNumber()}</Label>
					{#if metricCollection.items.length === 0}
						<p class="text-muted-foreground text-sm">{m.campaignStats_allAdded()}</p>
					{:else}
						<Select.Root
							collection={metricCollection}
							ids={{ trigger: 'stat-metric' }}
							value={metric ? [metric] : []}
							onValueChange={(details: { value: string[] }): void => {
								metric = details.value[0] ?? '';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.campaignStats_pickNumber()} />
							<Select.Content>
								{#each metricCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			{:else if kind === 'field'}
				<div class="flex flex-col gap-2">
					<Label for="stat-field">{m.campaignStats_pickField()}</Label>
					{#if fieldCollection.items.length === 0}
						<p class="text-muted-foreground text-sm">{m.campaignStats_noFields()}</p>
					{:else}
						<Select.Root
							collection={fieldCollection}
							ids={{ trigger: 'stat-field' }}
							value={fieldKey ? [fieldKey] : []}
							onValueChange={(details: { value: string[] }): void => {
								fieldKey = details.value[0] ?? '';
								// The aggregates on offer depend on the field's type, so a
								// carried-over choice could be one this field cannot do.
								aggregate = 'count';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.campaignStats_pickField()} />
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

				{#if fieldKey}
					<div class="flex flex-col gap-2">
						<Label for="stat-aggregate">{m.campaignStats_pickAggregate()}</Label>
						<Select.Root
							collection={aggregateCollection}
							ids={{ trigger: 'stat-aggregate' }}
							value={[aggregate]}
							onValueChange={(details: { value: string[] }): void => {
								aggregate = details.value[0] ?? 'count';
							}}
						>
							<Select.Trigger class="w-full" placeholder="" />
							<Select.Content>
								{#each aggregateCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					</div>
				{/if}
			{:else if kind === 'task'}
				<div class="flex flex-col gap-2">
					<Label for="stat-tag">{m.campaignStats_pickTag()}</Label>
					{#if tagCollection.items.length === 0}
						<p class="text-muted-foreground text-sm">{m.campaignStats_noTags()}</p>
					{:else}
						<Select.Root
							collection={tagCollection}
							ids={{ trigger: 'stat-tag' }}
							value={impactTag ? [impactTag] : []}
							onValueChange={(details: { value: string[] }): void => {
								impactTag = details.value[0] ?? '';
							}}
						>
							<Select.Trigger class="w-full" placeholder={m.campaignStats_pickTag()} />
							<Select.Content>
								{#each tagCollection.items as option (option.value)}
									<Select.Item item={option}>
										<Select.ItemText>{option.label}</Select.ItemText>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/if}
				</div>
			{:else}
				<div class="flex flex-col gap-2">
					<Label for="stat-among">{m.campaignStats_among()}</Label>
					<Select.Root
						collection={amongCollection}
						ids={{ trigger: 'stat-among' }}
						value={[memberAmong]}
						onValueChange={(details: { value: string[] }): void => {
							memberAmong = details.value[0] ?? 'goalMet';
						}}
					>
						<Select.Trigger class="w-full" placeholder="" />
						<Select.Content>
							{#each amongCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="stat-who">{m.campaignStats_whichPeople()}</Label>
					<Select.Root
						collection={filterCollection}
						ids={{ trigger: 'stat-who' }}
						value={[memberFilter]}
						onValueChange={(details: { value: string[] }): void => {
							memberFilter = details.value[0] ?? '';
						}}
					>
						<Select.Trigger class="w-full" placeholder="" />
						<Select.Content>
							{#each filterCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div class="flex flex-col gap-2">
					<Label for="stat-count">{m.campaignStats_countAs()}</Label>
					<Select.Root
						collection={countCollection}
						ids={{ trigger: 'stat-count' }}
						value={[memberCount]}
						onValueChange={(details: { value: string[] }): void => {
							memberCount = (details.value[0] as MemberCount) ?? 'people';
						}}
					>
						<Select.Trigger class="w-full" placeholder="" />
						<Select.Content>
							{#each countCollection.items as option (option.value)}
								<Select.Item item={option}>
									<Select.ItemText>{option.label}</Select.ItemText>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			{/if}

			{#if previewLabel}
				<p class="text-muted-foreground bg-muted/50 rounded-md p-3 text-xs">
					{alreadyAdded
						? m.campaignStats_alreadyAdded()
						: m.campaignStats_willBeCalled({ label: previewLabel })}
				</p>
			{/if}
		</div>

		<Dialog.Footer class="w-full">
			<Button type="button" variant="outline" onclick={() => (open = false)}>
				{m.action_cancel()}
			</Button>
			<Button type="button" disabled={!canAdd} onclick={add}>{m.action_add()}</Button>
		</Dialog.Footer>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
