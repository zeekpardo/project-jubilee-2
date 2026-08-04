// ============================================================
// The editor's placeholder, as a ProseMirror decoration
// ============================================================
// A module of its own for a blunt reason: Svelte reserves the `$` prefix for
// runes and refuses to compile a component that imports an identifier starting
// with one. Milkdown's plugin composers are all named `$prose`, `$node`,
// `$remark`, so anything that builds a raw ProseMirror plugin has to live in a
// `.ts` file and be handed to the component ready-made.
//
// It draws the placeholder from the document rather than from whatever an empty
// document happens to render. ProseMirror rewrites the DOM under the editor as
// the content changes, so a CSS rule that keys off a lone `br` inside a lone `p`
// breaks the first time that internal detail moves. A decoration is derived from
// the document itself, which is the thing actually being described.
// ============================================================

import { $prose } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';

/** The class the component's stylesheet hangs the `::before` on. */
export const PLACEHOLDER_CLASS = 'rich-text-empty';

/**
 * `getText` is a function rather than a string because the placeholder is a
 * reactive prop: reading it at call time means a locale change is picked up on
 * the next redraw, whereas a captured string would hold whichever language
 * happened to be active when the editor was built.
 */
export function placeholderPlugin(getText: () => string) {
	return $prose(
		() =>
			new Plugin({
				key: new PluginKey('platformPlaceholder'),
				props: {
					decorations: (state) => {
						const text = getText();
						const first = state.doc.firstChild;
						// Only an untouched document gets the hint. A placeholder that
						// reappeared inside a document with content elsewhere would read
						// as text the author had somehow typed.
						const isEmpty =
							state.doc.childCount === 1 &&
							first?.type.name === 'paragraph' &&
							first.content.size === 0;
						if (!text || !isEmpty || !first) return null;

						return DecorationSet.create(state.doc, [
							Decoration.node(0, first.nodeSize, {
								class: PLACEHOLDER_CLASS,
								'data-placeholder': text
							})
						]);
					}
				}
			})
	);
}
