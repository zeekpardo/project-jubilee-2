# Updates

A campaign or a project can carry a running series of posts — what happened, who was freed, what the
money did — written by staff and read by donors. Formatted text, images, video.

This is the first thing in this codebase that publishes **free prose about a named family**, which
makes it the highest-risk content surface the platform has. The editor choice is the easy part.

Extends [PLAN-portal.md](PLAN-portal.md) and [PLAN-signed-in-site.md](PLAN-signed-in-site.md).

---

## Decisions

| Question                       | Answer                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------- |
| Stored format                  | **Markdown**, one representation, nothing derived                                 |
| Editor                         | **Carta** (`carta-md`), Svelte-5 native. Milkdown later if staff want WYSIWYG     |
| Rendering                      | Server-side `unified` → remark → rehype. **Zero editor bytes on the public page** |
| `@convex-dev/prosemirror-sync` | **No** — see §2                                                                   |
| Tiptap / ProseMirror JSON      | **No** — see §3                                                                   |
| Attaches to                    | Campaign **and** project, one table                                               |
| Publishing                     | Its own gate, independent of the parent's `isPublished`                           |
| Images                         | Store `storageId`, resolve at read. **Never** embed a URL in the body             |

---

## 1. What the reference app actually does

Worth knowing, because it answered this question twice and differently.

**`updates`** (`src/lib/db/schema.ts:620`) is deliberately primitive: `body text` nullable, plain text
rendered in a `<p whitespace-pre-line>`, `media jsonb` that **admins can never populate** (the create
path hardcodes `media: []`), no title, no author, no edit, no delete, no pagination, no indexes.
Attached to a family only — the campaigns refactor explicitly left it alone. Its one real control is
`published_public`, and the code says why: _"updates default to internal. Publishing is an explicit
admin choice … and is the only path that exposes an update through the public query layer."_

**`newsletter_drafts`** (`schema.ts:722`) is where rich text lives — BlockNote block JSON in
`body_blocks`, markdown **derived** into `body_md` on save, rendered publicly with `react-markdown`.
And it is campaign-scoped.

So this feature is a **merge of those two halves**: the project-level cadence of `updates` with the
rich-text capability of the newsletter, at both levels.

One thing not to carry forward: the dual `body_blocks` + `body_md` storage. Two representations
drift, because the derivation only ever runs in the app's save path — never in a seed, a
`@convex-dev/migrations` backfill, an import, or a typo fixed in the Convex dashboard. Each of those
writes one column and silently invalidates the other, and the failure is invisible until an editor
reopens the post months later. The reference needed the derivation only because BlockNote's native
format is blocks while its renderer wanted markdown. Choose an editor whose native format IS markdown
and the whole class of bug disappears.

---

## 2. Not `@convex-dev/prosemirror-sync`

Verified against the published tarball, not the docs.

**It requires React, and not optionally.** `react` and `react-dom` are non-optional peers at 0.2.6,
and `react` is a **value import** in `dist/tiptap/index.js` — the same module that exports the
extension. The one hook-free export, `syncExtension`, takes a `ConvexReactClient` and calls
`watchQuery()`; the `ConvexClient` that `@mmailaender/convex-svelte` builds has no such method. Using
it means writing an adapter, installing React into a Svelte app, and trusting tree-shaking for
correctness. There is no Svelte precedent anywhere in its issues or PRs.

**It solves a problem we do not have.** It is an operational-transform engine for multi-client merge
and offline editing. Our writer is one staff member. The only piece we would use is the
unsaved-changes guard, which is six lines of `beforeunload`.

**It contributes nothing to images or video**, which is the majority of the work.

**Its retention story is broken out of the box.** `pruneSnapshots` is documented `@default true`, but
the client forwards `undefined` and the component gates on truthiness (`lib.ts:44`), so
full-document snapshots accumulate indefinitely; `deltas` are never auto-pruned under any setting,
and there is no cron in the component. Also a hard 1 MB document ceiling.

**Revisit only if** the requirement becomes two people editing one post simultaneously with live
merge. Then it is a deliberate, scoped decision rather than incidental complexity.

---

## 3. Markdown, not ProseMirror JSON

The finding that settles it: **`@tiptap/static-renderer` also declares hard React peers.** Rendering
stored JSON server-side pulls React into this app, or we hand-write a recursive renderer and maintain
it. The React coupling is not confined to the sync component.

|                              | Markdown                              | Tiptap JSON              |
| ---------------------------- | ------------------------------------- | ------------------------ |
| Client JS on the public page | **0** — rendered in `+page.server.ts` | ~109 KB gzip             |
| Renderers to maintain        | one AST, output passes per surface    | web + email + plain text |
| Email (the newsletter path)  | same AST, swap the last two plugins   | a third renderer         |
| Editor swap                  | free — Carta → Milkdown, same bytes   | migration                |
| Version-history diffs        | line-diffable, readable               | nested JSON, unreadable  |
| XSS                          | none, if raw HTML is never parsed     | safe by construction     |

WYSIWYG is not the trade-off it looks like. **Milkdown** is ProseMirror-backed with markdown as its
native format — markdown in, markdown out. If staff dislike typing syntax, swapping Carta for
Milkdown changes no stored byte.

This also matches every existing convention: `campaigns.story` and `projects.story` are already
`v.optional(v.string())`, and `ArticleBody.svelte` renders prose as text with a comment saying it is
_deliberately not markdown_ — which is the decision this feature revisits, on purpose, for a surface
that genuinely needs headings and lists.

---

## 4. The privacy problem — read this before designing anything

`isProtectedFieldKey` denylists `site_ref`, `whatsapp_phone`, `note`, plus patterns for `*_ref`,
`phone`, `address`, `location` — enforced twice, at write and at read, because
_"this app serves people escaping forced labour; leaking where they were held can endanger them."_

**That mechanism works because custom fields have keys. Prose has none.**

`'note'` is on that list precisely because free-text ops notes are dangerous. An update is a note
with a publish button. No denylist, sanitizer or schema can look at a paragraph and decide whether
the sentence naming a brick kiln is safe to publish.

The same is true of images. A photo embedded in a post is a face, and possibly a landmark. The wall
is explicit that resolving an image address _is not authorization_: _"this resolves the address of a
photo, it does not decide to show one."_

Four constraints follow. None are proposals; all are inherited.

**a. Updates carry their own publish decision.** Nothing in this codebase treats "the parent is
published" as authorization for a child row — `model/portal.ts:411` re-checks `isPublished` even for
a donor who is the subject. A draft reachable through the token-less `(site)` client is a wall
breach by construction, so drafts must be unreadable by the public query layer, not merely hidden.

**b. No update is ever spread into a response.** `model/public.ts` builds every field explicitly so
_"a new admin-only column cannot leak by simply existing."_ A `toPublicUpdate` belongs in that module
and its EXPOSED list, and adding a field there "is a privacy decision, not a refactor."

**c. Ids do not travel.** Projects are addressed by `number` alone. An update needs a public handle
that is not an `Id<'updates'>` — a per-parent sequence, or a slug.

**d. Embedded blobs need a lifecycle.** A storage id referenced only from inside a markdown string is
invisible to `model/cascade.ts`, which keys off columns. That is why the data model below carries a
denormalized `assetIds` array — it is the only handle for deletion.

---

## 5. Data model

One table, both parents, exclusive.

```ts
updates: defineTable({
	orgId: v.string(),

	// Exactly one is set. A campaign update is org-wide news; a project update is
	// about one family. Carrying campaignId on BOTH is deliberate: a project
	// update needs it for the campaign feed and for capability gating, and
	// `tasks` already carries a campaign directly rather than reaching it by
	// traversal, for the same reason.
	campaignId: v.id('campaigns'),
	projectId: v.optional(v.id('projects')),

	title: v.string(),
	// CommonMark + GFM + two directives (::image, ::video). Raw HTML is never
	// parsed, so nothing typed here can become executable markup. Nothing is
	// derived from this string, so nothing can drift out of step with it.
	body: v.string(),

	// Every storage id referenced by an ::image in `body`. Denormalized because
	// a blob referenced only from inside a string is unreachable by cascade.ts,
	// which keys off columns — these ids are the only handle for deletion.
	assetIds: v.array(v.id('_storage')),

	status: v.union(v.literal('draft'), v.literal('published')),
	publishedAt: v.optional(v.number()),
	authorUserId: v.string()
})
	.index('by_campaignId_and_status_and_publishedAt', ['campaignId', 'status', 'publishedAt'])
	.index('by_projectId_and_status_and_publishedAt', ['projectId', 'status', 'publishedAt'])
	.index('by_orgId', ['orgId']);
```

Notes:

- **It must be a table.** `guidelines.md:188` forbids unbounded arrays inside a document — they hit
  the 1 MB limit and every write rewrites the whole row.
- **`publishedAt` is a real column**, not `_creationTime`. The reference presents creation time as
  the publish date, so unpublishing and republishing never changes what a reader sees. Store the
  moment publishing happened, passed in as an argument — `guidelines.md:330` forbids reading the
  clock in a query.
- **`authorUserId`** is new relative to the reference, which has no author at all. Worth having:
  "posted by" is what makes an update feel written by a person rather than emitted by a system.
- Ordering is `.order('desc')` on the index; Convex appends `_creationTime` as the final key, so no
  JS sort is needed.

---

## 6. Rendering

One pipeline, one `{@html}` in the entire codebase.

```
markdown string ─ remark-parse ─ remark-gfm ─ remark-directive
                                      │
                       ::image / ::video → validated nodes
                                      │
                  remark-rehype (allowDangerousHtml: false)
                                      │
                            rehype-sanitize
                                      │
                     rehype-stringify → HTML string
```

Two properties make this safe rather than merely sanitized:

**Raw HTML is never parsed.** `remark-rehype` defaults `allowDangerousHtml: false` and we never add
`rehype-raw`, so an admin pasting `<script>` produces a dropped node, not a stored payload. Every tag
in the output was constructed by this module from a value it already validated. `rehype-sanitize` is
belt-and-braces on top, running identically server- and client-side with no jsdom.

**It runs on the server.** The public page is SSR'd via `createConvexHttpClient()` in
`+page.server.ts`, so the markdown pipeline never reaches the browser. The editor is
dynamically imported in `/app` only.

Lives in `src/lib/domain/post-markdown.ts` with a colocated `.test.ts`, matching `video-embed.ts`.
Test cases at minimum: `<script>` dropped, `javascript:` href dropped, non-YouTube/Vimeo `::video`
degrades to nothing, unresolvable `::image` degrades to nothing.

`@tailwindcss/typography` is installed but **not registered** as a `@plugin` in `src/routes/layout.css`,
so `prose` classes are currently a no-op. Registering it is part of this work.

---

## 7. Images

**Store the id. Resolve at read. Never put a URL in the body.**

This is already the rule everywhere in the codebase (`model/public.ts:301`, `projects/queries.ts:19`),
and §10 explains why it matters more than the existing comments claim.

Upload follows the established three-step dance (`CampaignImageUploader.svelte:58-86`):
`generateUploadUrl` mutation → `POST` the bytes → a second mutation writes the id. The upload-url
minter is capability-gated, never the bare one.

In the body an image is a directive carrying the id:

```
::image{id=kg2h... alt="The family outside their new home"}
```

At read time the query resolves `assetIds` to URLs and hands the map to the renderer, which
substitutes them. An id that no longer resolves drops the figure rather than rendering a broken
image — matching `resolveReceiptUrl`, which degrades rather than throwing.

---

## 8. Video

`toVideoEmbed` in `src/lib/domain/video-embed.ts` is reusable **verbatim** as the `::video` gate. It
is a pure function, already tested against `javascript:`, `data:`, `vbscript:` and `file://`, and it
hard-codes the only two embeddable hosts — YouTube via `youtube-nocookie.com`, Vimeo via
`player.vimeo.com`. Everything else degrades to an outbound link, deliberately, because _"embedding
those means loading third-party JS on a page served to people whose safety depends on this site
leaking nothing."_

Because it can only ever produce those two hosts, allowlisting `iframe` in the sanitize schema is
safe.

Also copy `ProjectHeroMedia.svelte`'s **click-to-load facade** — poster image plus a play button,
with the iframe mounted only on an explicit click. That is a stated privacy commitment in this
codebase, and a post with three auto-loading YouTube iframes would quietly break it.

---

## 9. Where it lands

**Authoring.**

| Level    | Route                                                               | Capability       |
| -------- | ------------------------------------------------------------------- | ---------------- |
| Campaign | `app/admin/campaigns/[id]` — a new card beside `CampaignPublicCard` | `campaign:edit`  |
| Project  | `app/projects/[number]` — a new tab beside Documents                | `projects:write` |

Those are the capabilities that already authorize each parent's `story` and images. Note the
asymmetry is real and intended: `projects:write` includes `team_leader`; `campaign:edit` does not,
and `permissions.ts` calls that _"the one capability that separates the two roles."_

**Reading.** Two new queries in `convex/public/queries.ts`, both starting from
`resolvePublishedCampaign` and both `.take()`-bounded with the existing `clampLimit` shape:

- `listCampaignUpdates(orgSlug, campaignSlug, limit?)` → the campaign page,
  `(site)/[orgSlug]/[campaignSlug]/[objectSlug]/`, below the story
- `listProjectUpdates(orgSlug, campaignSlug, number, limit?)` → the record page,
  `.../[number]/`, below the story

**`(me)` and `(embed)`.** A donor's own record page reads through `model/portal.ts`, whose rule 2 says
connection filters public data and never widens it — so a donor sees published updates, not drafts,
and there is no third tier. `(embed)` inherits whatever the public queries return; anything exposed
there is embeddable on arbitrary third-party sites.

**Cascade.** `model/cascade.ts` must learn the table: deleting a project or campaign deletes its
updates, and **the blobs in `assetIds` go before the rows**, mirroring the existing document and
cover-image handling.

---

## 10. A finding that is not about Updates

**The codebase believes storage URLs expire. They do not.**

Three comments assert it — `documents/queries.ts:61`, `ProjectPhoto.svelte:11`,
`campaigns/queries.ts:14` — and `guidelines.md:431` calls the result a "signed URL". The Convex
`getUrl` type declaration says only that it returns _"A URL which fetches the file via an HTTP GET,
or null if the file no longer exists"_, and that _"once a file is deleted, any URLs previously
generated will return 404s."_ Deleting the blob is the only revocation. Nothing in this repo sets,
checks or refreshes an expiry, because there is none to set.

So **every project photo already handed to an anonymous visitor is a permanent, un-revocable public
URL.** Unpublishing a project does not take it back. `ProjectPhoto.svelte` carries error handling for
an expiry that never happens.

This is true today, before any of this work. Updates would multiply it, because posts carry more
photographs of more people. It deserves its own decision — at minimum, correcting the comments and
`guidelines.md` so the next person does not design against a guarantee that isn't there.

---

## 11. Open decisions

**1. Should publishing need a narrower right than writing?** Today nothing separates them anywhere in
the app — `setProjectPublished` rides the same capability as editing. But an update is the riskiest
thing this platform publishes, and the person best placed to write one (a field team leader) is not
obviously the person who should decide it goes public. A `content:publish` capability granted to
fewer roles is the smallest version.

**2. Should update bodies be reviewed before they go public?** Free text cannot be policed by a
denylist, so a second pair of eyes may be the only real control. A draft → review → published flow is
more machinery than a boolean; a two-person rule on publishing is less. This is a workflow decision,
not a technical one, and it should be made deliberately rather than defaulted.

**3. Does an update ever need to be edited or deleted after publishing?** The reference supports
neither. For this platform, "we published a photo we should not have" is a real scenario, and the
answer to it is currently "you cannot take it back" — see §10.

**4. Campaign-level updates on a page that does not exist.** `(site)/[orgSlug]/[campaignSlug]/`
is a pure redirect today, because _"the campaign has no landing page of its own: its records ARE what
a visitor came for."_ Campaign updates need a home — the object-listing page is the natural one, but
it is worth deciding rather than assuming.

---

## 12. Order

1. `post-markdown.ts` + tests. Pure, no schema, no UI — the safety guarantee lands first and is
   testable in isolation.
2. Register `@tailwindcss/typography`. `PostBody.svelte`, the one `{@html}` in the codebase.
3. `updates` table, cascade entries, `generateUploadUrl` + write mutations, capability-gated.
4. Admin authoring: project tab first (the narrower surface), then the campaign card.
5. Public reads: `toPublicUpdate` in `model/public.ts` with its header entry, then the two queries,
   then the two page sections.
6. Decide §11.1 and §11.2 **before** step 4 ships to anyone real.

Steps 1–3 have no user-visible surface and no privacy exposure. The exposure begins at step 5, which
is why the wall projection and the publish gate belong in the same change rather than either being
retrofitted.

---

## 13. What this deliberately does not do

- **Real-time collaborative editing.** One author, no merge. Revisit with `prosemirror-sync` (and its
  React problem) only if that changes
- **Store two representations of one document**
- **Parse raw HTML**, ever
- **Embed a resolved storage URL in a body**
- **Auto-load third-party iframes** — click-to-load, as the rest of the public site already does
- **Notify anyone on publish.** The reference fires nothing at creation time; the newsletter is a
  separate, deliberate action that reads published updates. Same here
