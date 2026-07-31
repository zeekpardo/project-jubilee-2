<script lang="ts">
	import PlusIcon from '@lucide/svelte/icons/plus';
	import { toast } from 'svelte-sonner';
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button, buttonVariants } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import type { Id } from '$convex/_generated/dataModel';
	import * as m from '$lib/i18n/messages';

	let { campaignId, objectLabel }: { campaignId: Id<'campaigns'>; objectLabel: string } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let open = $state(false);
	let name = $state('');
	let story = $state('');
	let isSubmitting = $state(false);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;

		isSubmitting = true;
		try {
			await client.mutation(api.projects.mutations.createProject, {
				campaignId,
				name: trimmed,
				story: story.trim() === '' ? undefined : story.trim()
			});
			toast.success(m.projects_created());
			name = '';
			story = '';
			open = false;
		} catch (error: unknown) {
			toast.error(error instanceof Error ? error.message : m.state_error());
		} finally {
			isSubmitting = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Trigger class={buttonVariants({ variant: 'default' })}>
		<PlusIcon class="size-4" aria-hidden="true" />
		{m.projects_new()}
	</Dialog.Trigger>

	<Dialog.Content class="md:max-w-108">
		<Dialog.Header>
			<Dialog.Title>{`${m.projects_new()} · ${objectLabel}`}</Dialog.Title>
		</Dialog.Header>

		<form class="flex w-full flex-col gap-4" onsubmit={handleSubmit}>
			<div class="flex flex-col gap-2">
				<Label for="new-project-name">{m.field_name()}</Label>
				<Input id="new-project-name" bind:value={name} required autocomplete="off" />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="new-project-story">{m.projects_story()}</Label>
				<Textarea id="new-project-story" bind:value={story} rows={4} />
			</div>

			<Dialog.Footer class="w-full">
				<Button variant="outline" onclick={() => (open = false)} disabled={isSubmitting}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSubmitting} disabled={name.trim() === ''}>
					{m.action_create()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
