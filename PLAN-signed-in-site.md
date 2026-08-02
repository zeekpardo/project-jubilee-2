# The signed-in public site

Bringing the portal onto the public pages: a donor who is logged in is recognized wherever they
browse, sees their own giving in context, and gives without re-entering who they are.

Inspiration is Planning Center's Church Center — one org-scoped surface where the public pages and
the "Me" page are the same place, and signing in changes what you see rather than where you are.

Extends [PLAN-portal.md](PLAN-portal.md). Depends on [PLAN-stripe.md](PLAN-stripe.md) for the last
phase only.

---

## Key risks

**1. Cache poisoning.** [(site)/+layout.server.ts:32](svelte/src/routes/(site)/+layout.server.ts:32)
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

| Question | Answer |
| --- | --- |
| Multi-org | Not yet — but org resolves from the URL slug from day one, so it's additive later |
| What signed-in adds | Same public content + signed-in chrome + their own giving in context |
| Unpublished records / protected fields | **No.** The wall's guarantees are unchanged |
| Surface | Merged, Church Center style — the portal moves under the org slug |
| Personalization transport | Client-side reactive Convex query |
| Sign-in | Org-scoped `/{orgSlug}/login`, magic link by email |
| Anonymous giving | Still fully supported; sign-in is a shortcut, never a gate |
| Cross-org visitor | Treated as anonymous |
| Me page tabs | Real routes |
| Giving in context | Amount + date, on project and campaign pages |

---

## 1. URL shape

```
/{orgSlug}/                              public campaign index        anonymous
/{orgSlug}/{campaign}/{objects}/         public listing               anonymous
/{orgSlug}/{campaign}/{objects}/{n}/     public record                anonymous
/{orgSlug}/login                         org-branded magic link       anonymous
/{orgSlug}/me                            Me overview                  SIGNED IN
/{orgSlug}/me/giving                     giving history               SIGNED IN
/{orgSlug}/me/stories                    records they're part of      SIGNED IN
/{orgSlug}/me/tasks                      their tasks                  SIGNED IN
/{orgSlug}/me/household                  household members            SIGNED IN
/{orgSlug}/me/profile                    contact details              SIGNED IN
/{orgSlug}/me/preferences                notification + contact prefs SIGNED IN
/{orgSlug}/me/payment-methods            saved cards                  SIGNED IN — Stripe-gated
```

`/portal/*` is retired; its four existing routes relocate under `/{orgSlug}/me/*`.

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

> **Verify before building anything else.** Two route groups both declaring a `[orgSlug]` segment is
> the one structural assumption here that could fail. Different final paths should be fine — the
> conflict rule is about two files resolving to the *same* URL — but confirm with a trivial spike.
>
> **Fallback if SvelteKit objects:** keep one `(site)` group and add an explicit `isGatedSitePath`
> matcher in `hooks.server.ts` for `/[^/]+/me`. This is strictly worse — it's an allowlist with a
> hole punched in it rather than a structural guarantee — so only take it if the spike fails.

`/{orgSlug}/login` stays in `(site)`: it must be reachable while signed out.

---

## 2. Data model

**No new tables.** Everything needed exists.

| Field | Table | Role |
| --- | --- | --- |
| `authUserId` | `contacts` | The account↔contact link. Already uniquely indexed per org |
| `portalAccess` | `contacts` | `invited` / `active` / `revoked` |
| `emailLower` | `contacts` | Claim-by-email on first sign-in |
| `slug` | `orgSettings` | Org resolution from URL. Globally unique |
| `contactId` | `transactions` | Giving history |
| `campaignId`, `projectId` | `allocations` | Giving *in context* |
| `preferredContact`, `transparency` | `contacts` | Preferences tab — fields exist, no UI today |
| `householdId` | `householdMembers` | Household tab — tables exist, no portal surface today |

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
  orgId: string;           // from orgSettings.slug — NEVER from the session
  userId: string;          // from the session — NEVER from an argument
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

| Thing | Where | Use |
| --- | --- | --- |
| `portalGiving(ctx, viewer)` | `model/portal.ts:193` | Giving tab, and the basis for in-context |
| `portalConnections(...)` | `model/portal.ts:308` | Stories tab |
| `toPortalRecord(...)` | `model/portal.ts:403` | Story detail |
| `toPortalProfile(...)` | `model/portal.ts:115` | Profile tab |
| `toPublicProject` / `toPublicCampaign` | `model/public.ts` | Public pages, untouched |
| `PortalNoAccess.svelte` | `(portal)/portal/` | Relocates with the rest |
| `formatCents` | `$lib/features/money/format` | Never format money inline |
| `useQuery(api.x, () => cond ? args : 'skip')` | app-wide | The gating idiom for every viewer read |

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
export async function resolveSiteViewer(
  ctx: QueryCtx,
  orgSlug: string
): Promise<SiteViewer | null>;
```

`portalGiving` and friends take `{ orgId, userId, contact }`, so a `SiteViewer` satisfies them
directly — no changes to the projection.

**New for in-context giving.** Do **not** ship `portalGiving`'s 500 gifts to the browser to compute
one number. Add a focused query returning a small aggregate for the record being viewed:

```ts
export const getMyGivingForRecord = query({
  args: { orgSlug: v.string(), campaignSlug: v.string(), projectNumber: v.optional(v.string()) },
  // -> { totalCents, giftCount, lastGiftOn } | null
});
```

---

## 4. State design

No Zustand, no TanStack. State here is Svelte context plus Convex reactivity.

**New context** — `createSiteViewerContext` / `setSiteViewerContext` / `getSiteViewerContext`,
matching the existing triple in `src/lib/access/context.svelte.ts`.

| | |
| --- | --- |
| **Single responsibility** | Who the viewer is *for the org whose page we're on*, and nothing else |
| **Owns** | `viewer \| null`, `isLoading`, the org slug it resolved against |
| **Does NOT own** | Staff capabilities (`getAccessContext()` — leave alone, it's a different question), theme/campaign context, any public page data |
| **Must not affect** | The anonymous render path. A signed-out visitor's HTML is byte-identical to today's |

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
└── giving | stories | tasks | household | profile | preferences | payment-methods
```

### Scroll

The Me shell follows `(portal)`'s existing layout: page-level scroll, tab strip sticky at top on
mobile. Tab panels do **not** get their own scroll container — nested scroll inside a page that also
scrolls is the overflow bug this codebase has avoided so far.

### Forms

**DonationForm** — field order unchanged. Two additions:

| State | Behavior |
| --- | --- |
| Anonymous | Exactly as today, plus a quiet "Sign in for faster giving" link above the name field |
| Signed in | `name` and `email` prefilled from the contact, editable, with "Not you?" to clear |
| Signed in | Gift carries `contactId` so history is exact rather than email-matched |

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

| Scenario | What the user sees |
| --- | --- |
| Anonymous, any public page | Today's page exactly, plus a "Sign in" link in the header |
| Signed in, viewer loading | Public page renders immediately; account slot holds a small skeleton. Never blocks content |
| Signed in, no gifts to this record | `YourGivingNote` renders nothing |
| Me page, no giving yet | "You haven't given yet" + a link to the org's campaigns |
| Me page, no stories | "You're not connected to any stories yet" |
| Viewer query fails | Fall back to the anonymous view silently. A broken personalization query must never break a public donation page |
| `/me` at an org with no contact | **307 → `/{orgSlug}/`** |

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
[(portal)/portal/+layout.server.ts](svelte/src/routes/(portal)/portal/+layout.server.ts) with
`orgId` from the session's active org. It now takes `orgId` **from the slug**, and runs on first
load of any `(me)` route. Its compare-and-set on an unlinked contact is unchanged — this is a change
of *source*, not of logic.

---

## 7. Edge cases

| Case | Behavior |
| --- | --- |
| **Signed in at org A, browsing org B** | Anonymous at B. `resolveSiteViewer` returns null; no chrome, no prefill, no giving note. Giving still works, as a stranger |
| **`/{orgSlug}/me` at a non-member org** | 307 to `/{orgSlug}/`. Reveals nothing about whether an account exists |
| **Unknown org slug** | 404, as today. Identical for signed-in and anonymous |
| **Access revoked mid-session** | `portalAccess === 'revoked'` is checked on **every read**, so the next query drops them to anonymous. No sign-out needed |
| **Contact deleted while signed in** | Viewer resolves null → anonymous. `model/cascade.ts` already clears `transactions.contactId` on contact delete, so the ledger survives |
| **Staff member on the public site** | Resolves through the same path. Staff who are also contacts see their own giving; staff who aren't see nothing. Capabilities are irrelevant here — this surface grants nothing |
| **Anonymous gift, later signs in** | Gift stays unattributed unless the email matches at claim time. Explicitly **not** building a claim-my-past-gifts flow now |
| **Same email, two orgs** | Two separate contacts, two separate `authUserId` links, one account. Already legal under `unique(orgId, authUserId)` — this is the multi-org seam |
| **Embed routes** | Never personalized. No account menu, no giving note, no viewer context. Enforced by the context living in `(site)`'s layout, which `(embed)` does not inherit |
| **Navigating away mid-profile-edit** | Existing portal behavior, unchanged |
| **Prefill vs typed input** | Prefill sets initial value only. Form keyed on contact id so identity change remounts |
| **Bulk operations** | None. Every write on this surface is the viewer's own single record |

---

## 8. Implementation order

**Phase 1 — the seam** *(nothing user-visible)*
1. Spike the two-route-group question (§1). Resolve before anything else.
2. `resolveSiteViewer(ctx, orgSlug)` in `model/identity.ts`, plus its unit tests — including the
   signed-in-at-A-browsing-B case.
3. `getSiteViewer` and `getMyGivingForRecord` queries.

**Phase 2 — recognition**
4. Site viewer context + `SiteAccountMenu`, client-only.
5. `/{orgSlug}/login`, org-branded, magic link, with `redirectTo`.

**Phase 3 — the Me page**
6. Relocate `/portal/*` → `/{orgSlug}/me/*` under the `(me)` group. Move `claimPortalContact` to
   slug-sourced org. No behavior change beyond the URL.
7. `MeTabs`, and the new household and preferences tabs.

**Phase 4 — giving**
8. `YourGivingNote` on project and campaign pages.
9. `DonationForm` prefill + sign-in shortcut.

**Phase 5 — Stripe-gated** *(blocked)*
10. Auto-attribute `contactId` on the gift — needs [PLAN-stripe.md](PLAN-stripe.md) step 4.
11. Saved payment methods tab — needs step 7.
12. Recurring management from the Me page — needs step 7.

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

---

## Sources

Planning Center Church Center: [basics](https://help.planningcenter.com/en/140932-church-center-basics.html) ·
[log in](https://help.planningcenter.com/en/141275-log-in-to-church-center.html) ·
[the Me page](https://help.planningcenter.com/en/141278-use-the-me-page.html) ·
[find your church](https://help.planningcenter.com/en/141274-find-your-church.html) ·
[check in](https://help.planningcenter.com/en/141279-check-in-with-church-center-app.html)
