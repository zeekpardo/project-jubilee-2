// ============================================================
// Rich text — admin markdown → HTML that is safe for {@html}
// ============================================================
// Every place this org's staff write prose that a stranger will read — a
// campaign or project `story`, a published update, the newsletter that will
// exist one day — goes through this module and nothing else. It is the last
// step before `{@html}` on a page served to people escaping forced labour, so
// it is a security boundary that happens to also do formatting, not a
// formatting utility that happens to be careful.
//
// The threat is the same one `video-embed.ts` names: admin-entered text is
// trusted about as far as any free-text field. A typo, a pasted snippet, or a
// compromised admin account must not be able to put script into a visitor's
// browser, and must not be able to make the page fetch anything from a host
// this org did not choose.
//
// THE PRIMARY GUARANTEE IS THAT RAW HTML IS NEVER PARSED. `remark-rehype`
// defaults `allowDangerousHtml` to false, which drops every raw-HTML node on
// the floor before a sanitizer ever sees it. That default is the whole defence
// and it must stay untouched: never pass `allowDangerousHtml`, never add
// `rehype-raw`. `rehype-sanitize` below is defence in depth — the second line,
// not the first. Anything that relies on the sanitizer alone has already given
// up the guarantee that matters.
//
// NEVER ADD, in the schema or anywhere else: `style`, `class` beyond the
// `code` language hint the default schema already permits, any `on*` handler,
// any protocol beyond http and https, or any tag whose content the editor
// cannot produce.
//
// This module is deliberately feature-neutral. It knows nothing about updates,
// campaigns, or Convex; it takes a string and a map of already-resolved URLs
// and returns a string. No IO, no Svelte, no database types — so that the next
// feature that needs prose reuses it instead of writing a second, weaker one.
// ============================================================

import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { SKIP, visit } from 'unist-util-visit';

import { toVideoEmbed } from './video-embed';

/** Resolved storage-id → URL map, supplied by the caller that read the row. */
export type RichTextAssets = Record<string, string>;

/**
 * The minimum shape this module needs from a markdown node. Declared locally
 * rather than imported from `mdast-util-directive` because that package is a
 * transitive dependency: importing its types would couple us to the resolution
 * of something we never chose to install.
 */
interface MarkdownNode {
	type: string;
	name?: string;
	value?: string;
	attributes?: Record<string, string | null | undefined> | null;
	children?: MarkdownNode[];
	data?: {
		hName?: string;
		hProperties?: Record<string, unknown>;
		hChildren?: unknown[];
	};
}

/** What a directive becomes in the HTML tree, or nothing at all. */
type DirectiveRender = NonNullable<MarkdownNode['data']>;

const DIRECTIVE_TYPES = new Set(['textDirective', 'leafDirective', 'containerDirective']);

/**
 * Node types whose children are blocks rather than words, so an excerpt puts a
 * space between them. Without this a two-item list reads as "onetwo".
 */
const BLOCK_PARENTS = new Set([
	'root',
	'list',
	'listItem',
	'blockquote',
	'table',
	'tableRow',
	'footnoteDefinition'
]);

/**
 * The tags an admin can actually produce, and no others.
 *
 * This replaces the default schema's list rather than extending it. The
 * default is GitHub's, which is generous by design; here the safe set is the
 * small one the editor can generate, so anything unexpected in the tree is
 * unwrapped to its text instead of being trusted because GitHub trusts it.
 *
 * Some things `remark-gfm` can parse — tables, strikethrough, footnote
 * sections — are deliberately absent. GFM is in the pipeline for autolink
 * literals and its friendlier parsing, and markup it produces beyond this list
 * loses its tags while keeping its text. That is a decision, not an oversight:
 * add a tag here only once the editor can really emit it.
 */
const ALLOWED_TAGS = [
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'p',
	'strong',
	'em',
	'ul',
	'ol',
	'li',
	'blockquote',
	'code',
	'pre',
	'a',
	'img',
	'iframe',
	'figure',
	'figcaption',
	'hr',
	'br'
];

/**
 * Built by spreading `defaultSchema` rather than mutating it, because the
 * imported object is shared module state: editing it in place would silently
 * change the rules for every other consumer in the process.
 *
 * The `iframe` allowlist looks like a mistake and is not. An iframe can only
 * enter this tree one way — the `::video` directive below, whose src comes
 * from `toVideoEmbed`, which emits a youtube-nocookie.com or player.vimeo.com
 * embed URL or nothing. Raw `<iframe>` typed into the body is never parsed at
 * all. So there is no path by which an admin chooses the framed origin, which
 * is the only thing that makes allowlisting a frame defensible.
 *
 * `protocols` narrows href and src to http and https. The default also permits
 * mailto, xmpp, irc and ircs on href; none of those are worth the surface on a
 * page whose readers should never be handed an unexpected protocol handler.
 */
const SCHEMA: typeof defaultSchema = {
	...defaultSchema,
	tagNames: ALLOWED_TAGS,
	attributes: {
		...defaultSchema.attributes,
		a: [...(defaultSchema.attributes?.a ?? []), 'rel', 'target'],
		// `loading` is here because this module sets it; it is inert markup that
		// keeps a story full of photos from downloading all of them at once on
		// a phone tethered to a slow connection.
		img: [...(defaultSchema.attributes?.img ?? []), 'alt', 'title', 'loading'],
		iframe: ['src', 'title', 'loading', 'allowFullScreen', 'referrerPolicy']
	},
	protocols: {
		...defaultSchema.protocols,
		href: ['http', 'https'],
		src: ['http', 'https']
	}
};

function isDirective(node: MarkdownNode): boolean {
	return DIRECTIVE_TYPES.has(node.type);
}

/**
 * An attribute by name. Attributes are read one at a time and never spread
 * into properties, the same allowlist discipline the privacy wall uses: the
 * directive syntax also turns `#foo` and `.foo` into `id` and `className`, and
 * reading only what we name means those never reach the output.
 */
function attribute(node: MarkdownNode, name: string): string | null {
	const value = node.attributes?.[name];
	const trimmed = typeof value === 'string' ? value.trim() : '';
	return trimmed ? trimmed : null;
}

/** The directive's label text, used where an element needs visible content. */
function label(node: MarkdownNode): string {
	return (node.children ?? []).map(visibleText).join('').trim();
}

/**
 * `::image{id=<storageId> alt="..."}` → an img, or nothing.
 *
 * A missing entry in the map is an ordinary state, not an error: the blob may
 * have been deleted, or the caller may have withheld it on purpose because the
 * post is a draft. Either way the node renders as nothing — no broken image,
 * no placeholder — degrading the way `resolveReceiptUrl` does rather than
 * throwing and taking the whole page down with it.
 */
function renderImage(node: MarkdownNode, assets: RichTextAssets): DirectiveRender | null {
	const id = attribute(node, 'id');

	// `Object.hasOwn` and the string check, rather than a plain lookup, because
	// the id is admin-typed: `::image{id=constructor}` reaches Object.prototype
	// and comes back truthy, which is how a lookup turns into a src nobody
	// resolved.
	const src = id && Object.hasOwn(assets, id) ? assets[id] : undefined;
	if (!src || typeof src !== 'string') return null;

	return {
		hName: 'img',
		// An img is void: give it no children, so a label written between
		// brackets cannot end up as unrenderable content inside the tag.
		hChildren: [],
		hProperties: { src, alt: attribute(node, 'alt') ?? '', loading: 'lazy' }
	};
}

/**
 * `::video{url="..."}` → an iframe, an outbound link, or nothing.
 *
 * All URL judgement is delegated to `toVideoEmbed`, which is already tested
 * against `javascript:`, `data:`, `vbscript:` and `file://`. Parsing the URL a
 * second time here would mean a second set of rules to keep in agreement with
 * the first, and the disagreement is where the hole would be.
 *
 * QUOTE THE URL. An unquoted directive attribute value ends at the first `=`,
 * so `url=https://youtube.com/watch?v=abc` parses as `url` = "https://you..."
 * up to the `?v`, the directive stops being a directive, and the admin sees
 * their markup printed on the page. Whatever writes this syntax — an editor,
 * a paste helper — must emit the quoted form.
 */
function renderVideo(node: MarkdownNode): DirectiveRender | null {
	const embed = toVideoEmbed(attribute(node, 'url'));
	if (!embed) return null;

	const title = label(node);

	if (embed.kind === 'iframe') {
		return {
			hName: 'iframe',
			hChildren: [],
			hProperties: {
				src: embed.src,
				title: title || 'Embedded video',
				loading: 'lazy',
				allowFullScreen: true,
				// The embed hosts have no business learning which page a
				// visitor was reading when the frame loaded.
				referrerPolicy: 'no-referrer'
			}
		};
	}

	const link: DirectiveRender = {
		hName: 'a',
		hProperties: {
			href: embed.href,
			target: '_blank',
			// `noopener` is why `target` is tolerable at all: without it the
			// opened page gets a handle on this one via window.opener.
			rel: ['noopener', 'noreferrer']
		}
	};

	// An anchor with no text is an invisible link. When the admin wrote no
	// label, the URL itself is the honest thing to show.
	if (!title) link.hChildren = [{ type: 'text', value: embed.href }];

	return link;
}

/**
 * Rewrites the two directives this platform understands and deletes every
 * other directive outright.
 *
 * Deleting the unrecognised ones matters: an unhandled directive node reaches
 * `mdast-util-to-hast` as an unknown type and is rendered as a generic
 * container, so a typo like `::imge{...}` would otherwise emit a stray element
 * built from text the admin never meant to publish.
 */
function remarkPlatformDirectives(assets: RichTextAssets) {
	return (tree: MarkdownNode) => {
		visit(tree, (node: MarkdownNode, index, parent: MarkdownNode | undefined) => {
			if (!isDirective(node)) return;
			if (!parent || index === undefined) return;

			const rendered =
				node.name === 'image'
					? renderImage(node, assets)
					: node.name === 'video'
						? renderVideo(node)
						: null;

			if (!rendered) {
				parent.children?.splice(index, 1);
				// The node at `index` is now the next sibling, so revisit it
				// rather than stepping past it.
				return [SKIP, index];
			}

			node.data = { ...node.data, ...rendered };
			return SKIP;
		});
	};
}

/** The visible text of a node, ignoring anything that is not prose. */
function visibleText(node: MarkdownNode): string {
	if (node.type === 'text' || node.type === 'inlineCode') return node.value ?? '';
	if (node.type === 'break') return ' ';

	// Raw HTML, code blocks and directives contribute nothing. An excerpt ends
	// up in a card or a meta description, and markup source, a storage id or an
	// embed URL leaking into either is both ugly and a small disclosure.
	if (node.type === 'html' || node.type === 'code' || isDirective(node)) return '';

	return (node.children ?? []).map(visibleText).join(BLOCK_PARENTS.has(node.type) ? ' ' : '');
}

/**
 * markdown + resolved assets → sanitized HTML, safe for `{@html}`.
 *
 * The processor is built per call because the directive handler closes over
 * this caller's asset map; a unified processor is frozen once used, so sharing
 * one would mean sharing whichever map happened to be first.
 */
export function renderRichText(markdown: string, assets: RichTextAssets = {}): string {
	if (!markdown?.trim()) return '';

	const file = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkDirective)
		.use(remarkPlatformDirectives, assets)
		// allowDangerousHtml is left at its false default on purpose. See the
		// header: this is the line that makes raw HTML a non-event.
		.use(remarkRehype)
		.use(rehypeSanitize, SCHEMA)
		.use(rehypeStringify)
		.processSync(markdown);

	return String(file);
}

/**
 * First `maxChars` characters of visible text, for cards and meta
 * descriptions. No markup, and never longer than asked: a caller writing into
 * a `<meta>` tag has a hard budget, so the ellipsis is counted too.
 */
export function richTextExcerpt(markdown: string, maxChars = 160): string {
	if (!markdown?.trim() || maxChars <= 0) return '';

	// Parse only: the excerpt never needs HTML, and not building the second
	// half of the pipeline keeps it away from anything that emits markup.
	const tree = unified()
		.use(remarkParse)
		.use(remarkGfm)
		.use(remarkDirective)
		.parse(markdown) as MarkdownNode;

	const text = visibleText(tree).replace(/\s+/g, ' ').trim();

	if (text.length <= maxChars) return text;

	const clipped = text.slice(0, maxChars - 1);
	const lastSpace = clipped.lastIndexOf(' ');
	return `${(lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
}
