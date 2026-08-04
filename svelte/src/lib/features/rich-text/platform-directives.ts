// ============================================================
// The two platform directives, as Milkdown understands them
// ============================================================
// `$lib/domain/rich-text.ts` extends markdown with exactly two leaf directives,
// and this module is the editor-side half of that agreement:
//
//   ::image{id=<storageId> alt="..."}
//   ::video{url="https://..."}
//
// Milkdown is remark-based, but remark alone is not enough. Its parser walks the
// mdast tree looking for a ProseMirror node that claims each mdast node, and a
// directive nobody claims raises `parserMatchError` — which means the editor
// refuses to open the post at all. So the syntax plugin and the two node specs
// below have to ship together; either one without the other is a broken editor.
//
// WHAT IT DELIBERATELY DOES NOT DO:
//
//   - It does not sanitize, resolve, or judge anything. A storage id is copied
//     through as a string and a video URL is never parsed; `renderRichText` and
//     `toVideoEmbed` own those decisions, and a second opinion here would be a
//     second thing to keep in agreement with them.
//   - It does not resolve a storage id to a URL. The markdown must carry the id
//     and only the id — see `ImageUrlResolver` below for why the thumbnail an
//     author sees never touches the serialized output.
//   - It has no Svelte, no top-level side effects and no DOM access at module
//     scope, so the whole editor stays behind a dynamic import.
//
// THE POINT OF THIS MODULE IS THAT BYTES SURVIVE. A body written years ago must
// come back out of the editor meaning exactly what it meant going in, so the
// serializer options below are pinned rather than left at their defaults.
// ============================================================

import { directiveFromMarkdown, directiveToMarkdown } from 'mdast-util-directive';
import { directive } from 'micromark-extension-directive';
import { $node, $remark } from '@milkdown/kit/utils';
import type { Node as ProseNode, NodeType } from '@milkdown/kit/prose/model';
import type { MarkdownNode, ParserState, SerializerState } from '@milkdown/kit/transformer';

/** The ProseMirror node names, used by the slash commands and the stylesheet. */
export const PLATFORM_IMAGE = 'platformImage';
export const PLATFORM_VIDEO = 'platformVideo';

/** The directive names, which are what actually appears in the markdown. */
const IMAGE_DIRECTIVE = 'image';
const VIDEO_DIRECTIVE = 'video';

/**
 * The minimum shape needed from an mdast node. Declared locally rather than
 * imported from `mdast-util-directive` for the same reason `rich-text.ts`
 * declares its own: importing a transitive package's types couples this file to
 * the resolution of something it never chose to install.
 */
interface DirectiveNode {
	type: string;
	name?: string;
	attributes?: Record<string, string | null | undefined> | null;
	children?: DirectiveNode[];
}

/**
 * Reads one attribute as a plain string. Missing and null both become ''.
 *
 * Attributes are read one at a time and never spread, the same allowlist
 * discipline `rich-text.ts` uses: the directive syntax also turns `#foo` and
 * `.foo` into `id` and `className`, and naming what we want means a stray
 * `.class` in an old body cannot ride along into a node attribute.
 */
function attr(node: MarkdownNode, name: string): string {
	const attributes = (node as DirectiveNode).attributes;
	const value = attributes?.[name];
	return typeof value === 'string' ? value : '';
}

function isPlatformDirective(node: DirectiveNode): boolean {
	return (
		node.type === 'leafDirective' &&
		(node.name === IMAGE_DIRECTIVE || node.name === VIDEO_DIRECTIVE)
	);
}

/**
 * Deletes every directive this platform does not understand, before the
 * ProseMirror parser can trip over it.
 *
 * This mirrors `remarkPlatformDirectives` in the domain module, which splices
 * unrecognised directives out of the tree so a typo like `::imge{...}` publishes
 * as nothing. Doing the same here is what makes editor and renderer agree by
 * construction: a directive that would be invisible to a reader is invisible to
 * the author too, rather than being a node the editor cannot represent.
 *
 * Without this the failure is not cosmetic. An unclaimed directive raises
 * `parserMatchError` inside Milkdown's parser, and the result is an editor that
 * throws on open — the author cannot fix the typo because they cannot get at it.
 */
function stripUnsupportedDirectives() {
	return (tree: DirectiveNode): void => {
		const walk = (node: DirectiveNode): void => {
			if (!node.children) return;
			node.children = node.children.filter(
				(child) => !child.type.endsWith('Directive') || isPlatformDirective(child)
			);
			node.children.forEach(walk);
		};
		walk(tree);
	};
}

/**
 * remark-directive, but with its serializer pinned.
 *
 * The published `remark-directive` hardcodes `directiveToMarkdown()`, and its
 * defaults do two things this platform cannot accept:
 *
 *   - `preferShortcut` rewrites `id=abc` to the `#abc` shorthand.
 *   - `collapseEmptyAttributes` rewrites `alt=""` to a bare `alt`.
 *
 * Both re-parse to the same tree, so nothing would visibly break — they would
 * simply rewrite the bytes of every stored body the first time an admin opened
 * an old post and pressed save. Pinning the options keeps a save that changed
 * nothing looking like a save that changed nothing.
 *
 * QUOTING IS ALWAYS ON, and that is the load-bearing one. `preferUnquoted` is
 * left off so every attribute value is emitted between double quotes. An
 * unquoted directive value ends at the first `=`, so an unquoted
 * `url=https://www.youtube.com/watch?v=abc` stops being a directive and prints
 * on the published page as raw text — the exact failure `rich-text.ts` warns
 * about from the far end of the pipe. Quoting unconditionally means no video URL
 * can ever reach that state, whatever it contains.
 */
function platformDirectiveSyntax(this: {
	data: () => {
		micromarkExtensions?: unknown[];
		fromMarkdownExtensions?: unknown[];
		toMarkdownExtensions?: unknown[];
	};
}) {
	const data = this.data();
	(data.micromarkExtensions ??= []).push(directive());
	(data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
	(data.toMarkdownExtensions ??= []).push(
		directiveToMarkdown({
			preferShortcut: false,
			collapseEmptyAttributes: false,
			quote: '"'
		})
	);

	return stripUnsupportedDirectives();
}

export const platformDirectiveRemarkPlugin = $remark(
	'platformDirectives',
	() => platformDirectiveSyntax
);

/**
 * Storage id → a URL that is only ever used to draw a thumbnail on screen.
 *
 * A URL enters this editor from two places that must never be confused with the
 * document: a `blob:` for a photo uploaded during this sitting, and whatever the
 * caller's optional `resolveImageUrl` hands back for a photo saved earlier. The
 * component composes both into one function before passing it here, so this
 * module never learns there were two.
 *
 * NOTHING THIS RETURNS CAN REACH THE SAVED BODY. It is read by `toDOM` and by
 * nothing else; both `toMarkdown` runners below read the node's `id` attribute
 * and never consult this. That separation is the whole reason a resolved URL is
 * safe to hold at all — a Convex storage URL cannot be revoked once handed out,
 * so one written into a body would outlive unpublishing the post and deleting
 * the photo, while an id resolves to nothing the moment the org withdraws it.
 *
 * Returning undefined is an ordinary answer, not an error: it means "draw the
 * card instead", which is what a post whose photos have not been resolved gets.
 *
 * IT IS READ WHEN A NODE IS RENDERED. ProseMirror does not re-render a node
 * whose attributes have not changed, so a resolver that starts answering only
 * after the editor has mounted will not retroactively turn cards into
 * photographs. Callers must be able to answer by the time the editor is created
 * — which is the normal case, since the row carrying the body carries the URLs.
 */
export type ImageUrlResolver = (storageId: string) => string | undefined;

/**
 * `::image{id=... alt="..."}` as a ProseMirror node.
 *
 * An atom: it has no editable content, so a caret cannot get inside it and an
 * author cannot half-delete the directive into something that no longer parses.
 */
function imageNode(resolveUrl: ImageUrlResolver) {
	return $node(PLATFORM_IMAGE, () => ({
		group: 'block',
		atom: true,
		selectable: true,
		draggable: true,
		attrs: { id: { default: '' }, alt: { default: '' } },
		parseDOM: [
			{
				tag: `figure[data-${PLATFORM_IMAGE}]`,
				getAttrs: (dom: HTMLElement) => ({
					id: dom.dataset.id ?? '',
					alt: dom.dataset.alt ?? ''
				})
			}
		],
		toDOM: (node: ProseNode) => {
			const id = String(node.attrs.id ?? '');
			const alt = String(node.attrs.alt ?? '');
			const preview = resolveUrl(id);

			// A real thumbnail when this sitting uploaded the bytes, and an
			// honest placeholder when it did not. The placeholder shows the alt
			// text because that is the author's own words for the photo; the id
			// is the fallback, because a card with nothing on it reads as a bug.
			const body = preview
				? ['img', { src: preview, alt, class: 'rich-text-block__image' }]
				: ['span', { class: 'rich-text-block__label' }, alt || id];

			return [
				'figure',
				{
					[`data-${PLATFORM_IMAGE}`]: '',
					'data-id': id,
					'data-alt': alt,
					class: 'rich-text-block'
				},
				body
			];
		},
		parseMarkdown: {
			match: (node: MarkdownNode) => node.type === 'leafDirective' && node.name === IMAGE_DIRECTIVE,
			runner: (state: ParserState, node: MarkdownNode, type: NodeType) => {
				state.addNode(type, { id: attr(node, 'id'), alt: attr(node, 'alt') });
			}
		},
		toMarkdown: {
			match: (node: ProseNode) => node.type.name === PLATFORM_IMAGE,
			runner: (state: SerializerState, node: ProseNode) => {
				// `alt` is written even when empty so the attribute stays visible
				// in the source, the same reason the previous editor wrote it:
				// omitting it would make the inaccessible outcome the silent one.
				state.addNode('leafDirective', undefined, undefined, {
					name: IMAGE_DIRECTIVE,
					attributes: { id: String(node.attrs.id ?? ''), alt: String(node.attrs.alt ?? '') }
				});
			}
		}
	}));
}

/** `::video{url="..."}` as a ProseMirror node. An atom, for the same reason. */
function videoNode() {
	return $node(PLATFORM_VIDEO, () => ({
		group: 'block',
		atom: true,
		selectable: true,
		draggable: true,
		attrs: { url: { default: '' } },
		parseDOM: [
			{
				tag: `figure[data-${PLATFORM_VIDEO}]`,
				getAttrs: (dom: HTMLElement) => ({ url: dom.dataset.url ?? '' })
			}
		],
		// The URL is shown as text rather than embedded. An iframe inside a
		// contenteditable swallows the clicks meant for the document around it,
		// and an editor that loses the caret next to every video is worse than
		// one that shows the link the author pasted.
		toDOM: (node: ProseNode) => [
			'figure',
			{
				[`data-${PLATFORM_VIDEO}`]: '',
				'data-url': String(node.attrs.url ?? ''),
				class: 'rich-text-block'
			},
			['span', { class: 'rich-text-block__label' }, String(node.attrs.url ?? '')]
		],
		parseMarkdown: {
			match: (node: MarkdownNode) => node.type === 'leafDirective' && node.name === VIDEO_DIRECTIVE,
			runner: (state: ParserState, node: MarkdownNode, type: NodeType) => {
				state.addNode(type, { url: attr(node, 'url') });
			}
		},
		toMarkdown: {
			match: (node: ProseNode) => node.type.name === PLATFORM_VIDEO,
			runner: (state: SerializerState, node: ProseNode) => {
				state.addNode('leafDirective', undefined, undefined, {
					name: VIDEO_DIRECTIVE,
					attributes: { url: String(node.attrs.url ?? '') }
				});
			}
		}
	}));
}

/**
 * The syntax plugin and both node specs, which only make sense together.
 *
 * Built per editor because `imageNode` closes over that editor's resolver;
 * sharing one set between two editors would show one author's thumbnails inside
 * the other's document.
 */
export function platformDirectivePlugins(resolveUrl: ImageUrlResolver) {
	return [platformDirectiveRemarkPlugin, imageNode(resolveUrl), videoNode()].flat();
}
