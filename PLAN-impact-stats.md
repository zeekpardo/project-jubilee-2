# Plan — admin-controlled impact stats

**Goal:** an admin can decide what numbers their campaign publishes, without a
code change. Today the three metrics are fixed in code, and the two most
interesting ones from the reference app ("livelihoods started", "children in
school") cannot be computed at all.

---

## 1. Where we are

**Exists:**

- `lib/domain/campaign-stats.ts` — a pure registry, three keys:
  `projects_freed`, `people_reached`, `children_reached`. Deliberately shaped
  to take per-campaign config later.
- `convex/model/public.ts → publicCampaignStats()` — computes the values inside
  the privacy wall.
- `customFieldDefinitions` — admins already define arbitrary typed fields
  (`text | longtext | number | money | date | select | boolean`), org- or
  campaign-scoped, each with an `isPublic` flag.
- `taskTemplates` — a versioned, append-only checklist per campaign. Each item
  is `{ key, label, order, impactTag }` where `impactTag` is the hardcoded
  union `'business' | 'school' | null`.
- `pipelineStages` — admin-managed stages, already data rather than an enum.

**Missing:**

- **No `tasks` table.** Nothing instantiates a `taskTemplates` item against a
  project, so no task can be created or completed. This is the whole reason
  the two task-derived metrics were left out rather than shipped returning
  zero.
- No per-campaign selection of which stats to show, in what order, under what
  label, on which surface.
- No admin UI for any of it.

**How the reference did it** (`/Users/zeek/Projects/Project Jubilee/next-shadcn-dashboard-starter`):
a fixed code registry of 7 metrics (`STAT_METRICS`) plus a `campaign_stats`
table holding selection/label/order/visibility. Business and school counts came
from `count(distinct familyId)` over `tasks` where
`source='template' AND status='done' AND impactTag IS NOT NULL`. It never
shipped the admin UI — the code comment says "config UI is a later phase" —
so in practice an admin had no control at all. That is the gap this plan closes.

---

## 2. The model

A stat is a small declaration. Three sources, one shared shape:

| Source | Number comes from | Admin controls it by |
|---|---|---|
| `builtin` | code (freed, people reached, total raised) | choosing to show it |
| `field` | a custom field they defined | adding the field |
| `task` | completed checklist items carrying a tag | tagging a checklist item |

**Why three rather than one:** built-ins are things only code can compute.
Fields are the fastest path to admin control and reuse an engine that already
exists. Tasks are the most *truthful* source — the number moves because work
got done, not because someone remembered to edit a number.

### Two switches on a checklist item

These answer different questions and must stay separate:

- **`impactTag`** — does this item feed a stat at all? Most items never will
  ("Book transport", "Collect signed agreement"). No tag means it is purely an
  operational task.
- **`isPublic`** — may that count be published? Tagged-but-private is a real
  and common case: "Legal certificate filed" is a useful internal metric that
  is nobody else's business.

```
Book transport          no tag           internal task
Debt cleared            tag, not public  internal stat
Business started        tag, public      public stat
```

This mirrors `customFieldDefinitions.isPublic`, which already renders a "Public"
badge with an eye icon in `ProjectFields.svelte` plus a warning on the card.
Match that pattern exactly — same badge, same warning — so "published" looks
the same wherever an admin meets it.

---

## 3. Schema changes

### 3.1 `tasks` (new)

```ts
const tasks = defineTable({
  orgId: v.string(),
  projectId: v.id('projects'),
  campaignId: v.id('campaigns'),        // carried directly, never by traversal
  // The taskTemplates item this came from, and the version it was created
  // against — templates are append-only, so a task must remember which
  // version's wording it agreed to.
  templateVersion: v.string(),
  key: v.string(),                       // taskTemplates item key
  label: v.string(),                     // snapshotted, so a later reword
                                         // doesn't rewrite history
  order: v.number(),
  impactTag: v.optional(v.string()),     // snapshotted from the template item
  isPublic: v.boolean(),                 // snapshotted from the template item
  status: v.union(v.literal('todo'), v.literal('done')),
  completedAt: v.optional(v.number()),
  completedBy: v.optional(v.string()),   // Better Auth user id
  note: v.optional(v.string())
})
  // unique(projectId, key)
  .index('by_projectId', ['projectId'])
  .index('by_projectId_and_key', ['projectId', 'key'])
  .index('by_campaignId_and_status', ['campaignId', 'status'])
  .index('by_campaignId_and_impactTag', ['campaignId', 'impactTag']);
```

**Why snapshot `label` / `impactTag` / `isPublic` onto the task**: the same
reason `budgets` snapshot a `costTemplates` version. Renaming a checklist item,
or un-publishing it, must not silently rewrite what a completed task meant when
it was ticked. It also means the stat query never has to join back to the
template.

### 3.2 `taskTemplates.items[]` — widen the tag, add the flag

```ts
items: v.array(v.object({
  key: v.string(),
  label: v.string(),
  order: v.number(),
  // Free text, not a union: a campaign should be able to tag "Well drilled"
  // or "Bicycle given" without a schema change. Absent = not a stat.
  impactTag: v.optional(v.string()),
  // Gates whether the resulting count may be published. Defaults false —
  // same rule as customFieldDefinitions: private until deliberately shared.
  isPublic: v.boolean()
}))
```

**Migration:** `impactTag` changes from `v.union(...,v.null())` to
`v.optional(v.string())`. Existing rows carry `'business' | 'school' | null` —
all valid strings or absent, so widening is backward-compatible, but `null`
must be normalised to absent. `isPublic` is new and required; backfill `false`.
Use `@convex-dev/migrations` with widen → migrate → narrow.

### 3.3 `campaigns.publicStats` — the selection

Inline array, same precedent as `taskTemplates.items` ("bounded, always read
together"):

```ts
publicStats: v.optional(v.array(v.object({
  id: v.string(),                 // stable key for ordering/editing
  label: v.optional(v.string()),  // override; unset = source's own default
  order: v.number(),
  showOnPublic: v.boolean(),
  showOnDashboard: v.boolean(),
  source: v.union(
    v.object({ kind: v.literal('builtin'), metric: v.string() }),
    v.object({
      kind: v.literal('field'),
      fieldKey: v.string(),
      aggregate: v.union(v.literal('sum'), v.literal('count'), v.literal('countWhere')),
      matchValue: v.optional(v.string())   // countWhere only
    }),
    v.object({ kind: v.literal('task'), impactTag: v.string() })
  )
})))
```

Unset means "fall back to registry defaults", so this ships without a migration
and existing campaigns keep working.

### 3.4 `orgSettings.publicStatSections` — the org roll-up

An org page does **not** sum across campaigns. Adding "families freed" to
"attendees reached" produces a number that means nothing. Instead the admin
picks which campaigns' stats to surface, and each renders as its own section:

```ts
publicStatSections: v.optional(v.array(v.object({
  campaignId: v.id('campaigns'),
  heading: v.optional(v.string()),   // unset = the campaign's own name
  order: v.number()
})))
```

Each section reuses the campaign's existing `publicStats` — nothing new is
computed, so a stat cannot say one thing on a campaign page and another on the
org page. Empty or unset means no stats section at all.

### 3.5 Counting window

**Public is always lifetime.** No date filtering reaches a public page or an
embed, which is what keeps "does 'this year' mean calendar or financial year?"
off a donor-facing surface entirely.

**Time filtering is dashboard-only** — a status filter (`active`/`paused`/
`archived`) and a date range, applied at read time. It needs no schema:

- `campaigns.status` already exists (`active | paused | archived`).
- Record-level exclusion should key off `pipelineStages.kind === 'terminal'`,
  which this schema already describes as the off-ramp for cancelled or
  freed-by-another-org records — rather than adding an `archived` flag to every
  project.

One judgement to make when building it: a **freed** family must stay in
lifetime totals — that is the impact — while a record entered in error must
not. Both can sit in terminal stages today, so `pipelineStages` likely needs a
per-stage `countsTowardImpact` boolean to separate "left the programme
successfully" from "should never have been here".

---

## 4. Privacy rules — non-negotiable

The wall is an allowlist and these additions must not put a hole in it.

1. **A public stat may only read a public source.**
   - `field` → the field's `isPublic` must be true.
   - `task` → the checklist item's `isPublic` must be true.
   - Enforced in `publicCampaignStats()`, not only in the admin UI. A config
     row that names a private source is **skipped**, not rendered — the same
     fail-closed posture `publicAttributeList` already takes.

2. **Protected keys stay protected.** `isProtectedFieldKey` already denylists
   `site_ref`, phone, address, location and friends. A `field` stat over a
   protected key must be refused at write time *and* dropped at read time,
   exactly as `publicAttributeList` does.

3. **Small counts leak.** "1 record has `impactTag=business`" alongside a grid
   of two published records is close to identifying. Aggregates over private
   data can reveal it without publishing a single record.
   → Suppress a **public** count below a threshold (start at 5, make it a
   constant with a comment, not a magic number), and warn in the admin UI when
   a stat would currently fall under it. Internal/dashboard stats are exempt.

4. **`countWhere` over a `select` field is the sharpest edge** — it publishes a
   distribution ("3 = Medical, 1 = Debt"). Treat it as public only when the
   field is public *and* every bucket clears the threshold.

---

## 5. Work, in order

Each step is independently shippable and leaves the app working.

1. **Stat config, built-ins only.**
   `campaigns.publicStats` + resolution in `campaign-stats.ts` + admin UI on
   the campaign's **Public site** tab (reorder, relabel, toggle each surface).
   No new sources yet. Closes the "no admin control" gap on what already
   exists.

2. **`field` source.**
   Add the source kind, the `isPublic` + protected-key checks, and the
   small-count threshold. Biggest control gain per unit of work — an admin who
   wants "Goats distributed" adds a number field and points a stat at it.

3. **`tasks` table + instantiation.**
   Create tasks for a project from the active `taskTemplates` version; mark
   done/undone. Project detail gets a checklist tab. No stats yet — this is the
   workflow on its own, and it is worth having regardless.

4. **Checklist tagging + public flag.**
   Widen `impactTag`, add `isPublic` to template items, migrate. Surface the
   "Public" badge and warning in `TaskTemplatesTab.svelte`, matching
   `ProjectFields.svelte`.

5. **`task` source.**
   `count(distinct projectId)` over completed tasks with the tag — distinct, so
   a record with two business milestones counts once. Wire into
   `publicCampaignStats()`.

6. **Dashboard stat strip.**
   Renders the same list filtered to `showOnDashboard`, plus the status and
   date-range filters. First surface where internal-only stats are visible.

7. **Org stat sections.**
   `orgSettings.publicStatSections` + a picker in the org's Public site
   settings. Each selected campaign renders its own section on the org page.

8. **Embeds follow for free** — they already render whatever the stat list
   returns.

---

## 7. Decisions made

- **Small public counts are hidden below 5**, with a warning to the admin
  explaining why. Internal numbers are never suppressed.
- **Internal stats live on the campaign dashboard** — same stat list, filtered
  to `showOnDashboard`.
- **Public is lifetime; the dashboard filters.** Status and date-range
  filtering are dashboard-only.
- **No org-wide sum.** The org page shows selected campaigns' stats as separate
  sections, because campaigns measure different things.

Still open, and none of it blocks a start: whether a `pipelineStages` needs the
`countsTowardImpact` flag described in §3.5 (only matters once terminal stages
are actually in use), and the exact dashboard filter UI.

---

## 8. Shipped

All eight steps in §5 are built. Where the implementation decided something the
plan left open, or read a rule differently, it is recorded here.

**The two open questions in §7, resolved:**

- **`pipelineStages.countsTowardImpact` was added**, optional, absent meaning
  true. It is not a filter — a stage marked false is excluded from *every*
  impact count, public and internal alike, which is what separates "left the
  programme successfully" from "should never have been here". Editable on the
  stage form.
- **The dashboard filter is a date range only.** The plan also named a
  campaign status filter, but the dashboard renders one campaign at a time, so
  filtering by that campaign's own status has no effect on its numbers. The
  record-level exclusion the status filter was standing in for is the
  `countsTowardImpact` flag above, which applies everywhere rather than as a
  toggle. A `field` stat has no timestamp to filter on, so it is labelled
  "All time" rather than silently reading as filtered.

**Deliberate deviation — the small-count threshold applies to `field` and
`task` sources, not to `builtin` ones.** §4.3's reasoning is about aggregates
over data that is *not* otherwise published. Every built-in aggregates a fact
this app already publishes per record — the goal-met badge and the member count
sit on every public project card — so suppressing them would hide nothing an
attacker could not read off the grid, while blanking the impact strip of every
campaign that has freed fewer than five families. Money is exempt for the same
reason: a dollar total is not a count of records. The rule lives in one place
with that comment (`suppressesPublicValue`), so it is one edit to change.

**Also worth knowing:**

- `total_raised` was added to the built-in registry, per §2's table.
- A stat's `id` is derived from its source (`builtin:projects_freed`,
  `task:business`), so the same number cannot be listed twice under two ids.
- `campaigns.publicStats` unset falls back to the three shipped counts; an
  empty array is a real "publish nothing". No migration, exactly as §3.3 said.
- The engine (`convex/model/stats.ts`) is one function, `evaluateStats`, that
  returns every row's internal value *and* a verdict on whether it may be
  published. The public read, the dashboard read and the admin warnings are all
  filters over it, so the three can never drift — and the admin screen can say
  *why* a stat is withheld instead of it silently vanishing.
- The `taskTemplates` migration ran on the dev deployment via widen → migrate →
  narrow; `migrations.ts` keeps the migration and the runbook.
- The org index no longer redirects past itself when the org has configured
  stat sections — with them it is no longer "a page with a single link on it".
