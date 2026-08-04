<script lang="ts">
	// ============================================================
	// Rich text editor — markdown in, markdown out
	// ============================================================
	// A generic authoring control, and deliberately nothing more. It takes
	// markdown, hands markdown back, and knows nothing about what the prose is
	// for: the same component is meant to serve every long-form field this app
	// has today and every one it grows later. Everything specific to a feature —
	// which record is being edited, when it saves, where the bytes are put — is
	// the caller's, which is why the only hole punched through it is
	// `onUploadImage`.
	//
	// Its output is markdown for `$lib/domain/rich-text.ts` and for nothing else.
	// Two platform directives extend what markdown can say, and this editor is
	// the thing that writes them:
	//
	//   ::image{id=<storageId> alt=""}
	//   ::video{url="https://…"}
	//
	// WHAT IT DELIBERATELY DOES NOT DO:
	//
	//   - It does not sanitize. Nothing typed here ever reaches a reader from
	//     this component; the security boundary is `renderRichText`, and a
	//     second, weaker set of rules here would only give someone a reason to
	//     trust the wrong one. See `sanitizer: false` below for why the editor's
	//     own preview is safe regardless.
	//   - It does not resolve a storage id to a URL. See `insertImage`.
	//   - It does not judge a video URL. `toVideoEmbed` already owns that
	//     decision and is tested against `javascript:` and friends; a second
	//     opinion here would be a second thing to keep in agreement with it, and
	//     the disagreement is where the hole would be.
	//   - It does not save, validate or debounce. `value` is bindable and that
	//     is the whole contract.
	//
	// It also has no top-level side effects — nothing here touches `window` or
	// `document` at module scope — so a consumer can keep the editor's bytes off
	// a public page with `{#await import('$lib/features/rich-text/…')}`. Carta,
	// shiki and this stylesheet are a large chunk that donors should never have
	// to download. Adding module-scope work would quietly take that option away.
	// ============================================================

	import { Carta, MarkdownEditor } from 'carta-md';
	// Carta's own stylesheet, imported rather than reimplemented. The rules
	// below override its six custom properties with this app's design tokens
	// instead of fighting its selectors. As a module import it travels inside
	// whichever chunk imports this component, so it stays lazy too.
	import 'carta-md/default.css';
	import { toast } from 'svelte-sonner';

	import { Button } from '$lib/primitives/ui/button';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as m from '$lib/i18n/messages';

	import PhotoToolbarIcon from './PhotoToolbarIcon.svelte';
	import VideoToolbarIcon from './VideoToolbarIcon.svelte';

	let {
		value = $bindable(''),
		onUploadImage,
		disabled = false,
		placeholder = '',
		id
	}: {
		/** Markdown source. Bindable: the editor writes every keystroke back. */
		value: string;
		/**
		 * Stores one image and resolves to the Convex storage id its bytes landed
		 * in. The caller owns the mutation, the authorization and the retry
		 * policy; this component only knows that a rejected promise means nothing
		 * is inserted.
		 */
		onUploadImage: (file: File) => Promise<string>;
		disabled?: boolean;
		placeholder?: string;
		/** Put on the textarea, so a caller's `<Label for>` points at something. */
		id?: string;
	} = $props();

	// Ten megabytes, checked in the browser. The server has to enforce its own
	// limit regardless — a cap a client applies is a courtesy, not a control —
	// but the courtesy is worth having: it fails in a tenth of a second instead
	// of after a phone has spent two minutes pushing a 40 MB photo over 4G.
	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

	const IMAGE_ICON_ID = 'platformImage';
	const VIDEO_ICON_ID = 'platformVideo';

	// Scopes the dialog's field id to this instance, so two editors on one page
	// do not both claim the same `for`/`id` pair.
	const uid = $props.id();

	let fileInput = $state<HTMLInputElement | null>(null);
	let uploading = $state(false);
	let videoDialogOpen = $state(false);
	let videoUrl = $state('');

	// One Carta instance per editor. It owns the textarea, the undo history and
	// the toolbar, so sharing one between two editors would braid two documents
	// together. Built once at init and never rebuilt: everything that can change
	// while the editor is on screen is passed to `<MarkdownEditor>` as a prop
	// instead, because rebuilding this would throw away the author's undo stack.
	const carta = new Carta({
		// Safe, and worth spelling out because `false` on an option with this
		// name reads like a mistake. Carta builds its preview with `remarkRehype`
		// and passes it no options, so `allowDangerousHtml` stays at its false
		// default and raw HTML typed into the box is dropped before it can reach
		// the preview's innerHTML — the same primary guarantee
		// `$lib/domain/rich-text.ts` is built on. NEVER pass `rehypeOptions`
		// here: that is the single change that would turn this preview into a way
		// for a pasted snippet to run script in an admin's own session.
		sanitizer: false,
		// Removed because `renderRichText` throws their output away: `del` and
		// task-list checkboxes are not in its allowed tag list, so these buttons
		// would produce markup that silently vanishes on the published page. A
		// control that appears to work and does nothing is worse than an absent
		// one. Quote, code and numbered list stay — `blockquote`, `pre` and `ol`
		// all survive the schema.
		disableIcons: ['strikethrough', 'taskList'],
		extensions: [
			{
				icons: [
					{
						id: IMAGE_ICON_ID,
						label: m.updates_addImage(),
						component: PhotoToolbarIcon,
						action: () => openImagePicker()
					},
					{
						id: VIDEO_ICON_ID,
						label: m.updates_addVideo(),
						component: VideoToolbarIcon,
						action: () => openVideoDialog()
					}
				]
			}
		]
	});

	// Derived rather than baked into the Carta instance above, because Carta's
	// toolbar prefers a label from here over the one on the icon: a `$derived`
	// re-reads the paraglide message when the locale changes, whereas the
	// instance is built once and would hold whichever language happened to be
	// active at mount.
	//
	// Quote, code and numbered list are absent because there are no message keys
	// for them yet, so they keep Carta's built-in English until there are. That
	// is a gap to close, not a decision.
	const labels = $derived({
		iconsLabels: {
			heading: m.richText_heading(),
			bold: m.richText_bold(),
			italic: m.richText_italic(),
			bulletedList: m.richText_bulletList(),
			link: m.richText_link(),
			[IMAGE_ICON_ID]: m.updates_addImage(),
			[VIDEO_ICON_ID]: m.updates_addVideo()
		}
	});

	/**
	 * Inserts a snippet as a paragraph of its own.
	 *
	 * A leaf directive is only a directive when it starts a line, so dropping
	 * `::image{…}` at the caret mid-sentence would publish the literal text of
	 * the directive instead of a photo. The padding is computed from what is
	 * actually either side of the caret so that inserting twice in a row does not
	 * pile up blank lines.
	 */
	function insertBlock(snippet: string): void {
		const input = carta.input;
		if (!input || disabled) return;

		// The caret is read NOW rather than when the toolbar button was pressed.
		// An upload takes seconds, the author can keep typing the whole time, and
		// an index captured beforehand would by then point into the middle of a
		// word they wrote while waiting.
		const position = input.getSelection().end;
		const before = input.textarea.value.slice(0, position);
		const after = input.textarea.value.slice(position);

		const lead =
			before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
		const trail =
			after === '' ? '\n' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';

		input.insertAt(position, `${lead}${snippet}${trail}`);

		// `insertAt` writes `textarea.value` straight through, which fires no
		// input event, so Svelte's binding has not heard about any of this yet.
		// `update()` is what tells Carta to read the textarea back out into the
		// bound value; without it the author sees their line and the parent still
		// holds the old markdown — and the next keystroke would overwrite it.
		const caret = position + lead.length + snippet.length;
		input.textarea.setSelectionRange(caret, caret);
		input.update();
		input.textarea.focus();
	}

	/**
	 * ONLY THE STORAGE ID EVER GOES INTO THE BODY, NEVER A RESOLVED URL.
	 *
	 * A Convex storage URL cannot be revoked once it has been handed out, so a
	 * URL written into a saved body is permanent: it would outlive unpublishing
	 * the post, deleting the photo, and the org changing its mind about showing
	 * someone's face. The id is an indirection the org keeps hold of —
	 * `renderRichText` resolves it at render time against a map its caller
	 * assembled, and an id with no entry in that map renders as nothing at all.
	 * That is the difference between a photo an org can take back and one it
	 * cannot, which for people escaping forced labour is the whole point.
	 */
	function insertImage(storageId: string): void {
		// `alt` is written empty rather than left out so the attribute is visible
		// in the source and an author who cares can fill it in. Omitting it would
		// make the accessible outcome the invisible one.
		insertBlock(`::image{id=${storageId} alt=""}`);
	}

	/**
	 * THE URL MUST BE QUOTED.
	 *
	 * An unquoted directive attribute value ends at the first `=`, so
	 * `::video{url=https://www.youtube.com/watch?v=abc}` parses as
	 * url="https://www.youtube.com/watch?v" — the remainder falls outside the
	 * attribute, remark stops recognising the line as a directive at all, and the
	 * author's markup is printed on the published page as raw text. Nearly every
	 * YouTube link anyone will ever paste contains a `=`. The quotes are not a
	 * style choice, they are the difference between a video and a visible
	 * mistake, and `$lib/domain/rich-text.ts` says the same thing from the far
	 * end of the pipe.
	 */
	function insertVideo(url: string): void {
		// A quoted value ends at the closing quote, so a `"` inside the URL would
		// break back out of the attribute. Percent-encoding it is valid in a URL
		// and keeps the directive one directive.
		insertBlock(`::video{url="${url.replaceAll('"', '%22')}"}`);
	}

	/**
	 * Opens the OS file picker.
	 *
	 * Called straight out of the toolbar button's click handler, so the click is
	 * still the user gesture browsers require before they will show a file
	 * dialog. Anything asynchronous in between — a permission check, a fetch —
	 * would spend that gesture and get the dialog silently blocked.
	 */
	function openImagePicker(): void {
		if (disabled || uploading) return;
		fileInput?.click();
	}

	async function handleFileChosen(event: Event): Promise<void> {
		const target = event.currentTarget as HTMLInputElement;
		const file = target.files?.item(0) ?? null;
		// Cleared before anything can fail, so picking the same file again after a
		// failed upload still fires a change event and still retries.
		target.value = '';
		if (!file) return;

		if (file.size > MAX_IMAGE_BYTES) {
			toast.error(m.updates_imageTooLarge());
			return;
		}

		uploading = true;
		try {
			const storageId = (await onUploadImage(file)).trim();
			// An empty id is a failed upload wearing a resolved promise. Treated as
			// the failure it is rather than written into the body, where
			// `::image{id= alt=""}` would render as nothing and leave the author
			// with an invisible line to explain.
			if (storageId === '') throw new Error('No storage id was returned.');
			insertImage(storageId);
		} catch {
			// Nothing is inserted on failure, on purpose. A directive naming bytes
			// that were never stored renders as nothing on the page while looking
			// like a photo in the editor, which is the worst of both.
			toast.error(m.updates_uploadFailed());
		} finally {
			uploading = false;
		}
	}

	function openVideoDialog(): void {
		if (disabled) return;
		videoUrl = '';
		videoDialogOpen = true;
	}

	function confirmVideo(): void {
		const url = videoUrl.trim();
		if (url === '') return;
		videoDialogOpen = false;
		insertVideo(url);
	}
</script>

<!--
	Kept outside the editor wrapper below, which goes `inert` while disabled: an
	inert subtree cannot be interacted with, and a file input that cannot be
	clicked is a picker that never opens. Hidden rather than styled away because
	the toolbar button is the real control and a second, bare file input would be
	a second thing for a screen reader to announce.
-->
<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	class="hidden"
	tabindex="-1"
	aria-hidden="true"
	onchange={(event) => void handleFileChosen(event)}
/>

<!--
	`inert` rather than a class that only dims things. The textarea's own
	`disabled` stops typing, but Carta's toolbar buttons are ordinary buttons
	that edit the value directly, and they stay both clickable and reachable by
	keyboard — the toolbar implements arrow-key navigation. `inert` is the one
	attribute that takes the whole subtree out of pointer and keyboard reach at
	once, so a read-only editor is genuinely read-only instead of merely looking
	it.
-->
<div
	class="rich-text-editor"
	class:rich-text-editor--disabled={disabled}
	inert={disabled}
	aria-busy={uploading || undefined}
>
	<MarkdownEditor
		{carta}
		bind:value
		{placeholder}
		userLabels={labels}
		textarea={{ id, disabled }}
	/>
</div>

<Dialog.Root bind:open={videoDialogOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{m.updates_addVideo()}</Dialog.Title>
		</Dialog.Header>

		<div class="space-y-1.5">
			<Label for="{uid}-video-url">{m.updates_videoPrompt()}</Label>
			<!--
				Not validated here. `toVideoEmbed` in the domain layer already decides
				which hosts and protocols may become a frame, and a link it rejects
				renders as nothing rather than as something dangerous. A second rule
				in this dialog would be a second rule to keep in agreement with that
				one, and the first time they disagreed the looser of the two would be
				the one that mattered.
			-->
			<Input
				id="{uid}-video-url"
				type="url"
				inputmode="url"
				autocomplete="off"
				bind:value={videoUrl}
				placeholder="https://"
				onkeydown={(event: KeyboardEvent) => {
					if (event.key !== 'Enter') return;
					// The dialog holds one field, so Enter means "add this" — but it is
					// stopped first, because this markup can sit inside a caller's form
					// and Enter there would submit the record the author is still
					// editing.
					event.preventDefault();
					confirmVideo();
				}}
			/>
		</div>

		<Dialog.Footer>
			<Button variant="outline" onclick={() => (videoDialogOpen = false)}>
				{m.action_cancel()}
			</Button>
			<Button onclick={confirmVideo} disabled={videoUrl.trim() === ''}>
				{m.action_add()}
			</Button>
		</Dialog.Footer>

		<Dialog.CloseX />
	</Dialog.Content>
</Dialog.Root>

<style>
	/*
		Carta's default theme is driven by six custom properties, so matching this
		app is a matter of redefining them rather than out-specifying its
		selectors. They inherit down into everything Carta renders, and because
		the app's tokens are themselves redefined under `.dark`, dark mode follows
		for free — Carta's own `--*-dark` properties are declared but never read
		by its stylesheet, so there is nothing there to fight.
	*/
	.rich-text-editor {
		--border-color: var(--border);
		--hover-color: var(--accent);
		--caret-color: var(--foreground);
		--text-color: var(--foreground);
		--focus-outline: var(--ring);
		--selection-color: color-mix(in oklab, var(--primary) 25%, transparent);
	}

	/* Squares the frame up with the Input primitive, which every other field on
	   the same form is drawn from. */
	.rich-text-editor :global(.carta-editor) {
		border-radius: var(--radius-md);
	}

	/* The focus ring the rest of the app uses. Carta puts focus on the textarea,
	   which is invisible under the highlight overlay, so the ring has to be drawn
	   on the frame instead of on the focused element. */
	.rich-text-editor :global(.carta-editor:focus-within) {
		border-color: var(--ring);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent);
	}

	/* Carta hard-codes 600px, which is taller than most screens once a page
	   header and a save bar are accounted for. A fixed height rather than one
	   that grows with the text, because the preview sits beside the input in
	   split mode and two panes that resize each other jump under the cursor. */
	.rich-text-editor :global(.carta-input),
	.rich-text-editor :global(.carta-renderer) {
		height: 22rem;
	}

	.rich-text-editor :global(.carta-input-wrapper),
	.rich-text-editor :global(.carta-font-code) {
		font-family: var(--font-mono);
	}

	.rich-text-editor :global(.carta-input ::placeholder) {
		color: var(--muted-foreground);
	}

	/* Carta's toolbar buttons are unstyled `button` elements, so they inherit the
	   browser's outline. Matching the ring keeps a keyboard author inside one
	   visual language as they tab from the fields above into the toolbar. */
	.rich-text-editor :global(.carta-toolbar button:focus-visible) {
		outline: 2px solid var(--ring);
		outline-offset: -2px;
		border-radius: var(--radius-sm);
	}

	.rich-text-editor :global(.carta-icons-menu) {
		background: var(--popover);
		color: var(--popover-foreground);
		border-radius: var(--radius-md);
	}

	/* The disabled editor still has to be READ. Dimming it says "not now"; the
	   `inert` attribute on the same element is what actually enforces it. */
	.rich-text-editor--disabled {
		opacity: 0.6;
	}

	/*
		Enough rhythm for the preview pane to read as prose. Not `prose` from
		@tailwindcss/typography, which RichTextBody uses: Carta writes the
		preview's markup itself and there is no element here to hang that class
		on. This is a rough likeness of the published page, not a promise of one —
		the `::image` and `::video` directives are not in Carta's markdown
		pipeline, so they show as their source text here and only become a photo
		or a frame once `renderRichText` has seen them.
	*/
	.rich-text-editor :global(.carta-renderer h1),
	.rich-text-editor :global(.carta-renderer h2),
	.rich-text-editor :global(.carta-renderer h3) {
		font-weight: 600;
		line-height: 1.25;
		margin: 1.25em 0 0.5em;
	}

	.rich-text-editor :global(.carta-renderer h1) {
		font-size: 1.5rem;
	}

	.rich-text-editor :global(.carta-renderer h2) {
		font-size: 1.25rem;
	}

	.rich-text-editor :global(.carta-renderer p),
	.rich-text-editor :global(.carta-renderer ul),
	.rich-text-editor :global(.carta-renderer ol),
	.rich-text-editor :global(.carta-renderer blockquote) {
		margin: 0.75em 0;
		line-height: 1.65;
	}

	.rich-text-editor :global(.carta-renderer ul),
	.rich-text-editor :global(.carta-renderer ol) {
		padding-left: 1.5rem;
	}

	.rich-text-editor :global(.carta-renderer ul) {
		list-style: disc;
	}

	.rich-text-editor :global(.carta-renderer ol) {
		list-style: decimal;
	}

	.rich-text-editor :global(.carta-renderer blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 0.875rem;
		color: var(--muted-foreground);
	}

	.rich-text-editor :global(.carta-renderer a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.rich-text-editor :global(.carta-renderer pre),
	.rich-text-editor :global(.carta-renderer code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
	}

	.rich-text-editor :global(.carta-renderer pre) {
		background: var(--muted);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		padding: 0.75rem;
	}
</style>
