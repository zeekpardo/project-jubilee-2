<script lang="ts">
	// Primitives
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Button } from '$lib/primitives/ui/button';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import { Textarea } from '$lib/primitives/ui/textarea';
	import { toast } from 'svelte-sonner';
	import { ConvexError } from 'convex/values';

	// API
	import { useConvexClient } from '@mmailaender/convex-svelte';
	import { getAuthContext } from '$lib/auth/context.svelte';
	import type { Doc } from '$convex/_generated/dataModel';

	import * as m from '$lib/i18n/messages';

	let { open = $bindable(false), project }: { open?: boolean; project: Doc<'projects'> } = $props();

	const { api } = getAuthContext();
	const client = useConvexClient();

	let name = $state('');
	let publicName = $state('');
	let story = $state('');
	let photoUrl = $state('');
	let videoUrl = $state('');
	let isSaving = $state(false);

	$effect(() => {
		if (!open) return;
		name = project.name;
		publicName = project.publicName ?? '';
		story = project.story ?? '';
		photoUrl = project.photoUrl ?? '';
		videoUrl = project.videoUrl ?? '';
	});

	const canSubmit = $derived(name.trim().length > 0);

	async function handleSubmit(event: SubmitEvent): Promise<void> {
		event.preventDefault();
		if (isSaving || !canSubmit) return;
		isSaving = true;

		try {
			await client.mutation(api.projects.mutations.updateProject, {
				projectId: project._id,
				name: name.trim(),
				// The only field the mutation lets us clear outright; the rest read
				// an empty string as unset everywhere they are displayed.
				publicName: publicName.trim() === '' ? null : publicName.trim(),
				story: story.trim(),
				photoUrl: photoUrl.trim(),
				videoUrl: videoUrl.trim()
			});
			toast.success(m.projects_saved());
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
			<Dialog.Title>{m.projects_editDetails()}</Dialog.Title>
		</Dialog.Header>

		<form onsubmit={handleSubmit} class="flex w-full flex-col gap-4">
			<div class="flex flex-col gap-2">
				<Label for="project-name">{m.field_name()}</Label>
				<Input id="project-name" bind:value={name} required autocomplete="off" />
			</div>

			<div class="flex flex-col gap-2">
				<Label for="project-public-name">{m.projects_publicName()}</Label>
				<Input id="project-public-name" bind:value={publicName} autocomplete="off" />
				<p class="text-muted-foreground text-xs">{m.projects_publicNameHelp()}</p>
			</div>

			<div class="flex flex-col gap-2">
				<Label for="project-story">{m.projects_story()}</Label>
				<Textarea id="project-story" bind:value={story} rows={5} />
			</div>

			<div class="grid gap-4 sm:grid-cols-2">
				<div class="flex flex-col gap-2">
					<Label for="project-photo">{m.projects_photo()}</Label>
					<Input id="project-photo" type="url" bind:value={photoUrl} />
				</div>
				<div class="flex flex-col gap-2">
					<Label for="project-video">{m.projects_videoUrl()}</Label>
					<Input id="project-video" type="url" bind:value={videoUrl} />
				</div>
			</div>

			<Dialog.Footer class="w-full">
				<Button type="button" variant="outline" onclick={() => (open = false)} disabled={isSaving}>
					{m.action_cancel()}
				</Button>
				<Button type="submit" loading={isSaving} disabled={isSaving || !canSubmit}>
					{m.action_save()}
				</Button>
			</Dialog.Footer>
		</form>
		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>
