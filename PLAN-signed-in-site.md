# The signed-in public site

Bringing the portal onto the public pages: a donor who is logged in is recognized wherever they
browse, sees their own giving in context, and gives without re-entering who they are.

Inspiration is Planning Center's Church Center — one org-scoped surface where the public pages and
the "Me" page are the same place, and signing in changes what you see rather than where you are.

Extends [PLAN-portal.md](PLAN-portal.md). Depends on [PLAN-stripe.md](PLAN-stripe.md) for the last
phase only.

---

## Key risks

**1. Cache poisoning.** [(site)/+layout.server.ts:32](<svelte/src/routes/(site)/+layout.server.ts:32>)
sets `cache-control: public, max-age=60, s-maxage=300`. Personalized bytes on a publicly cached
route means a CDN can serve one donor's name and giving history to the next visitor. This is the
most dangerous part of the feature and the reason personalization is **client-only** (§4).

**2. Org resolution.** `orgId` must come from the **URL slug**, never from Better Auth's active
organization. Every existing portal read resolves org from the session; every public read resolves
it from the slug. Mixing them is the cross-tenant leak. This is also what makes multi-org a later
feature rather than a migration.

**3. The auth boundary while merging URL space.** `hooks.server.ts` waves through anything matching
`/(site)` by route id, fail-closed by design. If the Me page joins that group, the blanket test
starts waving through authenticated pages.

**4. Embeds.** `(embed)` routes serve with `frame-ancestors *`. Signed-in chrome inside a widget any
site can iframe is a donor-identity harvesting vector. `(embed)` stays permanently anonymous.

---

## Decisions

| Question                               | Answer                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| Multi-org                              | Not yet — but org resolves from the URL slug from day one, so it's additive later |
| What signed-in adds                    | Same public content + signed-in chrome + their own giving in context              |
| Unpublished records / protected fields | **No.** The wall's guarantees are unchanged                                       |
| Surface                                | Merged, Church Center style — the portal moves under the org slug                 |
| Personalization transport              | Client-side reactive Convex query                                                 |
| Sign-in                                | Org-scoped `/{orgSlug}/login`, magic link by email                                |
| Anonymous giving                       | Still fully supported; sign-in is a shortcut, never a gate                        |
| Cross-org visitor                      | Treated as anonymous                                                              |
| Me page tabs                           | Real routes                                                                       |
| Giving in context                      | Amount + date, on project and campaign pages                                      |

---

## 1. URL shape

```
/{orgSlug}/                              public campaign index        anonymous
/{orgSlug}/{campaign}/{objects}/         public listing               anonymous
/{orgSlug}/{campaign}/{objects}/{n}/     public record                anonymous
/{orgSlug}/login                         org-branded magic link       anonymous
/{orgSlug}/me                            Me overview                  SIGNED IN
/{orgSlug}/me/giving                     giving history               SIGNED IN
/{orgSlug}/me/records                    records they're part of      SIGNED IN
/{orgSlug}/me/tasks                      their tasks                  SIGNED IN
/{orgSlug}/me/profile                    contact details + prefs      SIGNED IN
/{orgSlug}/me/payment-methods            saved cards                  SIGNED IN — Stripe-gated
```

The path segment is `records`; the TAB reads "Stories" (`portal_navRecords`). The label was the part
worth getting right, and renaming the URL bought nothing.

Two routes this plan originally listed do not exist, both dropped during Phase 3 for reasons the
codebase supplied rather than the plan:

- **`/me/household`** — `model/portal.ts` rule 3 forbids returning any other person's row, its
  NEVER-EXPOSED list naming "not another member of their own record" specifically, and the module
  notes that a portal session lives on a phone that can be taken. A household tab would be that
  rule's first exception. Deferred pending a privacy review; the `households` and `householdMembers`
  tables are untouched.
- **`/me/preferences`** — there was nothing to put on it. `transparency` does not exist; it was
  renamed `updateDetail`, whose schema comment says the old name "reads like a permission and is not
  one". It and `preferredContact` are both already editable in the Profile tab.

`/portal` is NOT retired. It survives as a server-only redirector, because `orgSettings.slug` is
optional: an org that never claimed one has no `/{orgSlug}/me` to send anyone to, and
`app/+layout.server.ts` sends its non-admins here. It resolves the slug via `getMyOrgSlug` and
forwards; 404 for a slug-less org, the only answer that cannot loop.

**Why the move is required, not cosmetic.** `/portal` resolves org from the session. A person who
one day belongs to two orgs cannot express which one in that URL. Putting the Me page under the slug
is what makes the multi-org decision cheap later.

### Route groups — the part to verify first

The URL space merges; the **auth boundary does not**.

```
src/routes/(site)/[orgSlug]/…      public. Matched as public by route id in hooks.
src/routes/(me)/[orgSlug]/me/…     authenticated. Not in any public allowlist.
```

Route groups don't appear in URLs, so this reads as one surface to the user while
`isPublicSite(routeId)` stays exactly as fail-closed as it is today.

> **VERIFIED.** Two route groups can both declare a `[orgSlug]` segment. A spike built
> `(me)/[orgSlug]/me/` alongside `(site)/[orgSlug]/`, and both `svelte-kit sync` and a full
> production build completed with no route conflict. The conflict rule is about two files resolving
> to the _same_ URL, which these do not. The fallback this section once described — one `(site)`
> group with a hole punched in the allowlist — was not needed and is not the design.

`/{orgSlug}/login` stays in `(site)`: it must be reachable while signed out.

---

## 2. Data model

**No new tables.** Everything needed exists.

| Field                              | Table          | Role                                                                                                     |
| ---------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| `authUserId`                       | `contacts`     | The account↔contact link. Already uniquely indexed per org                                               |
| `portalAccess`                     | `contacts`     | `invited` / `active` / `revoked`                                                                         |
| `emailLower`                       | `contacts`     | Claim-by-email on first sign-in                                                                          |
| `slug`                             | `orgSettings`  | Org resolution from URL. Globally unique                                                                 |
| `contactId`                        | `transactions` | Giving history                                                                                           |
| `campaignId`, `projectId`          | `allocations`  | Giving _in context_                                                                                      |
| `preferredContact`, `updateDetail` | `contacts`     | Donor preferences — already editable in Profile. `transparency` does not exist; this is its current name |

`unique(orgId, authUserId)` — one contact per account **per org** — is already the multi-org-ready
shape. Nothing to migrate.

### The viewer is derived, not stored

```
(orgId from URL slug) × (userId from session) → contact | null
```

This composition gives "treat them as anonymous at an org they don't belong to" **for free**. No
membership check, no special case: the lookup returns nothing and the page renders anonymously.

```ts
/** The signed-in person as the PUBLIC SITE sees them: scoped by URL, not by session. */
export type SiteViewer = {
	orgId: string; // from orgSettings.slug — NEVER from the session
	userId: string; // from the session — NEVER from an argument
	contact: Doc<'contacts'>;
};
```

### Later, for saved payment methods (Stripe-gated)

Per [PLAN-stripe.md](PLAN-stripe.md), direct charges put the Customer on the **connected account**,
so a saved card is per-org by construction:

```ts
// added to contacts, or a small join table if a contact can hold several
stripeCustomerIdByOrg: v.optional(v.string()),
```

---

## 3. Shared patterns — what to reuse

Most of the read layer already exists. [model/portal.ts](svelte/src/convex/model/portal.ts) rule 2
already states the portal composes `toPublicProject` **unchanged** plus the viewer's own giving —
which is precisely this feature's shape.

**Reuse unchanged:**

| Thing                                         | Where                        | Use                                      |
| --------------------------------------------- | ---------------------------- | ---------------------------------------- |
| `portalGiving(ctx, viewer)`                   | `model/portal.ts:193`        | Giving tab, and the basis for in-context |
| `portalConnections(...)`                      | `model/portal.ts:308`        | Stories tab                              |
| `toPortalRecord(...)`                         | `model/portal.ts:403`        | Story detail                             |
| `toPortalProfile(...)`                        | `model/portal.ts:115`        | Profile tab                              |
| `toPublicProject` / `toPublicCampaign`        | `model/public.ts`            | Public pages, untouched                  |
| `PortalNoAccess.svelte`                       | `(portal)/portal/`           | Relocates with the rest                  |
| `formatCents`                                 | `$lib/features/money/format` | Never format money inline                |
| `useQuery(api.x, () => cond ? args : 'skip')` | app-wide                     | The gating idiom for every viewer read   |

**The one genuinely new primitive:**

```ts
// model/identity.ts — sibling of resolvePortalViewer
/**
 * Who is looking at THIS ORG'S public site.
 *
 * The sibling of resolvePortalViewer, and different in exactly one way: the org
 * comes from the URL slug, not from the session's active organization. A person
 * signed in at org A browsing org B's site must resolve to null, and going
 * through getAccess() — which reads the ACTIVE org — would resolve them to their
 * org A contact while they stand on org B's page. That is the cross-tenant leak
 * this whole feature has to avoid, so the active org is never consulted.
 *
 * The person still comes from the session and nothing else. An unknown slug, a
 * signed-out visitor, no contact in this org, or revoked access all return null
 * — one anonymous outcome, no partial states.
 */
export async function resolveSiteViewer(ctx: QueryCtx, orgSlug: string): Promise<SiteViewer | null>;
```

`portalGiving` and friends take `{ orgId, userId, contact }`, so a `SiteViewer` satisfies them
directly — no changes to the projection.

**New for in-context giving.** Do **not** ship `portalGiving`'s 500 gifts to the browser to compute
one number. Add a focused query returning a small aggregate for the record being viewed:

```ts
export const getMyGivingForRecord = query({
	args: { orgSlug: v.string(), campaignSlug: v.string(), projectNumber: v.optional(v.string()) }
	// -> { totalCents, giftCount, lastGiftOn } | null
});
```

---

## 4. State design

No Zustand, no TanStack. State here is Svelte context plus Convex reactivity.

**New context** — `createSiteViewerContext` / `setSiteViewerContext` / `getSiteViewerContext`,
matching the existing triple in `src/lib/access/context.svelte.ts`.

|                           |                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| **Single responsibility** | Who the viewer is _for the org whose page we're on_, and nothing else                                                            |
| **Owns**                  | `viewer \| null`, `isLoading`, the org slug it resolved against                                                                  |
| **Does NOT own**          | Staff capabilities (`getAccessContext()` — leave alone, it's a different question), theme/campaign context, any public page data |
| **Must not affect**       | The anonymous render path. A signed-out visitor's HTML is byte-identical to today's                                              |

**Cache invalidation:** Convex subscriptions are reactive — a gift recorded by the Stripe webhook
updates the Me page live with no invalidation call. There is no query key file in this stack.

### The client-only rule

Personalization **never** appears in server-rendered `(site)` HTML.

```
(site) load          anonymous, token-less client, cached ← unchanged from today
    ↓ hydrate
useQuery(viewer)     browser, per-session, uncached      ← all personalization
```

`(me)` routes are the opposite: server-gated, `cache-control: private, no-store`, and they may
server-render personal data because they are never cached and never anonymous.

> This is why "signed-in chrome" flashes in a moment after load. That is the correct trade. The
> alternative — varying the public cache on a session cookie — puts one donor's name one
> misconfiguration away from another donor's screen.

---

## 5. UI spec

### Component tree

```
(site)/[orgSlug]/+layout.svelte
├── SiteHeader.svelte                    ← gains the account slot
│   └── SiteAccountMenu.svelte           NEW · client-only
│       ├── signed out → "Sign in" → /{orgSlug}/login
│       └── signed in  → name, "Me", "Sign out"
└── …existing public pages…
    └── [number]/+page.svelte
        ├── FundingProgress.svelte       unchanged
        ├── YourGivingNote.svelte        NEW · client-only, renders nothing when anonymous
        └── DonationForm.svelte          gains prefill + sign-in shortcut

(me)/[orgSlug]/me/+layout.svelte         NEW shell, same header
├── MeTabs.svelte                        NEW · <a> links, not buttons
└── giving | records | tasks | profile | payment-methods
```

Note the account menu and `MeTabs` both ship; `YourGivingNote` and the `DonationForm` changes are
what Phase 4 still owes.

### Scroll

The Me shell follows `(portal)`'s existing layout: page-level scroll, tab strip sticky at top on
mobile. Tab panels do **not** get their own scroll container — nested scroll inside a page that also
scrolls is the overflow bug this codebase has avoided so far.

### Forms

**DonationForm** — field order unchanged. Two additions:

| State     | Behavior                                                                             |
| --------- | ------------------------------------------------------------------------------------ |
| Anonymous | Exactly as today, plus a quiet "Sign in for faster giving" link above the name field |
| Signed in | `name` and `email` prefilled from the contact, editable, with "Not you?" to clear    |
| Signed in | Gift carries `contactId` so history is exact rather than email-matched               |

Prefill fills the **initial** value only — it must never overwrite something the donor has typed.
Key the form on `viewer?.contact._id` so switching identity remounts rather than merging state.

**Profile / preferences / household** — reuse the existing portal forms unchanged. Editable fields
stay bounded by `PORTAL_EDITABLE_PROFILE_FIELDS`.

### Giving in context — `YourGivingNote`

> **You've given $250 to this family** — last gift Mar 4

- Project and campaign pages
- Renders **nothing at all** when anonymous or when the viewer has no gifts to that record — never
  an empty shell, never a skeleton that resolves to nothing
- Amount from `formatCents`
- Only the viewer's own gifts. Never a donor count, never anyone else's

### States

| Scenario                           | What the user sees                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Anonymous, any public page         | Today's page exactly, plus a "Sign in" link in the header                                                        |
| Signed in, viewer loading          | Public page renders immediately; account slot holds a small skeleton. Never blocks content                       |
| Signed in, no gifts to this record | `YourGivingNote` renders nothing                                                                                 |
| Me page, no giving yet             | "You haven't given yet" + a link to the org's campaigns                                                          |
| Me page, no stories                | "You're not connected to any stories yet"                                                                        |
| Viewer query fails                 | Fall back to the anonymous view silently. A broken personalization query must never break a public donation page |
| `/me` at an org with no contact    | **307 → `/{orgSlug}/`**                                                                                          |

---

## 6. Login

`/{orgSlug}/login` — org branding from `orgSettings` (publicName, theme, icon), **magic link by
email only**. No password, no OTP: donors visit rarely and a credential they forget is a support
ticket.

Underneath it is the same Better Auth flow as `/signin`; only the presentation and the return URL
differ. One auth implementation, two entry points.

**Return URL.** Carry `redirectTo` through the magic link so a donor who clicked "Sign in for faster
giving" from a project page lands back on that project page with the form prefilled — not on a
generic home page. `hooks.server.ts` already has the `withRedirect` helper for this shape.

**The claim step moves.** `claimPortalContact(ctx, orgId, userId, email)` runs today in
[(portal)/portal/+layout.server.ts](<svelte/src/routes/(portal)/portal/+layout.server.ts>) with
`orgId` from the session's active org. It now takes `orgId` **from the slug**, and runs on first
load of any `(me)` route. Its compare-and-set on an unlinked contact is unchanged — this is a change
of _source_, not of logic.

---

## 7. Edge cases

| Case                                    | Behavior                                                                                                                                                                       |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Signed in at org A, browsing org B**  | Anonymous at B. `resolveSiteViewer` returns null; no chrome, no prefill, no giving note. Giving still works, as a stranger                                                     |
| **`/{orgSlug}/me` at a non-member org** | 307 to `/{orgSlug}/`. Reveals nothing about whether an account exists                                                                                                          |
| **Unknown org slug**                    | 404, as today. Identical for signed-in and anonymous                                                                                                                           |
| **Access revoked mid-session**          | `portalAccess === 'revoked'` is checked on **every read**, so the next query drops them to anonymous. No sign-out needed                                                       |
| **Contact deleted while signed in**     | Viewer resolves null → anonymous. `model/cascade.ts` already clears `transactions.contactId` on contact delete, so the ledger survives                                         |
| **Staff member on the public site**     | Resolves through the same path. Staff who are also contacts see their own giving; staff who aren't see nothing. Capabilities are irrelevant here — this surface grants nothing |
| **Anonymous gift, later signs in**      | Gift stays unattributed unless the email matches at claim time. Explicitly **not** building a claim-my-past-gifts flow now                                                     |
| **Same email, two orgs**                | Two separate contacts, two separate `authUserId` links, one account. Already legal under `unique(orgId, authUserId)` — this is the multi-org seam                              |
| **Embed routes**                        | Never personalized. No account menu, no giving note, no viewer context. Enforced by the context living in `(site)`'s layout, which `(embed)` does not inherit                  |
| **Navigating away mid-profile-edit**    | Existing portal behavior, unchanged                                                                                                                                            |
| **Prefill vs typed input**              | Prefill sets initial value only. Form keyed on contact id so identity change remounts                                                                                          |
| **Bulk operations**                     | None. Every write on this surface is the viewer's own single record                                                                                                            |

---

## 8. Implementation order

**Phase 1 — the seam** — DONE (PR #9)

1. ~~Spike the two-route-group question~~ — verified, see §1.
2. ~~`resolveSiteViewer(ctx, orgSlug)`~~ — plus `decideSiteViewer` in `lib/domain/` with 12 cases.
   The rule requires `portalAccess === 'active'`, not merely not-revoked: every write pairs the two,
   so a row that is linked but not active is two writes disagreeing.
3. ~~`getSiteViewer` and `getMyGivingForRecord`~~ — in `convex/site/queries.ts`, projections in
   `convex/model/site.ts`. `getSiteViewer` returns `{ firstName, displayName }` and deliberately no
   `contactId`: an id in the browser is an argument waiting to be accepted.

**Phase 2 — recognition** — DONE (PR #10) 4. ~~Site viewer context + `SiteAccountMenu`~~ — the signed-in branch is gated behind a flag set
inside an `$effect`, so the cached HTML and the first client render are identical anonymous
markup. 5. ~~`/{orgSlug}/login`~~ — plus `safeRedirectTo` in `lib/domain/` with 17 cases. The strip of
`\t\n\r` runs BEFORE the protocol-relative check, because browsers strip those themselves.
Two optional props on `SignIn.svelte` (`methods`, `hideHeader`), both defaulting to prior
behaviour.

**Phase 3 — the Me page** — DONE (PRs #11, #12) 6. ~~Relocate `/portal/*` → `/{orgSlug}/me/*`~~ — and **`resolvePortalViewer` was deleted**, which
turned out to be the point. Nine functions take `orgSlug`; one resolver remains and it can only
be scoped by a URL. `/portal` survives as a redirector (§1). Turning someone away from an org's
pages now sends them to that org's login, not the platform's. 7. ~~`MeTabs`~~ — five tabs, no new i18n. Household and preferences dropped; see §1 for why.

**Phase 4 — giving** — NEXT 8. `YourGivingNote` on project and campaign pages, reading `getMyGivingForRecord` (already built). 9. `DonationForm` prefill + sign-in shortcut.

**Phase 5 — Stripe-gated** _(blocked)_ 10. Auto-attribute `contactId` on the gift — needs [PLAN-stripe.md](PLAN-stripe.md) step 4. 11. Saved payment methods tab — needs step 7. 12. Recurring management from the Me page — needs step 7.

Phases 1–4 have **no Stripe dependency** and deliver the whole recognition experience. Phase 5 can
only start once online giving exists.

---

## 9. What this deliberately does not do

- **Widen the privacy wall.** No unpublished records, no protected fields. Signed-in visitors see
  the same public content as anonymous ones plus their own data
- **Server-render anything personal on a cacheable route**
- **Require an account to give.** Anonymous giving stays a first-class path
- **Build multi-org.** It only makes sure nothing has to be undone to add it — org comes from the
  slug everywhere, and `unique(orgId, authUserId)` already permits the shape
- **Claim past anonymous gifts**
- **Personalize embeds**
- **Show a household.** Dropped in Phase 3 rather than deferred casually: it would be the first
  exception to `model/portal.ts` rule 3, on a surface whose own header notes that a portal session
  lives on a phone that can be taken. It needs a privacy review, not a sprint
- **Give staff an implicit portal.** `resolvePortalViewer` let an admin in without a contact row;
  `resolveSiteViewer` does not, because that exemption read a role from the SESSION's org while the
  contact comes from the URL's. An admin who wants to see their own pages is claimed and linked like
  anyone else — `seed/portal.ts` is how you do that on a dev deployment

---

## 10. Left open

- **`login` and `me` are reserved campaign slugs.** `/{orgSlug}/login` and `/{orgSlug}/me` match
  before `/{orgSlug}/[campaignSlug]` (verified in the built manifest), so a campaign slugged either
  is silently shadowed. Campaign-slug validation is where a guard belongs; filed separately
- **`givingForRecord` scans 500 gifts with no `truncated` flag**, so a donor past that sees an
  understated total. Donor-first scanning is deliberate — starting from `allocations.by_projectId`
  would read every supporter's giving to a popular record to find one person's
- **No `convex-test`.** Deviates from `guidelines.md`, on evidence: Better Auth is a local component
  install whose adapter transitively imports the app's whole auth and email stack, so faking a
  session means registering two components. The decisions live in `lib/domain/` and are tested there
- **Adding a Convex module requires `npx convex codegen`.** Neither `tsc -p src/convex/tsconfig.json`
  (which excludes `_generated`) nor svelte-check catches a stale API map until something imports it

---

## Sources

Planning Center Church Center: [basics](https://help.planningcenter.com/en/140932-church-center-basics.html) ·
[log in](https://help.planningcenter.com/en/141275-log-in-to-church-center.html) ·
[the Me page](https://help.planningcenter.com/en/141278-use-the-me-page.html) ·
[find your church](https://help.planningcenter.com/en/141274-find-your-church.html) ·
[check in](https://help.planningcenter.com/en/141279-check-in-with-church-center-app.html)
