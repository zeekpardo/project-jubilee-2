<script lang="ts">
	import * as Card from '$lib/primitives/ui/card';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	let { settings }: { settings: Doc<'orgSettings'> | null } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let legalName = $state('');
	let ein = $state('');
	let acknowledgmentText = $state('');
	let isSaving = $state(false);

	let loaded = $state(false);
	$effect(() => {
		if (loaded) return;
		legalName = settings?.legalName ?? '';
		ein = settings?.ein ?? '';
		acknowledgmentText = settings?.acknowledgmentText ?? '';
		loaded = true;
	});

	async function save(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving) return;
		isSaving = true;
		try {
			await client.mutation(api.stripe.mutations.updateReceiptDetails, {
				legalName: legalName.trim() || undefined,
				ein: ein.trim() || undefined,
				acknowledgmentText: acknowledgmentText.trim() || undefined
			});
			toast.success(m.giving_receiptSaved());
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			isSaving = false;
		}
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title>{m.giving_receiptTitle()}</Card.Title>
		<Card.Description>{m.giving_receiptBody()}</Card.Description>
	</Card.Header>
	<Card.Content>
		<form class="flex flex-col gap-4" onsubmit={save}>
			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-1.5">
					<Label for="giving-legal-name">{m.giving_legalNameLabel()}</Label>
					<Input id="giving-legal-name" bind:value={legalName} maxlength={200} />
					<p class="text-muted-foreground text-xs">{m.giving_legalNameHelp()}</p>
				</div>
				<div class="flex flex-col gap-1.5">
					<Label for="giving-ein">{m.giving_einLabel()}</Label>
					<Input id="giving-ein" bind:value={ein} maxlength={20} />
				</div>
			</div>

			<div class="flex flex-col gap-1.5">
				<Label for="giving-acknowledgment">{m.giving_acknowledgmentLabel()}</Label>
				<Textarea id="giving-acknowledgment" bind:value={acknowledgmentText} rows={3} />
				<p class="text-muted-foreground text-xs">{m.giving_acknowledgmentHelp()}</p>
			</div>

			<div>
				<Button type="submit" loading={isSaving} disabled={isSaving}>
					{m.action_saveChanges()}
				</Button>
			</div>
		</form>
	</Card.Content>
</Card.Root>
