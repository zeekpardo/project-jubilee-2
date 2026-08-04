<script lang="ts">
	// ============================================================
	// Rich text editor — markdown in, markdown out, edited in place
	// ============================================================
	// A generic authoring control, and deliberately nothing more. It takes
	// markdown, hands markdown back, and knows nothing about what the prose is
	// for: the same component is meant to serve every long-form field this app
	// has today and every one it grows later. Everything specific to a feature —
	// which record is being edited, when it saves, where the bytes are put — is
	// the caller's, which is why the only hole punched through it is
	// `onUploadImage`.
	//
	// THERE IS NO WRITE/PREVIEW SPLIT. One surface, showing the shape the words
	// will have when a stranger reads them, because a split pane asks an author
	// to hold two representations in their head and trust that the right one is
	// what donors get. Blocks are inserted by typing `/`.
	//
	// Its output is markdown for `$lib/domain/rich-text.ts` and for nothing else.
	// Two platform directives extend what markdown can say, and the round trip
	// for both lives in `./platform-directives.ts`:
	//
	//   ::image{id=<storageId> alt=""}
	//   ::video{url="https://…"}
	//
	// WHAT IT DELIBERATELY DOES NOT DO:
	//
	//   - It does not sanitize. Nothing typed here ever reaches a reader from
	//     this component; the security boundary is `renderRichText`, and a
	//     second, weaker set of rules here would only give someone a reason to
	//     trust the wrong one.
	//   - It does not offer strikethrough, task lists or tables. That is why the
	//     commonmark preset is used alone and `@milkdown/preset-gfm` is not:
	//     `del`, checkboxes and `table` are absent from the renderer's allowed
	//     tag list, so those controls would produce markup that silently
	//     disappears the moment the post is published. A control that appears to
	//     work and does nothing is worse than an absent one.
	//   - It does not resolve a storage id to a URL ITSELF, and never writes one
	//     into the body. A caller may pass `resolveImageUrl` so that saved photos
	//     are drawn rather than stubbed, but that answer is display-only and dies
	//     with the component. See `insertImage` and `previewUrlFor`.
	//   - It does not judge a video URL. `toVideoEmbed` in the domain layer
	//     already owns that decision and is tested against `javascript:` and
	//     friends; a second opinion here would be a second thing to keep in
	//     agreement with it, and the disagreement is where the hole would be.
	//   - It does not save, validate or debounce. `value` is bindable and that
	//     is the whole contract.
	//
	// It also has no top-level side effects — nothing here touches `window` or
	// `document` at module scope — so a consumer can keep the editor's bytes off
	// a public page with `{#await import('$lib/features/rich-text/…')}`. Milkdown,
	// ProseMirror and this stylesheet are a large chunk that donors should never
	// have to download. Adding module-scope work would quietly take that option
	// away.
	// ============================================================

	import {
		Editor,
		defaultValueCtx,
		editorViewCtx,
		editorViewOptionsCtx,
		rootCtx,
		remarkStringifyOptionsCtx
	} from '@milkdown/kit/core';
	import {
		commonmark,
		createCodeBlockCommand,
		wrapInBlockquoteCommand,
		wrapInBulletListCommand,
		wrapInHeadingCommand,
		wrapInOrderedListCommand
	} from '@milkdown/kit/preset/commonmark';
	import { clipboard } from '@milkdown/kit/plugin/clipboard';
	import { cursor } from '@milkdown/kit/plugin/cursor';
	import { history } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { trailing } from '@milkdown/kit/plugin/trailing';
	import { SlashProvider, slashFactory } from '@milkdown/kit/plugin/slash';
	// `$prose` cannot be imported here — Svelte reserves the `$` prefix — which
	// is why the placeholder lives in its own module.
	import { callCommand, replaceAll } from '@milkdown/kit/utils';
	import { TextSelection } from '@milkdown/kit/prose/state';
	import type { EditorState } from '@milkdown/kit/prose/state';
	import type { EditorView } from '@milkdown/kit/prose/view';
	import type { CmdKey } from '@milkdown/kit/core';
	// ProseMirror's own stylesheet. Imported rather than reimplemented, and as a
	// module import it travels inside whichever chunk imports this component, so
	// it stays lazy along with everything else here.
	import '@milkdown/kit/prose/view/style/prosemirror.css';
	import '@milkdown/kit/prose/gapcursor/style/gapcursor.css';

	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import CodeIcon from '@lucide/svelte/icons/code';
	import Heading1Icon from '@lucide/svelte/icons/heading-1';
	import Heading2Icon from '@lucide/svelte/icons/heading-2';
	import Heading3Icon from '@lucide/svelte/icons/heading-3';
	import ImageIcon from '@lucide/svelte/icons/image';
	import ListIcon from '@lucide/svelte/icons/list';
	import ListOrderedIcon from '@lucide/svelte/icons/list-ordered';
	import QuoteIcon from '@lucide/svelte/icons/quote';
	import VideoIcon from '@lucide/svelte/icons/video';

	import { Button } from '$lib/primitives/ui/button';
	import * as Dialog from '$lib/primitives/ui/dialog';
	import { Input } from '$lib/primitives/ui/input';
	import { Label } from '$lib/primitives/ui/label';
	import * as m from '$lib/i18n/messages';

	import { PLATFORM_IMAGE, PLATFORM_VIDEO, platformDirectivePlugins } from './platform-directives';
	import { placeholderPlugin } from './placeholder';
	import { filterSlashItems, matchSlashQuery } from './slash-query';

	let {
		value = $bindable(''),
		onUploadImage,
		resolveImageUrl,
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
		/**
		 * Turns a storage id from an already-saved body back into a URL, so an
		 * author editing an old post sees the photographs rather than a row of
		 * placeholder cards.
		 *
		 * Optional, and absent by default: a caller that has not got the URLs to
		 * hand keeps working and keeps showing cards. What it returns is used for
		 * display and NOTHING ELSE — see `previewUrlFor` below, and the note on
		 * `ImageUrlResolver`, for why a resolved URL must never reach the body.
		 *
		 * It is consulted while a node renders, which in practice means while the
		 * editor is being created. A resolver that only starts answering later
		 * will not turn cards that have already been drawn into photographs.
		 */
		resolveImageUrl?: (storageId: string) => string | undefined;
		disabled?: boolean;
		placeholder?: string;
		/** Put on the editing surface, so a caller's `<Label for>` points at it. */
		id?: string;
	} = $props();

	// Ten megabytes, checked in the browser. The server has to enforce its own
	// limit regardless — a cap a client applies is a courtesy, not a control —
	// but the courtesy is worth having: it fails in a tenth of a second instead
	// of after a phone has spent two minutes pushing a 40 MB photo over 4G.
	const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

	// Scopes the dialog's field id to this instance, so two editors on one page
	// do not both claim the same `for`/`id` pair.
	const uid = $props.id();

	let hostEl = $state<HTMLElement | null>(null);
	let slashMenuEl = $state<HTMLElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let editor = $state<Editor | null>(null);
	let uploading = $state(false);
	let videoDialogOpen = $state(false);
	let videoUrl = $state('');
	let slashQuery = $state('');
	let slashOpen = $state(false);
	let activeIndex = $state(0);

	/**
	 * Blob URLs for photos uploaded during this sitting, so the author sees the
	 * picture they just chose rather than a grey box.
	 *
	 * Per instance and revoked on teardown. NOTHING IN HERE REACHES THE SAVED
	 * BODY — see `platform-directives.ts`, where the serializer reads only the
	 * node's `id` attribute.
	 *
	 * A plain Map rather than a SvelteMap, which is what the lint rule below is
	 * asking for. Nothing in the Svelte template ever reads this: its only
	 * consumer is the node spec's `toDOM`, which ProseMirror calls while
	 * rendering its own DOM, outside Svelte's reactive graph entirely. Making it
	 * reactive would create signals nobody subscribes to, and would invite the
	 * belief that writing to it redraws something — which it does not. The
	 * redraw comes from the transaction that inserts the node, and the entry is
	 * always written before that transaction is dispatched.
	 */
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const previewUrls = new Map<string, string>();

	/**
	 * The one resolver the node spec sees, from the two sources this component
	 * has.
	 *
	 * The session blob wins. A photo uploaded a moment ago is bytes the browser
	 * already holds, whereas the caller's resolver is answering from a query that
	 * was loaded before the upload happened and so cannot know about it yet.
	 * Asking the caller first would draw a card over a photo the author is
	 * looking at.
	 */
	function previewUrlFor(storageId: string): string | undefined {
		return previewUrls.get(storageId) ?? resolveImageUrl?.(storageId);
	}

	/**
	 * The markdown this component last handed the parent.
	 *
	 * The editor writes on every keystroke and the parent writes back, so without
	 * a record of what we just emitted the echo looks like an outside edit and
	 * reloads the document underneath the author — losing the caret, the undo
	 * stack, and whatever they typed in between.
	 */
	let lastEmitted = $state('');

	type SlashItem = {
		id: string;
		label: string;
		keywords: string[];
		icon: typeof ImageIcon;
		run: () => void;
	};

	const slashItems = $derived<SlashItem[]>([
		{
			id: 'h1',
			label: `${m.richText_heading()} 1`,
			keywords: ['h1', 'title', '#'],
			icon: Heading1Icon,
			run: () => runCommand(wrapInHeadingCommand.key, 1)
		},
		{
			id: 'h2',
			label: `${m.richText_heading()} 2`,
			keywords: ['h2', '##'],
			icon: Heading2Icon,
			run: () => runCommand(wrapInHeadingCommand.key, 2)
		},
		{
			id: 'h3',
			label: `${m.richText_heading()} 3`,
			keywords: ['h3', '###'],
			icon: Heading3Icon,
			run: () => runCommand(wrapInHeadingCommand.key, 3)
		},
		{
			id: 'bulletList',
			label: m.richText_bulletList(),
			keywords: ['bullet', 'unordered', '-'],
			icon: ListIcon,
			run: () => runCommand(wrapInBulletListCommand.key)
		},
		{
			id: 'orderedList',
			label: m.richText_numberedList(),
			keywords: ['ordered', 'number', '1.'],
			icon: ListOrderedIcon,
			run: () => runCommand(wrapInOrderedListCommand.key)
		},
		{
			id: 'blockquote',
			label: m.richText_quote(),
			keywords: ['blockquote', '>'],
			icon: QuoteIcon,
			run: () => runCommand(wrapInBlockquoteCommand.key)
		},
		{
			id: 'codeBlock',
			label: m.richText_code(),
			keywords: ['pre', 'snippet', '```'],
			icon: CodeIcon,
			run: () => runCommand(createCodeBlockCommand.key)
		},
		{
			id: 'image',
			label: m.updates_addImage(),
			keywords: ['photo', 'picture', 'img'],
			icon: ImageIcon,
			run: () => openImagePicker()
		},
		{
			id: 'video',
			label: m.updates_addVideo(),
			keywords: ['youtube', 'vimeo', 'embed'],
			icon: VideoIcon,
			run: () => openVideoDialog()
		}
	]);

	const visibleItems = $derived(filterSlashItems(slashItems, slashQuery));

	// The highlighted row must exist. Filtering can shorten the list under a
	// selection that was valid a keystroke ago, and an index past the end means
	// Enter silently does nothing.
	const safeIndex = $derived(
		visibleItems.length === 0 ? 0 : Math.min(activeIndex, visibleItems.length - 1)
	);

	function withView<T>(fn: (view: EditorView) => T): T | undefined {
		const current = editor;
		if (!current) return undefined;
		return fn(current.ctx.get(editorViewCtx));
	}

	/**
	 * The paragraph text to the left of the caret, or null when a slash there
	 * could not mean "insert a block".
	 *
	 * Written out rather than using `SlashProvider.getContent`, because that
	 * method lives on the provider and the provider needs this answer to decide
	 * whether to exist — asking it would be a circular reference. Doing it here
	 * also makes the conditions legible: a collapsed text caret, inside a
	 * paragraph, in a focused editor.
	 *
	 * Paragraph only, so `/` inside a code block stays a slash. Code is exactly
	 * where someone types paths, and a menu opening over `/usr/bin` would be
	 * both wrong and hard to dismiss.
	 */
	function textBeforeCaret(view: EditorView): string | null {
		if (!view.hasFocus() || !view.editable) return null;

		const { selection } = view.state;
		if (!(selection instanceof TextSelection) || !selection.empty) return null;

		// Read off the selection rather than destructured, because Svelte reserves
		// the `$` prefix and refuses to compile a variable named `$from`.
		const head = selection.$from;
		if (head.parent.type.name !== 'paragraph') return null;

		// `￼` is the object-replacement character, standing in for any inline
		// node so that its absence cannot join two words into a false match.
		return head.parent.textBetween(0, head.parentOffset, undefined, '￼');
	}

	/**
	 * Removes the `/query` the author typed, then runs the block's own action.
	 *
	 * The text goes first and unconditionally. If it were left to each action to
	 * clean up, the two that finish asynchronously — a photo upload, the video
	 * dialog — would leave `/photo` sitting in the paragraph for as long as the
	 * network took, and an author who kept typing would find it welded into their
	 * sentence.
	 */
	function consumeSlashQuery(): void {
		withView((view) => {
			const { state, dispatch } = view;
			const from = state.selection.$from.pos - (slashQuery.length + 1);
			if (from < 0) return;
			dispatch(state.tr.delete(from, state.selection.$from.pos));
		});
		closeSlash();
	}

	function runItem(item: SlashItem): void {
		if (disabled) return;
		consumeSlashQuery();
		item.run();
	}

	function runCommand<T>(key: CmdKey<T>, payload?: T): void {
		editor?.action(callCommand(key, payload));
		withView((view) => view.focus());
	}

	function closeSlash(): void {
		slashOpen = false;
		slashQuery = '';
		activeIndex = 0;
	}

	/**
	 * Inserts a platform block at the caret.
	 *
	 * `replaceSelectionWith` rather than a raw insert, so an empty paragraph the
	 * author was sitting in is consumed instead of being left above the block as
	 * a stray blank line that they then have to notice and delete.
	 */
	function insertPlatformBlock(nodeName: string, attrs: Record<string, string>): void {
		withView((view) => {
			const type = view.state.schema.nodes[nodeName];
			if (!type) return;
			view.dispatch(view.state.tr.replaceSelectionWith(type.create(attrs)));
			view.focus();
		});
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
	 *
	 * The blob URL registered alongside it is a local preview and is not the same
	 * kind of thing: it dies with the tab and is never serialized.
	 */
	function insertImage(storageId: string, file: File): void {
		previewUrls.set(storageId, URL.createObjectURL(file));
		// `alt` starts empty rather than absent so the attribute is visible in the
		// saved source and an author who cares can fill it in.
		insertPlatformBlock(PLATFORM_IMAGE, { id: storageId, alt: '' });
	}

	/**
	 * THE URL IS STORED AS AN ATTRIBUTE AND QUOTED WHEN IT IS SERIALIZED.
	 *
	 * An unquoted directive attribute value ends at the first `=`, so
	 * `::video{url=https://www.youtube.com/watch?v=abc}` parses as
	 * url="https://www.youtube.com/watch?v" — the remainder falls outside the
	 * attribute, remark stops recognising the line as a directive at all, and the
	 * author's markup is printed on the published page as raw text. Nearly every
	 * YouTube link anyone will ever paste contains a `=`. The quoting is enforced
	 * in `platform-directives.ts`, which turns `preferUnquoted` off so that no
	 * attribute can ever be emitted bare.
	 */
	function insertVideo(url: string): void {
		insertPlatformBlock(PLATFORM_VIDEO, { url });
	}

	/**
	 * Opens the OS file picker.
	 *
	 * Called straight out of the menu row's click handler, so the click is still
	 * the user gesture browsers require before they will show a file dialog.
	 * Anything asynchronous in between — a permission check, a fetch — would
	 * spend that gesture and get the dialog silently blocked.
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
			insertImage(storageId, file);
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

	const slash = slashFactory('platformSlash');

	async function createEditor(host: HTMLElement, menu: HTMLElement, initial: string) {
		return Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, host);
				ctx.set(defaultValueCtx, initial);

				// Pinned to the conventions already in the database. The previous
				// editor's list button wrote `- `, and `---` is the rule everyone
				// types; remark-stringify defaults to `*` for both, which would
				// rewrite every list and divider in every stored body the first
				// time somebody opened an old post and saved it.
				ctx.set(remarkStringifyOptionsCtx, { bullet: '-', rule: '-', ruleRepetition: 3 });

				ctx.update(editorViewOptionsCtx, (prev) => ({
					...prev,
					attributes: {
						class: 'rich-text-surface',
						...(id ? { id } : {})
					},
					editable: () => !disabled
				}));

				ctx.set(slash.key, {
					view: () => {
						const provider = new SlashProvider({
							content: menu,
							// The default 200ms is tuned for a tooltip that follows a
							// mouse. Here it is the gap between pressing `/` and the
							// menu appearing, and at 200ms it reads as a stutter.
							debounce: 20,
							shouldShow: (view: EditorView) => {
								const text = textBeforeCaret(view);
								const query = text === null ? null : matchSlashQuery(text);
								if (query === null) {
									closeSlash();
									return false;
								}
								slashQuery = query;
								slashOpen = true;
								// An empty result set means the author has typed past
								// anything on offer, so the menu gets out of the way
								// rather than hovering there empty.
								return filterSlashItems(slashItems, query).length > 0;
							}
						});
						provider.onHide = () => closeSlash();
						return {
							update: (view: EditorView, prevState?: EditorState) =>
								provider.update(view, prevState),
							destroy: () => provider.destroy()
						};
					},
					props: {
						// Intercepted here rather than on the menu element because
						// focus never leaves the document while the menu is open —
						// the author is still typing, so these keys arrive at
						// ProseMirror, and returning true is what stops Enter from
						// splitting the paragraph behind the menu.
						handleKeyDown: (_view: EditorView, event: KeyboardEvent) => {
							if (!slashOpen || visibleItems.length === 0) return false;

							if (event.key === 'ArrowDown') {
								activeIndex = (safeIndex + 1) % visibleItems.length;
								return true;
							}
							if (event.key === 'ArrowUp') {
								activeIndex = (safeIndex - 1 + visibleItems.length) % visibleItems.length;
								return true;
							}
							if (event.key === 'Enter' || event.key === 'Tab') {
								const item = visibleItems[safeIndex];
								if (!item) return false;
								runItem(item);
								return true;
							}
							if (event.key === 'Escape') {
								closeSlash();
								return true;
							}
							return false;
						}
					}
				});

				ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
					lastEmitted = markdown;
					value = markdown;
				});
			})
			.use(commonmark)
			.use(listener)
			.use(history)
			.use(clipboard)
			.use(cursor)
			.use(trailing)
			.use(slash)
			.use(placeholderPlugin(() => placeholder))
			.use(platformDirectivePlugins(previewUrlFor))
			.create();
	}

	$effect(() => {
		const host = hostEl;
		const menu = slashMenuEl;
		if (!host || !menu) return;

		let disposed = false;
		let created: Editor | null = null;

		// UNTRACKED, and the editor is unusable without it. `value` is bindable and
		// this component writes to it on every keystroke, so reading it here as a
		// dependency makes each character tear the editor down and build a new one:
		// the caret goes, the dialog falls back to focusing its first field, and
		// typing in the body lands in the title. The document is seeded once, on
		// mount; the effect below is what carries later changes in from outside.
		const initial = untrack(() => value);
		lastEmitted = initial;

		// Creation is untracked wholesale, not just `value`. `createEditor` also
		// reads `id` and `disabled` while configuring, and a caller passing an
		// inline arrow for `resolveImageUrl` hands this a new function identity on
		// every parent render. Any of those becoming a dependency puts the editor
		// back on the teardown-and-rebuild treadmill this effect must never be on.
		// The only things it may react to are the two DOM nodes read above.
		void untrack(() => createEditor(host, menu, initial)).then((made) => {
			if (disposed) {
				void made.destroy();
				return;
			}
			created = made;
			editor = made;
		});

		return () => {
			disposed = true;
			editor = null;
			void created?.destroy();
			// The blobs are this tab's copies of photos that already live on the
			// server. Holding them past the editor's life is a leak with no upside.
			for (const url of previewUrls.values()) URL.revokeObjectURL(url);
			previewUrls.clear();
		};
	});

	// Reloads the document only when the change came from outside. `lastEmitted`
	// is what this component just handed up, so the parent echoing it back is not
	// an edit and must not cost the author their caret or their undo history.
	$effect(() => {
		const next = value;
		if (!editor || next === lastEmitted) return;
		lastEmitted = next;
		editor.action(replaceAll(next));
	});

	// ProseMirror asks `editable` once per state update and caches the answer, so
	// flipping the prop is not enough on its own — the view has to be told that
	// the question is worth asking again. Without this a dialog that loses write
	// permission mid-edit stays typable.
	$effect(() => {
		const readOnly = disabled;
		withView((view) => view.setProps({ editable: () => !readOnly }));
	});
</script>

<!--
	Kept outside the editor wrapper below, which goes `inert` while disabled: an
	inert subtree cannot be interacted with, and a file input that cannot be
	clicked is a picker that never opens. Hidden rather than styled away because
	the menu row is the real control and a second, bare file input would be a
	second thing for a screen reader to announce.
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
	`inert` rather than a class that only dims things. ProseMirror's own
	`editable` stops typing, but the slash menu is made of ordinary buttons that
	edit the document directly and would stay both clickable and reachable by
	keyboard. `inert` is the one attribute that takes the whole subtree out of
	pointer and keyboard reach at once, so a read-only editor is genuinely
	read-only instead of merely looking it.
-->
<div
	class="rich-text-editor"
	class:rich-text-editor--disabled={disabled}
	inert={disabled}
	aria-busy={uploading || undefined}
>
	<div class="rich-text-host" bind:this={hostEl}></div>
</div>

<!--
	Owned by Svelte but re-parented by SlashProvider, which appends it next to
	the editing surface and sets `left`/`top` on it. It lives outside the wrapper
	above so that the provider's move does not fight the wrapper's layout, and it
	is always in the DOM because the provider needs a stable element to position.
	`data-show` is the provider's own switch; the stylesheet keys off it.

	The name is the generic "Add" rather than something exact. It named the whole
	menu "Add photo" before, which is a lie to anyone hearing it read out; a key
	of its own — `richText_blockMenu`, say — is what this really wants.
-->
<div
	bind:this={slashMenuEl}
	class="rich-text-slash"
	role="listbox"
	tabindex="-1"
	aria-label={m.richText_blockMenu()}
>
	{#each visibleItems as item, index (item.id)}
		{@const Icon = item.icon}
		<button
			type="button"
			class="rich-text-slash__item"
			class:rich-text-slash__item--active={index === safeIndex}
			role="option"
			aria-selected={index === safeIndex}
			onmouseenter={() => (activeIndex = index)}
			onmousedown={(event) => {
				// The document keeps focus so that `consumeSlashQuery` still has a
				// selection to work from; a mousedown that blurred the editor would
				// leave the `/query` behind and insert the block nowhere.
				event.preventDefault();
				runItem(item);
			}}
		>
			<Icon class="size-4 shrink-0" aria-hidden="true" />
			<span>{item.label}</span>
		</button>
	{/each}
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
		The frame, drawn to match the Input primitive that every other field on the
		same form comes from.
	*/
	.rich-text-editor {
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--background);
		position: relative;
	}

	.rich-text-editor:focus-within {
		border-color: var(--ring);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--ring) 50%, transparent);
	}

	/* The disabled editor still has to be READ. Dimming it says "not now"; the
	   `inert` attribute on the same element is what actually enforces it. */
	.rich-text-editor--disabled {
		opacity: 0.6;
	}

	/*
		A fixed height rather than one that grows with the text. The dialog this
		sits in is already tall, and a box that resizes under the caret as
		paragraphs wrap makes the page jump while somebody is mid-sentence.
	*/
	.rich-text-host {
		height: 22rem;
		overflow-y: auto;
	}

	.rich-text-editor :global(.rich-text-surface) {
		padding: 0.75rem 0.875rem;
		min-height: 100%;
		outline: none;
		color: var(--foreground);
		caret-color: var(--foreground);
	}

	.rich-text-editor :global(.rich-text-surface ::selection) {
		background: color-mix(in oklab, var(--primary) 25%, transparent);
	}

	/*
		THE POINT OF THE WHOLE COMPONENT. These rules are a likeness of the
		published page, so that what an author sees while typing is the shape a
		donor will read. They are deliberately close to RichTextBody's `prose`
		output rather than to any editor chrome.
	*/
	.rich-text-editor :global(.rich-text-surface h1),
	.rich-text-editor :global(.rich-text-surface h2),
	.rich-text-editor :global(.rich-text-surface h3),
	.rich-text-editor :global(.rich-text-surface h4),
	.rich-text-editor :global(.rich-text-surface h5),
	.rich-text-editor :global(.rich-text-surface h6) {
		font-weight: 600;
		line-height: 1.25;
		margin: 1.25em 0 0.5em;
	}

	.rich-text-editor :global(.rich-text-surface h1) {
		font-size: 1.5rem;
	}

	.rich-text-editor :global(.rich-text-surface h2) {
		font-size: 1.25rem;
	}

	.rich-text-editor :global(.rich-text-surface h3) {
		font-size: 1.125rem;
	}

	.rich-text-editor :global(.rich-text-surface p),
	.rich-text-editor :global(.rich-text-surface ul),
	.rich-text-editor :global(.rich-text-surface ol),
	.rich-text-editor :global(.rich-text-surface blockquote) {
		margin: 0.75em 0;
		line-height: 1.65;
	}

	.rich-text-editor :global(.rich-text-surface ul),
	.rich-text-editor :global(.rich-text-surface ol) {
		padding-left: 1.5rem;
	}

	.rich-text-editor :global(.rich-text-surface ul) {
		list-style: disc;
	}

	.rich-text-editor :global(.rich-text-surface ol) {
		list-style: decimal;
	}

	.rich-text-editor :global(.rich-text-surface blockquote) {
		border-left: 3px solid var(--border);
		padding-left: 0.875rem;
		color: var(--muted-foreground);
	}

	.rich-text-editor :global(.rich-text-surface a) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.rich-text-editor :global(.rich-text-surface code) {
		font-family: var(--font-mono);
		font-size: 0.875em;
	}

	.rich-text-editor :global(.rich-text-surface pre) {
		background: var(--muted);
		border-radius: var(--radius-sm);
		overflow-x: auto;
		padding: 0.75rem;
		font-family: var(--font-mono);
		font-size: 0.875em;
	}

	.rich-text-editor :global(.rich-text-surface hr) {
		border: 0;
		border-top: 1px solid var(--border);
		margin: 1.5em 0;
	}

	/* The placeholder, hung off the decoration the plugin above attaches. */
	.rich-text-editor :global(.rich-text-surface .rich-text-empty::before) {
		content: attr(data-placeholder);
		color: var(--muted-foreground);
		pointer-events: none;
		float: left;
		height: 0;
	}

	/*
		A photo or a video as a block. The selected state matters more here than
		it does for text: these are atoms, so clicking one selects the whole thing
		and the only feedback that it is about to be deleted is this ring.
	*/
	.rich-text-editor :global(.rich-text-block) {
		margin: 1em 0;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--muted);
		overflow: hidden;
	}

	.rich-text-editor :global(.rich-text-block.ProseMirror-selectednode) {
		outline: 2px solid var(--ring);
		outline-offset: 1px;
	}

	.rich-text-editor :global(.rich-text-block__image) {
		display: block;
		width: 100%;
		max-height: 18rem;
		object-fit: contain;
	}

	.rich-text-editor :global(.rich-text-block__label) {
		display: block;
		padding: 0.75rem 0.875rem;
		font-size: 0.8125rem;
		color: var(--muted-foreground);
		overflow-wrap: anywhere;
	}

	/*
		The slash menu. Positioned by floating-ui through SlashProvider, which
		writes `left`/`top` and toggles `data-show`, so this rule set owns
		everything except where it sits.
	*/
	.rich-text-slash {
		position: absolute;
		z-index: 50;
		display: none;
		width: 15rem;
		max-height: 17rem;
		overflow-y: auto;
		padding: 0.25rem;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--popover);
		color: var(--popover-foreground);
		box-shadow: 0 10px 24px -8px color-mix(in oklab, var(--foreground) 25%, transparent);
	}

	.rich-text-slash:global([data-show='true']) {
		display: block;
	}

	.rich-text-slash__item {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		width: 100%;
		padding: 0.4375rem 0.5rem;
		border-radius: var(--radius-sm);
		font-size: 0.875rem;
		text-align: left;
		cursor: pointer;
	}

	.rich-text-slash__item--active {
		background: var(--accent);
		color: var(--accent-foreground);
	}
</style>
