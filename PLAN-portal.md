# Plan — the client portal

**Goal:** a signed-in surface for people who are not staff — a sponsor, a family
member, an attendee, a volunteer — where they see only what pertains to them:
their tasks, their giving, the records and campaigns they are connected to.

Two research passes fed this: the reference app's shipped portal
(`next-shadcn-dashboard-starter`), and an audit of what this codebase already
has. Both are cited throughout. Where the reference got something wrong, that is
said plainly — it is the more useful half of what it teaches.

---

## 0. Read this first: the portal cannot ship on today's authorisation

**The capability matrix is enforced in three Convex modules out of nineteen.**

`requireCapability` appears only in `access/mutations.ts`, `campaignMembers/
mutations.ts` and `tasks/mutations.ts`. Every other mutation module gates on
`requireOrgId`, whose entire check is "is there a session, and does it have an
active organization". No role. No capability. No campaign scope. The read side
is the same: `activeOrgId` gates contacts, transactions, allocations, budgets,
projects, households, custom fields, documents, templates and stages.

This is sound **today** only by accident of population: every role that can
reach `/app` is trusted staff, and `member` is a role nothing hands out. So
"authenticated org member" and "trusted staff" are currently the same set, and
`requireOrgId` happens to be a correct authorisation check.

A portal member is **the first role that is an org member and not trusted.**

The moment such a session exists, `updateContact`, `createTransaction`,
`deleteProject`, `listContacts` and ~110 other functions become directly
callable from a browser console. `contacts.medicalNotes` — which the schema
itself flags as "must never reach a public query, the same way
projects.siteRef must not" — is readable by `listContacts` behind
`activeOrgId` alone. The privacy wall protects it from anonymous visitors.
Nothing protects it from an authenticated org member.

`permissions.ts` opens by claiming "both the Convex functions and the UI decide
access from the same rules." For most of the backend, the Convex functions do
not. The matrix has been a UI-shaping layer.

**Therefore: Phase 1 is authorisation hardening, and no portal identity may be
granted a membership before it lands.** This is not sequencing preference. An
invited user receives a membership *before* any portal code runs, so the
exposure opens at invitation time, not at first portal page load.

Two holes to fix while in there, both already live:

- `listProjectsForContact` (`projectMembers/queries.ts:33-60`) has **no
  capability check at all** and takes an arbitrary `contactId`, returning that
  contact's project links with every joined project document spread whole.
- The same "takes any contactId, never checks it is yours"
  shape appears in `listDonationsForContact`, `getCampaignInvolvement` and
  `listHouseholdsForContact`. Those at least require a staff capability; they
  become portal-dangerous the moment a portal twin is written by analogy.

---

## 1. What the reference teaches

Its portal shipped and is complete: three pages at `/portal`, backed by
`/api/portal/*`. Take these two ideas; leave the rest.

### Keep: the scoping invariant

> "getCurrentSponsor() resolves the sponsor row from the SESSION — never from a
> client-supplied id. Every other function takes a `sponsorId` that the caller
> MUST have obtained from getCurrentSponsor()."

Every portal route obeyed it. Nothing accepted an id from a body or a path.
This is the single rule that made their portal safe, and it is worth stating in
the same words in ours.

### Keep: connection is a FILTER over public data, not a widening of it

> "A donor sees a family exactly as an anonymous visitor would, plus the giving
> that is genuinely theirs."

Their sponsored-families list unions pledge and allocation project ids, then
**filters the public card list** by them. The public projection stays the
source of truth for the record; the relationship only decides which cards
appear.

This dissolves the "third tier" worry. There is no third tier of *record* data
for a sponsor. There is public data filtered, plus a separate personal tier
that is only ever the viewer's own — their giving, their profile, their
messages, their tasks.

*(A family member seeing their OWN record is a genuine second projection —
see §4.)*

### Do not copy: the role gate, which never fired

`resolveRole()` returns `'admin'` for every signed-in user with no org role,
because Clerk Organizations were never enabled. `isSponsor()` is exported and
called nowhere. The middleware redirect confining donors to `/portal` has
almost certainly never executed in production.

Port the shape without the configuration and you ship a confinement rule that
silently does nothing. **Fail closed instead**: unknown → portal, staff access
requires an explicit grant.

### Do not copy: access as identity rather than role

Their data layer has no authorisation check — only identity resolution.
`getCurrentSponsor()` returns *any* contact with a login: a donor, a family
member, a newsletter subscriber. The `campaignMemberships` role that supposedly
defines "sponsor" is never consulted. Every access decision rides on "does this
contact have a login".

**Decide deliberately whether portal access is identity or role, and enforce it
in one place.** This plan says: both. Identity says *who you are*; role says
*which surface you may reach*; connection says *which rows*.

### Do not copy: `portal-preview`

`GET /api/sponsors/[id]/portal-preview` renders another person's entire portal
from a **path id**, bypassing the never-a-client-id invariant. It is
`isAdmin()`-gated — but since everyone is an admin, it is reachable by anyone
who can guess a UUID, and it returns home address, email and full giving
history. If we want staff to see what a donor sees, build it from the same
session-resolved path with an explicit, audited impersonation, or not at all.

---

## 2. `transparency` is a mailing preference, not a permission

`contacts.transparency: 'summary' | 'full'` is in our schema already, inherited
from the retired `sponsors` table, **with its name and none of its behaviour**.

In the reference it gates exactly two things: whether two transactional email
templates include progress numbers, and a newsletter audience filter. The
donor-facing label is *"How much you'd like to hear"*, options *"Just
outcomes"* / *"Every detail"*.

Nothing in their portal reads it. Nothing in ours reads it either — the audit
confirms it is displayed and editable but no code branches on its value.

**A designer seeing `summary | full` on a contact will build a two-tier portal
that never existed.** Rename it `updateDetail` (or `emailDetail`) as part of
this work, so the next person cannot mistake a comms preference for an access
level. `preferredContact` is equally inert and can stay as-is; its name does
not lie.

---

## 3. The privacy wall is precedent, not reusable code

The audit is unambiguous, and this is the structural decision the whole plan
turns on.

`model/public.ts` is **anonymous by construction, not by policy**. Every
function takes `(ctx, doc)` and never touches identity. `public/queries.ts`
never calls `activeOrgId` or `getAccess`. Its callers reinforce it — the
`(site)` and `(embed)` layouts each create the Convex client with no token,
"deliberately". There is no seam to pass a viewer through, and adding one means
the "no database document is ever spread" guarantee holds only *conditionally*
— which is the exact property the module exists to make unconditional.

Worse, the entities a portal is *for* are on its NEVER-EXPOSED list:
`donor/contact PII, donation amounts, or donor-to-project links`. A portal read
is not a loosening of a dial; it is the direct inverse of a stated rule. And
records are addressed by `number`, never by id — a portal joining
`allocations.projectId` has an id and no wall entry point that accepts one.

**So: a new `convex/model/portal.ts`, built as a sibling with the same
discipline, not a parameterised wall.** It is an allowlist, it builds every
object field by field, it never spreads a document, and it carries its own
header stating who may read what. Where it wants a public card it *calls* the
wall rather than reimplementing it.

One inherited-by-accident hazard to avoid: `loadPublicPolicy` is called *inside*
`toPublicProject` — "loaded here rather than passed in so no caller can forget
it." A portal projection that bypasses `toPublicProject` also bypasses the
per-org policy silently. Either route portal record reads through the wall's
own helper, or load the policy explicitly and say why.

Note the count threshold is meaningless for a portal user looking at their own
family. Reusing the wall would inherit a suppression rule that does not apply
to the tier — another reason the projection is separate.

---

## 4. The model

### Identity — already built, entirely unwired

`contacts.authUserId` is declared, uniquely indexed `unique(orgId, authUserId)`,
and **nothing writes it**. `linkAuthUser`, `unlinkAuthUser` and `markInvited`
exist in `contacts/mutations.ts` and have zero callers.
`getContactByAuthUserId` has zero callers. `invitedAt` is written by nothing and
read by one badge that can never fire.

`resolvePersonIdentity` (`model/taskViews.ts`) already resolves either half of a
person to the other, and its docstring already anticipates this:

> "A contact id that names nothing, or a row in another org, resolves to just
> the id it was given — never to a person. Widening on bad input is the one
> failure mode that shows someone else's work."

That is the portal's identity resolver. It should move to a module of its own
rather than living under task views, and stay the single place the comparison
is written.

### Access state — explicit, not inferred

The reference infers access from `invitedAt != null` + `clerkUserId != null`,
with all lifecycle inside Clerk: no expiry it owns, no revocation short of
deleting the user, no way to answer "is this invite still valid" from its own
data. On Convex we build it ourselves, so build it properly:

```ts
portalAccess: v.optional(v.union(
  v.literal('invited'),    // invite sent, not yet accepted
  v.literal('active'),     // signed in and linked
  v.literal('revoked')     // access withdrawn; the row and its history stay
))
```

Revoked is a state, not a deletion — withdrawing access must not erase the
person or their giving.

### Roles

The product owner's roadmap, from this session:

| Role | Reach |
|---|---|
| `owner` | everything |
| `admin` | no billing, subscriptions, org settings |
| `campaign_manager` | specific campaigns |
| `team_leader` | scoped to a campaign, cannot change important details |
| `portal_member` | only the items they are part of |

The audit's assessment: the three-bucket structure in `permissions.ts` is
additive and `campaign_manager` is roughly six lines. **The problem is that
`can()` early-returns `true` for owner at line 80 and admin at line 84, before
consulting the capability list at all.** Any new capability is therefore
automatically granted to every admin — fine for staff capabilities, wrong for
portal-shaped ones. `portal:viewOwnGiving` would be silently true for every
admin.

So the matrix needs a per-role grant table, or portal capabilities need to live
outside `can()` entirely. Prefer the latter: **a portal read is not a capability
check, it is an ownership check.** `can()` answers "may this role do this
here"; the portal asks "is this row mine", which is a different question and
should not be forced through the same function.

Also note `settings:manage` is misnamed — it gates the campaign settings page
and sharing a saved task view, not billing. Renaming it is cheap now and
confusing later.

### A person can be both

`unique(orgId, authUserId)` allows one contact per user per org, so a staff
member who is also a donor is representable. But `getAccess` resolves exactly
one role and `resolvePersonIdentity` exactly one identity — "which surface am I
in" has no representation today. Decide: the surface is a property of the
*route*, not the person. Staff visiting `/portal` see their own donor view;
`portal_member` visiting `/app` is redirected. That keeps it out of the
identity model.

---

## 5. Surfaces

Route group `(portal)`, a sibling of `(site)` and `app/`. It inherits
authentication automatically from `hooks.server.ts` (an unmatched route id
requires auth — fail-closed by design) and inherits `frame-ancestors 'none'`
correctly. What it does **not** inherit is any server-side role gate: today
`app/+layout.svelte` guards with a client-side `{#if}` and the queries
underneath are the real protection. Phase 1 fixes that; the portal must not
repeat it.

| Page | Shows | Source |
|---|---|---|
| `/portal` | greeting, their connections, their giving summary | new `model/portal.ts` |
| `/portal/giving` | their donations, per-record allocations, lifetime total | portal twin of `listDonationsForContact` |
| `/portal/records` | the records they are connected to, as public cards | wall cards, filtered by connection |
| `/portal/tasks` | tasks assigned to them | portal twin of `listTasks` |
| `/portal/profile` | their own details, editable on a whitelist | new |

**Tasks are the closest to ready and the reference has nothing to copy** — its
portal has no tasks surface at all. Our assignee model was designed for this:
`types.ts` already says "a client in the future portal has only a contact
record". But `listTasks` scopes by *campaign* then filters by person; a portal
query scopes by *person* first, and `tasks` has no assignee index — the schema
says why: "that field is optional and polymorphic, so it cannot carry a useful
index of its own." Either add a narrow index for the portal's access path or
accept a bounded scan; decide with numbers, not by assumption.

**A family member seeing their own record** is the one genuine second
projection. The reference's `getCurrentSubjectProject` returns the *unscrubbed*
family name and story deliberately, because it is the viewer's own record. Ours
should do the same — and that is precisely why it cannot be the public wall
with a flag.

---

## 6. Invitations

Magic link, which is already enabled (`auth.constants.ts`: `magicLink: true`).
A donor should never be given a password.

Flow: admin invites a contact → `portalAccess: 'invited'`, `invitedAt` stamped
→ magic link sent → on first sign-in, the contact is claimed.

**Claim by compare-and-set, on an UNLINKED contact only.** The reference got
this right and said why:

> "claims only an UNLINKED contact, so one Clerk account can never hijack
> another's already-linked contact"

Our `assertAuthUserAvailable` already enforces the other direction (one auth
user cannot link twice). Both halves are needed.

Stamp `invitedAt` in the shared helper, not the route — the reference stamps it
on one of its two invite paths and not the other, so a contact invited by the
second route shows no "Invited" badge.

---

## 7. Privacy rules

1. **Never a client-supplied identity.** Every portal read resolves the viewer
   from the session. A `contactId` argument is only ever accepted when the
   handler asserts it equals the resolved viewer's — and then it is redundant,
   which is the point.
2. **Connection filters public data; it does not widen it.** A sponsor's record
   cards are wall cards, filtered.
3. **Own-record reads are a separate projection** with their own allowlist, not
   a flag on the public one.
4. **Personal data is only ever the viewer's own** — giving, profile, tasks,
   messages. No portal read returns another person's row, ever.
5. **Revocation is immediate and total**, checked on every portal read rather
   than at sign-in.
6. **Email is inside the wall.** The reference's portal shows "The Ahmed
   family" while its transactional email prints the full legal name — outside
   the `transparency` branch, so every donor gets it. If we send email about a
   record, it obeys the same projection the screen does, or we decide otherwise
   in writing.

---

## 8. Work, in order

1. **Authorisation hardening.** Convert ~110 `requireOrgId`/`activeOrgId` call
   sites across 26 modules to `requireCapability`/`getAccess`+`can`, threading a
   `campaignId` where the capability is campaign-scoped. Close
   `listProjectsForContact`. **Nothing else in this plan may ship first.**
2. **Roles.** Add `campaign_manager` and `portal_member` to `permissions.ts`,
   `org-roles.ts` and Better Auth's stored memberships — a three-way deploy
   ordering constraint, because `getAccess` treats an unrecognised role as no
   access. Fix the owner/admin blanket-true problem before adding any
   portal-shaped capability.
3. **Identity.** Wire `linkAuthUser` / `markInvited`; move
   `resolvePersonIdentity` out of task views; add `portalAccess`; rename
   `transparency`.
4. **`model/portal.ts`** — the projection, with its own header contract.
5. **Invitations** — magic link, claim-on-first-signin, admin UI.
6. **`(portal)` route group** — server-side role gate, then the pages in the
   order of §5. Tasks first: the identity plumbing already exists.
7. **Staff view of a donor's portal**, if wanted — designed deliberately, not
   as `portal-preview` was.

---

## 9. Out of scope, noted

- **Payments.** The reference's pledge flow creates an `interested` row and
  stops; no payment processing exists there and none is planned here yet.
- **Chat.** The reference has donor↔staff messaging. Worth having, but it is a
  feature in its own right, not part of standing the portal up.
- **Forms, itinerary, attendee trip management** — named in the reference's own
  generalisation doc as "the missions differentiator" and never built.
