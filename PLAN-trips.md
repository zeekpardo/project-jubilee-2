# Trips

Some campaigns are run as missions trips: a group of the organization's own people travels somewhere,
on dates, with flights, to do the campaign's work — and while they are there they visit some of the
campaign's records.

A campaign has many trips. A trip may name several projects. A person may go on several trips in the
same campaign.

The scheduling is the easy part. The part worth designing carefully is that this feature puts **two
different kinds of people on the same record**, and this schema currently has no way to tell them
apart. See §1 — everything else follows from it.

Extends [PLAN.md](PLAN.md), [PLAN-tasks.md](PLAN-tasks.md), and
[PLAN-impact-stats.md](PLAN-impact-stats.md).

---

## Decisions

| Question                             | Answer                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------- |
| Trip belongs to                      | A **campaign**, always. Never org-level, never a project                     |
| Trip ↔ project                       | **Many-to-many** link table. A record can be visited on next year's trip too |
| Who is on a trip                     | `contacts`, same as everywhere. A link row, never a second person table      |
| Served vs. serving                   | A **`side` column on the link**, not on the person — §1                       |
| Which link gets `side`               | **`projectMembers` only.** Not `campaignMemberships` — §1                     |
| Trip attendee uniqueness             | `(tripId, contactId)`. **Not** `(campaignId, contactId)` — §4                 |
| Leaders                              | An `isLeader` flag on the attendee row, plus free-text `role` — §4            |
| Flights                              | Child table of **legs**, not two columns on the trip — §5                     |
| Flight times                         | **Local wall clock + IANA zone**, not epoch ms — §5                           |
| Per-person legs                      | **In v1**, as duplicate-and-edit off the group itinerary — §5                 |
| Travel readiness (passports etc.)    | **A checklist, not stored documents.** Reuses `tasks` — §6                    |
| Trip money                           | **Planned budget only.** Actuals are a documented integration — §7            |
| Trip name                            | Prefilled `{Campaign} — {Project} — {startOn}`, editable — §15                |
| Public surface                       | **None.** Trips are internal-only — §12                                       |
| New capability                       | **No.** Reuses `projects:read` / `projects:write` — §9                        |
| Custom fields on trips               | Not in v1 — §17                                                               |
| Portal visibility for `team` people  | **Open.** The one call site §8 deliberately does not touch — §14.1            |

---

## 1. The two kinds of people

The requirement, in the user's own words: _"we need to be able to distinguish a person in the project
that is part of the project (being helped) and a person that is attending the trip as a part of the
organization."_

This schema already puts both on `projectMembers`, and already cannot tell them apart. The role
column's own comment lists the vocabulary — `team_lead | leader | attendee | member | volunteer` —
which is the served and the serving side in one free-text field.

That is not a cosmetic problem, because something already reads it and counts:

```ts
// lib/domain/campaign-stats.ts:42
const DONOR_ROLES = new Set(['sponsor', 'donor']);
export function isPersonReachedRole(role: string): boolean {
	return !DONOR_ROLES.has(role.trim().toLowerCase());
}
```

The comment above it says the quiet part: _"this is a denylist: an unrecognized role describes
someone the project serves or involves, and only a donor role is excluded."_ So a volunteer put on a
record today counts as **a person that record reached**, and lands in the campaign's published
`people_reached` tile. Trips do not create that bug. Trips make it systematic — the whole point of a
trip is to attach a dozen of the organization's own people to a handful of records at once.

### Where the distinction goes

Not on `contacts`. The schema is explicit that _"a contact's identity is campaign-agnostic"_, and it
is right: the same person can be a beneficiary of one campaign and a volunteer on another campaign's
trip. A column on the person would force one answer for both.

Not derived from `role`. It is free text so a campaign can use its own vocabulary, which is exactly
why no code should have to recognize `"Team Lead"`, `"team_lead"`, and `"Site Coordinator"` as the
same side of the work.

So it goes **on the link**, as a small closed union:

```ts
// projectMembers, new column
//
// Which side of the work this person is on. `served` is the family the campaign
// exists for; `team` is the organization's own people — the staffer, the
// volunteer, the trip goer standing in the photograph.
//
// Absent means `served`, deliberately: every row written before this column
// existed was entered as a person on a record, and reading those as `team`
// would silently drop them out of an already-published impact number. New rows
// are written explicitly, so the ambiguity has a shrinking lifetime.
side: v.optional(v.union(v.literal('served'), v.literal('team')));
```

`served` / `team` rather than `served` / `serving`: two words one letter apart read identically at a
glance, and this value will be compared in a condition that changes a public number.

`DONOR_ROLES` stays. It is now the fallback for rows with no `side`, not the mechanism — see §8.

**`campaignMemberships` does not get this column. Decided, not deferred.** Its roles (`sponsor |
attendee | lead | staff`) carry the same ambiguity — "attendee" of what, exactly — but nothing counts
campaign memberships toward an impact number, so there the ambiguity is a display label and not a
wrong figure. `side` exists to stop a number being wrong, and is added only where a number can be
wrong.

The standing note, because this is the kind of decision nobody remembers was one: **if anything ever
counts `campaignMemberships` toward a published stat, it inherits this exact bug**, and the fix is
this same column on that table.

---

## 2. Data model

Four new tables, one new column on `projectMembers`, one new optional column on `campaigns`.
Checklists (§6) and money (§7) add three more deltas, described in their own sections.

```ts
// A trip: people from the organization travelling somewhere, on dates, to do a
// campaign's work.
const trips = defineTable({
	orgId: v.string(),
	campaignId: v.id('campaigns'),

	// A trip needs a handle that survives the destination being renamed and two
	// trips going to the same country. Prefilled by the create dialog; the value
	// is the user's from then on — see §15.
	name: v.string(),

	// ISO YYYY-MM-DD, for the same reason tasks.dueOn is: a trip that runs
	// Dec 1–14 runs those days for everyone reading the page. Epoch ms would
	// start it on Nov 30 for half of them.
	startOn: v.string(),
	endOn: v.string(),

	// Freeform — "Pakistan", "Lahore, Pakistan", "Northern Thailand". A heading,
	// not a geocode: no place table survives the first trip to somewhere it does
	// not list, and this app's destinations are exactly the places a gazetteer
	// is thin on.
	destination: v.string(),
	// Two-letter ISO, optional, for grouping and flags only. Never required —
	// a trip can be domestic, or to a place whose code is politically contested.
	countryCode: v.optional(v.string()),

	status: v.union(
		v.literal('planning'),
		v.literal('confirmed'),
		v.literal('completed'),
		v.literal('cancelled')
	),

	summary: v.optional(v.string()),
	notes: v.optional(v.string())
})
	.index('by_campaignId', ['campaignId'])
	// The trip list is "soonest first" on both pages, so the common read is in
	// index order rather than a sort in the handler.
	.index('by_campaignId_and_startOn', ['campaignId', 'startOn'])
	.index('by_orgId_and_startOn', ['orgId', 'startOn']);
```

```ts
// Trip <-> project. Many-to-many: one trip visits several records, and the same
// record is visited again on next year's trip. Association is optional in both
// directions — a trip may exist before anyone has decided which families it
// reaches, and most records are never visited at all.
const tripProjects = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	projectId: v.id('projects'),
	// "Half day, morning only" — trip-specific, so it belongs on the link.
	note: v.optional(v.string())
})
	// unique(tripId, projectId)
	.index('by_tripId_and_projectId', ['tripId', 'projectId'])
	.index('by_tripId', ['tripId'])
	.index('by_projectId', ['projectId']);
```

```ts
// Who is going. The organization's own people — the `team` side of §1 — which is
// why this table exists at all rather than being more projectMembers rows.
const tripAttendees = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// Carried directly, never reached by traversal — the same choice `tasks` and
	// `updates` make, and for the same reason: the campaign roster reads this by
	// campaign, and a query that had to traverse could pick up a row belonging
	// to another campaign.
	campaignId: v.id('campaigns'),
	contactId: v.id('contacts'),

	// Free text, same as projectMembers.role: "Coordinator", "Translator",
	// "Medic". This is the parenthetical in "Eman Hernandez (Coordinator)".
	role: v.optional(v.string()),
	// A flag rather than role === 'leader', because the Trip Leaders block is an
	// index lookup and `role` is free text an org spells however it likes.
	isLeader: v.boolean(),

	// Where this person is in going, which is a fact about THIS journey and not
	// about them: someone who declined December is still on the March roster.
	status: v.union(
		v.literal('invited'),
		v.literal('confirmed'),
		v.literal('declined'),
		v.literal('cancelled')
	),
	notes: v.optional(v.string())
})
	// unique(tripId, contactId) — see §4
	.index('by_tripId_and_contactId', ['tripId', 'contactId'])
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_isLeader', ['tripId', 'isLeader'])
	.index('by_contactId', ['contactId'])
	.index('by_campaignId', ['campaignId']);
```

`tripSegments` is §5. `tripBudgetLines` is §7.

```ts
// campaigns, new column.
//
// Most campaigns never run a trip, and a Trips tab on every campaign is a tab
// that is empty forever. Optional rather than required so this ships without a
// backfill — same pattern as pipelineStages.countsTowardImpact. Absent = false,
// which is the opposite default to that one because the safe answer differs:
// there, a stage counts unless someone says otherwise; here, a campaign does
// not grow a feature unless someone asks for it.
tripsEnabled: v.optional(v.boolean());
```

---

## 3. Trip ↔ project

Many-to-many, and both sides optional. Three shapes have to work:

- A trip with **no** projects — the itinerary exists in August, the family visits are decided in
  October.
- A trip with **several** projects — the normal case.
- A project on **several** trips — visited in Dec 2024 and again in Dec 2025. A one-to-many link
  from project to trip forbids this, and forbids it silently: the second year's team simply
  overwrites the first year's record of who came.

The link is a plain join row with a note. Nothing about the project changes when it is added to a
trip — in particular the project does **not** gain trip attendees as `projectMembers`. That is the
whole distinction of §1 and undoing it here would defeat the feature.

---

## 4. Attendees, and the key that would break it

_"A person can go on multiple trips in the same campaign."_

That sentence rules out the key this codebase would otherwise reach for. `campaignMemberships` is
keyed `unique(campaignId, contactId, role)` and modelling attendance there — even with `role:
'trip_attendee'` — makes a second trip in the same campaign a duplicate-key error, or worse, an
overwrite of the first trip's roster.

So attendance is keyed to the **trip**: `unique(tripId, contactId)`. A person on three trips has
three rows, each with its own role, leader flag, status, checklist, and flight legs.

**Leaders** are attendees with `isLeader: true`. The requirement renders `Eman Hernandez
(Coordinator)` — a name from the contact, a parenthetical from `role`, and its presence in the Trip
Leaders block from the flag. Three fields, three sources, no string matching.

**Campaign roster.** `listCampaignMembers` already derives campaign membership from two directions —
explicit memberships and project links — with the comment that deriving _"avoids asking anyone to add
them twice and keeps the two from drifting apart."_ Trip attendees become a **third source** in that
same query, surfacing as `viaTrips` next to the existing `viaProjects`. Nobody adds a trip goer to
the campaign by hand, and no `campaignMemberships` rows are written by the trip path.

---

## 5. Flights, and the timezone trap

The requirement reads _"Airline, flight number, departure and arrival time (Roundtrip)"_, which
sounds like six columns on `trips`. It is not, for two reasons.

**Nobody flies to Pakistan on one flight.** It is DFW → DOH → ISB, and back. A single
airline/flightNumber pair is wrong on the first real trip, and the fix — a second set of columns — is
wrong on the first trip with two connections. So: a child table of **legs**, ordered within a
direction.

**Not everyone flies the same legs.** One attendee joins from another city; one stays a week longer
and comes back alone. `attendeeId` is optional on the leg: absent means the group itinerary, present
means that one person's own leg. One table rather than two, because every column is identical and
the trip page renders them in one list.

### Per-person legs are in v1

Deferring them to the notes field fails the one person the itinerary exists for. The coordinator
building the airport pickup list reads legs sorted by arrival time; `notes: "Maria comes in Tuesday
on a different flight"` does not sort, does not group by airport, and is invisible to any arrival
list. The v1 that has this feature and gets it wrong is worse than the v1 that omits it, because
someone gets left at Islamabad International.

But it is **not a second itinerary builder**. The roster row gets a "different flights" action which
copies the group legs onto that attendee, prefilled, and opens the same leg form the group itinerary
uses. One dialog, reused, and the model is already there.

### The times

`tasks.dueOn` is stored as `YYYY-MM-DD` with a comment explaining why: _"a due date is a calendar day,
not an instant: epoch ms would make the same task overdue in Karachi and not in Chicago."_

A flight time is the **opposite** case and needs the opposite treatment. A departure is a real
instant, and it is quoted to a traveller in the departure airport's local time. "Departs 11:55 PM"
means 11:55 PM in Dallas — that is what the boarding pass says, and it is the only rendering that is
never wrong.

Both obvious storage choices fail on their own:

- **Epoch ms alone.** Rendering it back requires the airport's timezone, and this app has no airport
  timezone table. The browser would render it in the *viewer's* zone, so the coordinator in Tulsa
  sees a departure time that appears nowhere on the ticket.
- **Wall-clock string alone.** Renders perfectly, but cannot compute a duration, cannot sort legs
  that cross the date line, and cannot answer "has this flight left yet".

So store both halves of the fact:

```ts
const tripSegments = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// Absent = the group itinerary. Present = this one person's own leg.
	attendeeId: v.optional(v.id('tripAttendees')),

	direction: v.union(v.literal('outbound'), v.literal('return')),
	// Leg order within a direction: DFW->DOH is 0, DOH->ISB is 1.
	order: v.number(),

	airline: v.string(),
	flightNumber: v.string(),
	// IATA, uppercased on write. Optional because a leg can be entered before
	// the routing is known.
	departureAirport: v.optional(v.string()),
	arrivalAirport: v.optional(v.string()),

	// LOCAL WALL CLOCK at the airport, 'YYYY-MM-DDTHH:mm' with NO zone suffix —
	// what is printed on the ticket, and what is rendered verbatim. Never parsed
	// with `new Date()`, which would silently reinterpret it in the server's or
	// the viewer's zone.
	departureAt: v.string(),
	arrivalAt: v.string(),
	// IANA ('America/Chicago'). The half that makes the wall clock computable:
	// durations, ordering across the date line, and "has it left yet" all resolve
	// through this. Optional, because a coordinator typing a ticket at midnight
	// should not be blocked on it — every consumer degrades to displaying the
	// wall clock and declining to compute.
	departureTimeZone: v.optional(v.string()),
	arrivalTimeZone: v.optional(v.string()),

	confirmationCode: v.optional(v.string()),
	notes: v.optional(v.string())
})
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_direction_and_order', ['tripId', 'direction', 'order'])
	.index('by_attendeeId', ['attendeeId']);
```

A pure `lib/domain/trip-itinerary.ts` owns the arithmetic — leg duration, layover, total travel time,
whether an arrival lands the next calendar day, and merging per-person legs over the group set — and
is unit-tested against a real multi-leg Dallas→Islamabad itinerary crossing a +10 hour offset. That is
the file where a timezone mistake would live, so it is the file with tests.

---

## 6. Travel readiness: a checklist, not a document store

The obvious way to track whether twelve people can legally board is to put passport number, expiry,
nationality, and visa status on the contact. **Do not.** Two reasons, and the second is the one that
matters.

The soft reason: those columns are a compliance surface. A passport number in `contacts` is a field
every query, every export, every future integration, and every custom-field screen has to be checked
against forever.

The hard reason: **the app does not need the document, only the fact that someone checked it.**
"Passport valid through 2027-06 ✓, Sarah, 14 Oct" is operationally complete — the coordinator wants
to know the row is green before they book, not to read the number back. Storing the number buys
nothing and takes on everything.

So travel readiness is a **checklist**, and `tasks` already is one.

### What tasks already gives us for free

- `projectId` is **already optional**, and campaign-level tasks already exist — the table does not
  assume a record.
- `assignee` is **already polymorphic**: `{ kind: 'contact', contactId }`. A per-person item is a task
  assigned to that person. No new mechanism.
- `taskTemplates` is **already** campaign-scoped, append-only, exactly-one-active, with a bounded
  inline `items` array — which is precisely _"a template to make it easy to start a new list with the
  items that are needed."_
- `instantiateTasks` is **already additive-only**, keyed on `(projectId, key)`, so syncing twice or
  after a template changes only fills in what is missing. Adding an attendee in November and
  re-syncing is the same operation.
- `dueOn`, `priority`, `status`, `completedBy`, the saved views, the filter bar, the bulk bar, and
  `/app/tasks` all work on the result with no changes.

### The three deltas

```ts
// tasks, new column.
//
// Trip work. NOT mutually exclusive with projectId: "visit the Rahman family"
// is a checklist item on a trip AND about a record, and a task carrying both is
// the one place a trip legitimately feeds an impact tag. The existing rule is
// unchanged and still does the work — writes refuse `impactTag` when projectId
// is unset, because impact stats count DISTINCT projectId.
tripId: v.optional(v.id('trips'));
// + .index('by_tripId', ['tripId'])
// + .index('by_tripId_and_key', ['tripId', 'key'])
```

```ts
// taskTemplates, new column.
//
// Which kind of checklist this version is. Absent = 'project', so every existing
// row keeps its meaning and this ships without a backfill. The exactly-one-active
// invariant widens from (campaignId) to (campaignId, scope): a campaign has one
// active record checklist AND one active trip checklist, and they are different
// lists of different work.
//
// Reading the project-scope template ranges over `scope: undefined` — the same
// explicit-undefined-in-an-index pattern `updates` uses for its campaign-level
// feed, and for the same reason: a post-index filter can return a short page
// while rows remain.
scope: v.optional(v.union(v.literal('project'), v.literal('trip')));
// + .index('by_campaignId_and_scope_and_isActive', ['campaignId', 'scope', 'isActive'])
```

```ts
// taskTemplates.items[], new field.
//
// True when this item is answered once PER PERSON rather than once per trip.
// "Book group lodging" is a trip item; "passport valid 6 months past return" is
// twelve items, one per traveller, and a single shared tick would hide the one
// person who cannot board.
perAttendee: v.optional(v.boolean());
```

### Instantiation

`instantiateTripTasks(ctx, trip)` mirrors `instantiateTasks`, additive-only, and differs in exactly
one place: a `perAttendee` item creates **one task per non-declined attendee**, assigned
`{ kind: 'contact', contactId }`. Dedupe is `(tripId, key)` for trip items and
`(tripId, key, assignee.contactId)` for per-attendee ones — read via `by_tripId` and matched in
memory, which is bounded at tens of items × tens of travellers.

It runs on trip create, on adding an attendee, and from a "sync checklist" action on the trip page.
All three are the same call, because additive-only means running it again is always safe.

### Widening one-active-per-campaign: five sites, one of them a bug if missed

The invariant has a **single enforcement point** — `deactivateOthers` in
`convex/taskTemplates/mutations.ts:9`, whose comment reads _"At most one active version per campaign,
so activating one clears the rest."_ That is the good news: widening it to per-scope is one edit.

It is also the trap. Left scope-blind, **activating a trip checklist silently deactivates the
campaign's record checklist**, and the first symptom is a project created next week with no tasks on
it. `deactivateOthers` must take `scope` and range over the new index.

Four read sites assume the same thing and would otherwise show trip templates in the record-checklist
editor and vice versa:

- `convex/taskTemplates/queries.ts:22, 93, 139`
- `convex/model/tasks.ts:21` — `activeTaskTemplate`, which `instantiateTasks` calls

All five move to `by_campaignId_and_scope_and_isActive`. Project-scope reads range over
`scope: undefined` per the `updates` precedent above; trip-scope reads pin `'trip'`.

### The gap worth naming

`tasks.label` and `tasks.description` are free text, so nothing in the schema stops a coordinator
typing a passport number into a task description. That is a **policy and UI matter, not a
mechanism**: the template supplies the labels, the per-attendee task form leads with a tick and not a
text box, and the field help says what it is for. No denylist can read a sentence — the same thing
`permissions.ts` says about publishing prose.

---

## 7. Trip money — UI now, ledger integration later

Scoped deliberately, because `transactions` and `allocations` are being worked on in another
worktree and this plan must not touch them.

### What ships here

**Planned costs only.** A trip budget is trip-owned data that nothing else reads or writes, so it can
be built in full with zero conflict surface:

```ts
const tripBudgetLines = defineTable({
	orgId: v.string(),
	tripId: v.id('trips'),
	// "Airfare", "Lodging", "Ground transport", "Visas", "Insurance". Free text
	// with a suggested list, not a union: what a trip spends on is the org's
	// business, and a union is a schema change every time.
	label: v.string(),
	// Integer cents, always — the rule the whole ledger follows.
	amountCents: v.number(),
	// True when the amount is PER PERSON and the line total is amount x roster.
	// Airfare is quoted per seat and lodging per bed; a planner multiplying by
	// hand gets it wrong the first time somebody joins the trip, and gets it
	// wrong silently.
	perAttendee: v.boolean(),
	notes: v.optional(v.string()),
	order: v.number()
})
	.index('by_tripId', ['tripId'])
	.index('by_tripId_and_order', ['tripId', 'order']);
```

`lib/domain/trip-budget.ts` — pure, tested — computes the planned total against the confirmed roster
count, and re-computes when the roster moves. It is deliberately shaped like the existing
`lib/domain/budget.ts` so the two read alike.

The trip page gets a **Money** block: the planned lines, the per-person subtotal, the trip total, and
an **Actuals panel that renders an empty state** with the copy "Recorded spending will appear here"
until §7's integration lands. The panel and its layout are built now so integration is a data source
swap, not a design.

### The integration, specified but not built

**Nothing in this worktree edits `transactions` or `allocations`.** For whoever picks it up:

1. **One optional column on `allocations`:** `tripId: v.optional(v.id('trips'))`, exactly parallel to
   the `projectId` already there, plus `.index('by_tripId', ['tripId'])`. An allocation already
   carries `campaignId` required and `projectId` optional; `tripId` is a third, independent
   dimension.
2. **Both may be set.** Money spent on the Rahman family *during* the December trip is
   `{ campaignId, projectId, tripId }` and that is not a contradiction — it is the most informative
   row the ledger can hold. Actuals-by-trip and actuals-by-project both count it, correctly, because
   they are answering different questions.
3. **`deleteTripCascade` CLEARS `allocations.tripId`, never deletes the row.** Identical rule and
   identical reason to `deleteProjectCascade` clearing `projectId`: the money still moved, and the
   ledger total has to survive. The allocation simply stops being trip-attributed.
4. **Model the actuals on `budget-actuals.ts`, but do not expect to reuse it.** That module is pure
   math over `{ budgetItem, amountCents }` rows, which is the right shape — but it reconciles against
   a *project* budget (`templateSnapshot` + `debtCents` + `extras`), and a trip budget is a flat list
   of labeled lines. Trip actuals are the strictly simpler problem. Take two things from it and write
   the rest fresh: the pure-function-with-no-db-imports shape, and the synthetic **"Unassigned"** row
   that untagged expenditure allocations roll into, so the panel still reconciles with every cent
   spent. The query that *feeds* it is the part that genuinely changes — `by_tripId` where
   `model/budgets.ts:115` uses `by_projectId`.
5. **Attendee support-raising is out of scope for both plans.** "Maria raised $1,800 toward her seat"
   is a donation designated to a trip *and* to a person, which is a fourth dimension neither
   `allocations` nor `donationIntents` has. It needs its own decision.

### The one file that will conflict

`svelte/src/convex/schema.ts`. Both worktrees add tables and both edit the `defineSchema({ ... })`
export list at the bottom. The table definitions themselves are disjoint and will merge cleanly; the
export list is a single block that will conflict textually and resolves by keeping both sides. Worth
knowing before the merge rather than during it.

---

## 8. The four call sites, which are not four copies of one thing

`isPersonReachedRole` (§1) is the gate, and the function itself takes one new argument:

```ts
// lib/domain/campaign-stats.ts:45
//
// A row's own `side` decides. DONOR_ROLES survives only as the fallback for
// rows written before the column existed — see §13.
export function isPersonReachedRole(role: string, side?: 'served' | 'team'): boolean {
	if (side) return side === 'served';
	return !DONOR_ROLES.has(role.trim().toLowerCase());
}
```

It has exactly four callers. They look interchangeable and are not: one counts, one **publishes
names**, one **grants access**, one builds a dropdown. Passing `link.side` at all four is mechanical
at three of them and a real decision at the fourth.

| Call site                        | What it actually governs                             | Passing `side` means                                                        |
| -------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| `convex/model/stats.ts:186`      | `loadMembers` — the impact-stat population           | The published number stops counting the team. **This is the headline fix**   |
| `convex/model/public.ts:245`     | A record's public `memberCount` + `memberFirstNames` | See below — this one is worse than a wrong number                            |
| `convex/model/portal.ts:377`     | `ownDetail` — *is this record mine*                  | **An access change. Decide before writing it**                               |
| `convex/campaigns/queries.ts:112`| Facet lists for the stat builder                     | A `team` row stops contributing filter options. Cosmetic, obviously right    |

**`public.ts:245` is the sharpest of the four.** It is not a statistic — it is the public project
page. That filter decides both the household size published for a family *and* which
`publicFirstName` values are listed as members of it. A trip goer on the record today would be
counted as part of that household and, if they have a public first name, **named on the public site
as a member of a family they visited**. That is the §12 privacy argument arriving through a side
door, and it is fixed by the same column.

**`portal.ts:377` is the one to stop at.** `ownDetail` is not counting anything; it decides whether a
signed-in person may see a record's name and story in their portal. Gating it on `side === 'served'`
means a **trip goer with portal access loses visibility of the record they served** — which may well
be right for a beneficiary-facing portal, and is emphatically not a mechanical substitution. It is a
question about who the portal is *for*, and this plan does not answer it. Ship the other three, leave
this call site reading `isPersonReachedRole(link.role)` with a comment pointing here, and decide it
deliberately.

`MemberRow` (`stats.ts:151`) needs no new field: the gate at line 186 runs on the raw
`projectMembers` link, before the row is built, so `side` is already in hand there.

### Consequences worth stating plainly

- A trip goer put on a record no longer inflates `people_reached`, nor a published household size.
- The `member` stat's `filter` dimensions (`householdRole`, `relationship`, `contactField`) are
  untouched — `side` is a gate applied first, not a fourth dimension.
- An org that has already been entering volunteers as project members will see published numbers
  **go down** the first time someone marks a row `team`. That is a correction, not a regression, and
  §13 must not do it silently.
- Task-sourced stats are unaffected. A trip checklist item carries no `impactTag` unless the task
  also names a project (§6), and the existing write-time rule already enforces that.

---

## 9. Access

**No new capability.** Trips are gated on `projects:read` / `projects:write`, campaign-scoped.

`permissions.ts` is explicit that a new capability is granted to nobody until it is written into a
bucket by hand, for every role. Adding `trips:read` / `trips:write` means editing `GRANTS` four times
and deciding a seniority question — may a team leader edit the flights of the trip they are on? —
that nobody has asked. Reusing the project capabilities answers it the way the rest of the app
already answers it: a team leader assigned to the campaign does the campaign's operational work,
including the trip they are on. A campaign manager runs it.

Revisit if an org wants a trip coordinator who touches trips and no records. That is a real role, and
it is a v2 conversation with a real requirement behind it rather than a guess now.

Reading a trip roster still requires `contacts:read` for the person details — the roster query
resolves contacts, so it checks both, exactly as `listCampaignMembers` does.

---

## 10. Cascade

Convex has no foreign keys; `model/cascade.ts` is the single place that knows the delete order. Four
edits, following the rule the file already states — **link rows are deleted, the people and the money
survive**:

- `deleteTripCascade` (new) — `tripSegments`, then `tripAttendees`, then `tripProjects`, then
  `tripBudgetLines`, then trip `tasks` by `tripId`, then the trip. Segments before attendees, or a
  per-person leg outlives the attendee it points at. Once §7's integration lands, this also **clears**
  `allocations.tripId`.
- `deleteCampaignCascade` — trips by `campaignId`, each through `deleteTripCascade`, placed **before**
  the project loop so the project cascade finds no `tripProjects` rows left, the same shape as the
  existing allocations and tasks ordering. Note the existing task sweep by `campaignId` already
  reaches trip tasks; `deleteTripCascade` running first means it finds nothing, which is the pattern
  the file uses throughout.
- `deleteProjectCascade` — `tripProjects` rows by `projectId`. Deleted, not cleared: unlike an
  allocation, a link to a record that no longer exists carries no value.
- `deleteContactCascade` — `tripAttendees` rows by `contactId`, any `tripSegments` whose `attendeeId`
  pointed at them, and their per-attendee checklist tasks. Note the existing sweep already **clears**
  `tasks.assignee` for that contact, so a per-attendee task would otherwise survive as an unassigned
  orphan reading "Passport check — Unassigned"; a per-attendee task whose person is gone is deleted,
  not cleared.

---

## 11. Where it lands

**`/app/trips`** — the working list, filtered by campaign, sorted soonest-first. Alongside
`/app/projects` and `/app/tasks` rather than under `/app/admin`, because a trip is operational work
and `/app/admin` is where the campaign is configured.

**`/app/trips/[id]`** — the trip page:

| Block         | Contents                                                                     |
| ------------- | ---------------------------------------------------------------------------- |
| Header        | Name, dates, destination, status                                             |
| Trip Leaders  | `isLeader` attendees — "Eman Hernandez (Coordinator)"                        |
| Itinerary     | Outbound legs, return legs, per-person deviations folded under their traveller |
| Attending     | Full roster, status, readiness tick count, "different flights" action        |
| Checklist     | Trip-level items, and per-attendee items grouped by person — §6              |
| Money         | Planned lines, per-person subtotal, total, empty actuals panel — §7          |
| Projects      | Linked records, each linking through to the project page                     |

**Campaign detail** (`/app/admin/campaigns/[id]`) gets a `TripsCard` — count, next trip, link in —
rendered only when `tripsEnabled`, and a toggle for `tripsEnabled` on `CampaignGeneralCard`. The
existing task-template editor gains a scope switch for the trip checklist (§6).

**Project detail** (`/app/projects/[number]`) gets a `Trips` row in the overview: which trips visited
this record and when. Not a tab; it is two lines for most records.

**Contact detail** gets trips in the existing tab set, next to campaigns and projects.

New UI lives in `lib/features/trips/`, Convex functions in `convex/trips/` with
`convex/tripAttendees/` and `convex/tripSegments/` beside it, mirroring how `projects` and
`projectMembers` are split today. Strings go in `messages/en.json` behind `m.*` like everywhere else.

---

## 12. Trips are internal

No `isPublished`, no public query, no site route, no embed. Deliberately.

Everything else in this schema that reaches the public site carries an explicit publish gate and a
comment about why — `projects.publicName` exists because _"no rule can tell a given name from a
surname across cultures, and this app's users are endangered by their surname being published"_, and
`updates` splits writing from publishing because _"this app serves people escaping forced labour."_

A published trip page is a **correlation** of exactly the facts those controls keep apart: a country,
a two-week window, the names of the people going, and the records they will visit. Each is
individually mild. Together they say who was visited, where, and when — which is precisely the thing
the rest of this app spends its privacy budget not saying.

If a public "our team went to Pakistan in December" story is wanted later, it already has a home:
write an **update**. That surface has the second-pair-of-eyes publish gate, and prose lets a writer
say what happened without publishing a roster and a visit schedule.

---

## 13. Migration

The new tables need none — nothing exists to backfill. `projectMembers.side`, `taskTemplates.scope`,
`tasks.tripId`, and `campaigns.tripsEnabled` need none either, by construction: all four are optional
and their absent reading is what every existing row already means.

What it does need is a **one-time report, not a rewrite**. Existing `projectMembers` rows with roles
like `volunteer`, `team_lead`, and `leader` are almost certainly `team` and are being counted as
people reached today. A `@convex-dev/migrations` job that guessed would move published impact numbers
with nobody watching — which is the failure `updates` and `publicStats` are both written to avoid.

So: a migration that **lists** the suspect rows (role matching a small heuristic set, grouped by
campaign, with the resulting delta to each affected published stat) and writes nothing. An admin
screen offers "mark these as team", one campaign at a time, showing the before-and-after number
first. The correction is a decision someone makes with the number in front of them.

### Two indexes have to ship staged

Per the Convex guidelines (`shared/convex/_generated/ai/guidelines.md:191`): _"Adding an index to a
large existing table blocks the deploy until backfill completes."_ Two of the additions here land on
existing tables that grow without bound:

- **`tasks`** gains `by_tripId` and `by_tripId_and_key`. This table holds every checklist item of
  every record of every campaign — the largest table this plan touches.
- **`allocations`** gains `by_tripId` when §7's integration lands. Same problem, other worktree.

Both go in as `.index('by_tripId', { fields: ['tripId'], staged: true })`, then a **second deploy**
drops the flag once backfill finishes. A staged index cannot be queried, so the trip checklist reads
land in that second deploy and not the first. This is a sequencing constraint on §16, not a design
choice, and it is the kind of thing that is discovered at deploy time if it is not written down.

`taskTemplates` and the five new tables need no staging — a brand-new table has nothing to backfill,
and `taskTemplates` holds a handful of rows per campaign.

---

## 14. Still open

Two things. The first surfaced only when the call sites of §8 were actually read, which is the
argument for reading them before writing the plan rather than after.

1. **Does a trip goer keep portal visibility of the record they served?** `portal.ts:377` decides
   whether a signed-in person may see a record's name and story, and it currently reuses the
   people-reached filter. Gating it on `side` would revoke that from anyone marked `team`. Both
   answers are defensible — the portal may be strictly for the people served, or a returning team
   member may reasonably follow the family they visited — and the question is about who the portal is
   *for*, not about trips. §8 ships the other three call sites and leaves this one alone until it is
   answered.
2. **Attendee support-raising.** "Maria raised $1,800 toward her seat" is a donation designated to a
   trip *and* to a person — a fourth dimension neither `allocations` nor `donationIntents` has today.
   It belongs to neither this plan nor the ledger work happening in parallel. See §7.

---

## 15. The trip name

Prefilled **`{Campaign} — {Project} — {startOn}`**, editable from then on. `Jubilee — Rahman Family —
2024-12-01`.

The wrinkle is that projects are normally linked to a trip **after** it exists, and there can be
several, so at the moment the name is generated there is no project to put in it. Resolved by having
the create dialog offer an **optional single project picker**, used for exactly two things: seeding
the name, and writing the first `tripProjects` row. Choosing none falls back to `Jubilee —
2024-12-01`. Every further project is added on the trip page afterwards and **does not touch the
name** — the name is the user's from creation onward, which is the same contract `updates.slug` has
and for the same reason: a handle that silently rewrites itself is not a handle.

**"Deploy date" is `startOn`** — the departure date. There is no separate mobilization date on the
trip.

---

## 16. Order

1. Schema: four tables + `tripBudgetLines`, `projectMembers.side`, `campaigns.tripsEnabled`,
   `tasks.tripId`, `taskTemplates.scope` and `items[].perAttendee`. The two `tasks` indexes go in
   **staged** (§13). Nothing reads them yet. **Deploy.**
2. Second deploy: unstage the `tasks` indexes once backfill completes. Nothing else in this list can
   read a trip task until this lands.
3. `lib/domain/trip-itinerary.ts` + tests. The timezone arithmetic, before anything depends on it.
4. `convex/trips/` queries and mutations, `deleteTripCascade`, and the three cascade edits (§10).
5. `convex/tripAttendees/`, and `listCampaignMembers` gaining `viaTrips`.
6. `convex/tripSegments/`, including per-person legs.
7. `instantiateTripTasks` and the template scope switch (§6). Depends on step 2.
8. `lib/domain/trip-budget.ts` + `convex/tripBudgetLines/` (§7). Planned only.
9. `isPersonReachedRole(role, side)` and **three** of its four call sites (§8) — `stats.ts:186`,
   `public.ts:245`, `campaigns/queries.ts:112`. `portal.ts:377` is left alone pending §14.1.
   **Isolated commit** — it is the one change here that can move a published number, and the one
   that can change a public page.
10. UI: `/app/trips`, the trip page block by block, then the campaign / project / contact entry
    points.
11. The suspect-rows report and its admin screen (§13).

Steps 1–8 are additive and ship behind `tripsEnabled` with nothing else affected. Step 9 is the one
to review carefully. Nothing in any step edits `transactions` or `allocations`.

---

## 17. What this deliberately does not do

- **No public trip page.** §12.
- **No passport, visa, or travel-document storage.** §6 — a checklist records that someone checked,
  which is what the app actually needs.
- **No ledger writes.** §7 — planned budget only, integration specified for another worktree.
- **No custom fields on trips.** The engine's `fieldEntity` union is `contact | project | campaign`;
  widening it means touching `resolveFieldDefinitions` and every screen that renders a field bag. A
  `notes` field plus the checklist covers v1. Revisit when an org asks for a specific field twice.
- **No flight lookup or airline API.** Airline, number, and times are typed in. An itinerary is
  entered once per trip and a live-schedule integration is a support burden that buys nothing here.
- **No airport timezone database.** `departureTimeZone` is entered or absent; §5 degrades rather than
  guesses. A picker seeded with the couple of dozen airports an org actually flies is a later,
  cheaper answer than a full dataset.
- **No attendee self-service.** Trip goers do not confirm attendance or tick their own readiness
  items through the portal. The portal today answers "is this row mine", and trips are not in it —
  though §6's per-attendee tasks are already assigned to contacts, so this is a smaller step later
  than it looks.
