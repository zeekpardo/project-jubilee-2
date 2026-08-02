<script lang="ts">
	// Primitives
	import * as Card from '$lib/primitives/ui/card';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import { DEFAULT_PUBLIC_COUNT_THRESHOLD, resolvePublicPolicy } from '$lib/domain/public-policy';
	import { PROTECTED_FIELD_KEYS } from '$lib/domain/field-definitions';
	import * as m from '$lib/i18n/messages';

	let { settings, canWrite }: { settings: Doc<'orgSettings'> | null; canWrite: boolean } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let threshold = $state(String(DEFAULT_PUBLIC_COUNT_THRESHOLD));
	let extraKeys = $state('');
	let isSaving = $state(false);

	// One-time seed, same rule as the other cards on this page.
	let loaded = $state(false);
	$effect(() => {
		if (loaded || settings === null) return;
		const policy = resolvePublicPolicy(settings);
		threshold = String(policy.countThreshold);
		extraKeys = policy.extraProtectedKeys.join('\n');
		loaded = true;
	});

	const parsedThreshold = $derived.by(() => {
		const value = Number(threshold.trim());
		return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
	});

	// Turning suppression off is a real choice for an org whose records are not
	// people, and a serious one for an org whose records are. Say so.
	const suppressionOff = $derived(parsedThreshold === 0);

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canWrite) return;
		if (parsedThreshold === null) {
			toast.error(m.privacy_thresholdInvalid());
			return;
		}
		isSaving = true;
		try {
			await client.mutation(api.orgSettings.mutations.upsertOrgSettings, {
				publicCountThreshold: parsedThreshold,
				protectedFieldKeys: extraKeys
					.split('\n')
					.map((key) => key.trim())
					.filter((key) => key !== '')
			});
			toast.success(m.publicSiteSettings_identitySaved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.privacy_title()}</Card.Title>
		<Card.Description>{m.privacy_body()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-6" onsubmit={save}>
			<div class="flex flex-col gap-1.5">
				<Label for="privacy-threshold">{m.privacy_threshold()}</Label>
				<Input
					id="privacy-threshold"
					type="number"
					min="0"
					class="max-w-32"
					bind:value={threshold}
					disabled={!canWrite}
					aria-invalid={parsedThreshold === null ? true : undefined}
				/>
				<p class="text-muted-foreground text-xs">{m.privacy_thresholdHelp()}</p>
				{#if suppressionOff}
					<Alert.Root variant="warning" class="mt-1 w-full">
						<TriangleAlertIcon class="size-4" />
						<Alert.Description>{m.privacy_thresholdOffWarning()}</Alert.Description>
					</Alert.Root>
				{/if}
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="privacy-keys">{m.privacy_extraKeys()}</Label>
				<Textarea
					id="privacy-keys"
					bind:value={extraKeys}
					rows={3}
					class="font-mono text-xs"
					disabled={!canWrite}
					placeholder={m.privacy_extraKeysPlaceholder()}
				/>
				<p class="text-muted-foreground text-xs">{m.privacy_extraKeysHelp()}</p>

				<!--
					Shown so an admin can see what they are adding TO. These cannot be
					removed here on purpose: they protect the people this app serves,
					which is not a per-organization decision.
				-->
				<div class="mt-2 flex flex-col gap-1.5">
					<span class="text-muted-foreground text-xs font-medium">
						{m.privacy_alwaysProtected()}
					</span>
					<div class="flex flex-wrap gap-1.5">
						{#each PROTECTED_FIELD_KEYS as key (key)}
							<Badge variant="outline" class="font-mono text-[11px]">{key}</Badge>
						{/each}
						<Badge variant="outline" class="text-[11px]">{m.privacy_patternKeys()}</Badge>
					</div>
				</div>
			</div>

			{#if canWrite}
				<div>
					<Button type="submit" loading={isSaving} disabled={isSaving}>
						{m.action_saveChanges()}
					</Button>
				</div>
			{/if}
		</form>
	</Card.Content>
</Card.Root>
