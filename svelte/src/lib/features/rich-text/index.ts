// The two halves of rich text on the client: one component to write it, one to
// show it. Neither knows what the prose is about, and neither may learn — the
// moment either of them mentions a particular kind of record, the next feature
// that needs a body field starts a second, weaker copy instead of reusing this.
//
// The pipeline between them lives in `$lib/domain/rich-text.ts`: RichTextEditor
// produces markdown, `renderRichText` turns it into HTML that is safe for
// `{@html}`, and RichTextBody is the only place that HTML is ever inserted.
//
// RichTextEditor is exported here for callers that want it eagerly. Milkdown and
// ProseMirror are a large chunk, so a page a stranger can reach should import
// the component's module path directly inside an `{#await import(…)}` instead —
// this barrel would drag the editor into the same chunk as the renderer.

export { default as RichTextBody } from './RichTextBody.svelte';
export { default as RichTextEditor } from './RichTextEditor.svelte';
