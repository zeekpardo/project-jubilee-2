<script lang="ts">
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	import * as Card from '$lib/primitives/ui/card';
	import * as Alert from '$lib/primitives/ui/alert';
	import { Badge } from '$lib/primitives/ui/badge';
	import { Switch } from '$lib/primitives/ui/switch';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Button } from '$lib/primitives/ui/button';
	import { InlineEdit } from '$lib/primitives/ui/inline-edit';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import * as m from '$lib/i18n/messages';

	import type { Id } from '$convex/_generated/dataModel';

	let {
		projectId,
		number,
		campaignSlug,
		orgSlug,
		isPublished,
		publicName,
		videoUrl,
		canWrite = false
	}: {
		projectId: Id<'projects'>;
		number: string;
		campaignSlug: string;
		orgSlug: string | null;
		isPublished: boolean;
		publicName?: string;
		videoUrl?: string;
		canWrite?: boolean;
	} = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let working = $state(false);

	// The public site resolves an org by its own slug, so without one there is
	// no address to show rather than a broken guess.
	const publicLink = $derived(
		orgSlug
			? `${typeof window === 'undefined' ? '' : window.location.origin}/${orgSlug}/${campaignSlug}/${number}`
			: ''
	);

	async function togglePublished(next: boolean) {
		working = true;
		try {
			await client.mutation(api.projects.mutations.setProjectPublished, {
				projectId,
				isPublished: next
			});
		} catch (error) {
			toast.error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed());
		} finally {
			working = false;
		}
	}

	async function save(field: string, next: string) {
		try {
			await client.mutation(api.projects.mutations.updateProject, { projectId, [field]: next });
		} catch (error) {
			throw new Error(error instanceof ConvexError ? String(error.data) : m.state_saveFailed(), {
				cause: error
			});
		}
	}

	async function copyLink() {
		if (!publicLink) return;
		await navigator.clipboard.writeText(publicLink);
		toast.success(m.projectDetail_copied());
	}
</script>

<Card.Root>
	<Card.Header>
		<Card.Title class="text-base">{m.projectDetail_publicTitle()}</Card.Title>
		<Card.Action>
			<Badge variant={isPublished ? 'success' : 'outline'}>
				{isPublished ? m.projectDetail_published() : m.projectDetail_notPublished()}
			</Badge>
		</Card.Action>
	</Card.Header>
	<Card.Content class="flex flex-col gap-6">
		<div class="flex items-start justify-between gap-4 rounded-md border p-4">
			<div class="min-w-0">
				<Label>{m.projectDetail_publishLabel()}</Label>
				<p class="text-muted-foreground mt-1 text-sm">{m.projectDetail_publishHelp()}</p>
			</div>
			<Switch
				checked={isPublished}
				disabled={!canWrite || working}
				onCheckedChange={(details: { checked: boolean }) => togglePublished(details.checked)}
			/>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label>{m.projectDetail_publicName()}</Label>
			<InlineEdit
				value={publicName}
				disabled={!canWrite}
				ariaLabel={m.projectDetail_publicName()}
				placeholder="—"
				onSave={(next) => save('publicName', next)}
			/>
			<p class="text-muted-foreground text-xs">{m.projectDetail_publicNameHelp()}</p>
		</div>

		<div class="flex flex-col gap-1.5">
			<Label>{m.projectDetail_publicLink()}</Label>
			<div class="flex items-center gap-2">
				<Input readonly value={publicLink} class="font-mono text-xs" />
				<Button variant="outline" size="icon" onclick={copyLink} disabled={!publicLink}>
					<CopyIcon class="size-4" />
				</Button>
			</div>
			{#if !isPublished}
				<p class="text-warning-600 dark:text-warning-400 text-xs">
					{m.projectDetail_linkNotLive()}
				</p>
			{/if}
		</div>

		<div class="flex flex-col gap-1.5">
			<Label>{m.projectDetail_videoUrl()}</Label>
			<InlineEdit
				value={videoUrl}
				disabled={!canWrite}
				type="url"
				ariaLabel={m.projectDetail_videoUrl()}
				placeholder="—"
				inputClass="font-mono text-xs"
				onSave={(next) => save('videoUrl', next)}
			/>
		</div>

		<Alert.Root>
			<Alert.Title>{m.projectDetail_whatDonorsSee()}</Alert.Title>
			<Alert.Description>{m.projectDetail_whatDonorsSeeBody()}</Alert.Description>
		</Alert.Root>
	</Card.Content>
</Card.Root>
