# Feature Spec: Tasks

## Key Risks

1. **`projectId` becoming optional is the load-bearing change.** Every existing
   reader assumes a task has a record: the impact engine counts
   `distinct projectId`, `deleteProjectCascade` is the only thing that deletes
   tasks, and the project Checklist tab queries `by_projectId`. Campaign-level
   tasks are invisible to all three. Get the cascade and the stat guard in the
   same change as the schema, or campaign-level tasks leak on campaign delete
   and silently count zero in stats.

2. **Assignee is polymorphic, and "assigned to me" must be written once.**
   A user assignee and a contact assignee resolve to the same person when
   `contacts.authUserId` is set. If that rule gets re-implemented per call site
   — the filter, the saved view, the future portal — they will drift.

3. **Two pages, one list.** The campaign-scoped and admin-wide pages differ only
   in scope and one extra column. Building them separately is the refactor this
   spec exists to avoid.

---

## Data Model

### `tasks` — extended

Existing columns unchanged unless noted.

| Field | Type | Req | Notes |
|---|---|---|---|
| `orgId` | string | ✓ | |
| `campaignId` | `Id<'campaigns'>` | ✓ | Carried directly, never by traversal |
| `projectId` | `Id<'projects'>` | — | **CHANGED: now optional.** Absent = campaign-level work |
| `source` | `'template' \| 'manual'` | ✓ | **NEW.** Discriminator |
| `templateVersion` | string | — | **CHANGED: optional.** Required iff `source === 'template'` |
| `key` | string | — | **CHANGED: optional.** Required iff `source === 'template'` |
| `label` | string | ✓ | The title. Reused, not duplicated |
| `description` | string | — | **NEW.** Replaces `note` (see migration) |
| `order` | number | ✓ | |
| `impactTag` | string | — | Refused when `projectId` is absent |
| `stageKey` | string | — | **NEW.** A `pipelineStages.key`. Label + filter only |
| `assignee` | union | — | **NEW.** `{kind:'user', userId}` \| `{kind:'contact', contactId}` |
| `dueOn` | string | — | **NEW.** ISO `YYYY-MM-DD`, matching every other date |
| `priority` | `'low'\|'normal'\|'high'\|'urgent'` | ✓ | **NEW.** Default `normal` |
| `status` | `'todo' \| 'done'` | ✓ | |
| `completedAt` / `completedBy` | number / string | — | |
| `note` | string | — | **REMOVED** — migrated into `description` |

**Why `dueOn` is an ISO string, not a timestamp:** a due date is a calendar day,
not an instant. Storing epoch ms makes "due today" depend on the reader's
timezone, and the same task shows as overdue in Karachi and not in Chicago.

**Why `stageKey` is a string, not an FK:** identical to `projects.stage`. Stages
are admin-managed data with immutable keys; a renamed stage keeps its key.

### Indexes

Existing: `by_projectId`, `by_projectId_and_key`, `by_campaignId_and_status`,
`by_campaignId_and_impactTag`.

New:
- `by_orgId_and_status` — the admin-wide list
- `by_campaignId_and_dueOn` and `by_orgId_and_dueOn` — the default sort, so the
  common case is index-ordered rather than sorted in memory

**Bounded reads.** Filters and sorts combine arbitrarily and cannot all be
indexed. Read via the most selective index available (campaign or org, plus
status when filtered), cap at `TASK_PAGE_MAX = 500` with `.take()`, then apply
remaining filters and sort in the handler. When the cap is hit, the UI says so
explicitly — a silently truncated list reads as missing data. **Known limit:**
this is fine at hundreds of tasks and wrong at tens of thousands; the fix is
cursor pagination over the sorted index, not a bigger cap.

### `taskViews` — new

| Field | Type | Req | Notes |
|---|---|---|---|
| `orgId` | string | ✓ | |
| `ownerUserId` | string | ✓ | Better Auth user id |
| `name` | string | ✓ | |
| `isShared` | boolean | ✓ | Org-wide. Only `settings:manage` may set true |
| `query` | string | ✓ | The URL query string, stored verbatim |
| `order` | number | ✓ | |

Indexes: `by_orgId_and_ownerUserId`, `by_orgId_and_isShared`.

**`query` is a raw query string on purpose.** Filters live in the URL, so a saved
view is literally "the URL I had". No parallel filter schema to keep in step,
and a view is a shareable link.

### Relationships

- task → campaign: **many:1, required**
- task → project: **many:1, optional**
- task → assignee: **many:1, optional, polymorphic** (user or contact)
- task → pipeline stage: by key string, not an FK
- taskView → user: **many:1**

### Migration

Widen → migrate → narrow, the same rollout used twice already:

1. Widen: `projectId`, `templateVersion`, `key` optional; `source`,
   `description`, `priority` optional; keep `note`.
2. Migrate: every existing row gets `source: 'template'`, `priority: 'normal'`,
   and `description: note` where `note` is set.
3. Narrow: `source` and `priority` required; drop `note`.

---

## Shared Patterns

**Extract first, then build twice.** `TaskListView` owns the filter bar,
sortable table, bulk bar, row actions and empty/loading states. Both pages are
instances; the admin one passes `scope: 'org'` and gets a Campaign column plus a
campaign filter.

Reuses existing primitives: `ui/table`, `ui/drawer` (the side sheet),
`ui/select`, `ui/checkbox`, `ui/badge`, `EmptyState`, `ConfirmDialog`.

No other generic is needed. `ProjectsBrowser` and `CampaignsTable` are bespoke
and stay that way — retrofitting them onto this is a separate decision.

---

## State Design

- **No new store or context.** Convex `useQuery` subscriptions mean a mutation
  propagates to every open view; there is no cache layer to invalidate.
- **Filters and sort live in the URL** — `?assignee=me&priority=high&sort=dueOn&dir=asc`.
  Navigated with `replaceState`, `keepFocus`, `noScroll` so typing in a filter
  does not push history or jump the page.
- **`ActiveCampaignContext` is read-only here.** The campaign page reads the
  active campaign; nothing in this feature writes it. Switching campaigns must
  not clear the user's filters, and filtering must not change the active
  campaign.
- **Pure module** `lib/features/tasks/filters.ts` — parse/serialise the query
  string, and the sort comparators. Unit-tested like every other `lib/domain`
  and feature-pure module.

---

## UI Spec

### Component tree

```
routes/app/tasks/+page.svelte              campaign-scoped
routes/app/admin/tasks/+page.svelte        org-wide
└─ lib/features/tasks/
   ├─ TaskListView.svelte                  the generic; owns URL state
   │  ├─ TaskFilterBar.svelte              assignee, priority, due, status, stage, campaign*
   │  ├─ TaskSavedViews.svelte             list, apply, save current, publish*, delete
   │  ├─ TaskTable.svelte                  sortable headers, selection checkboxes
   │  ├─ TaskBulkBar.svelte                appears only with a selection
   │  └─ TaskSheet.svelte                  create / edit / detail
   ├─ filters.ts + filters.test.ts         pure
   └─ types.ts
```
`*` admin scope only.

### Nav

One line in each array of `lib/shell/nav-config.ts`:
- campaign: `{ key: 'tasks', href: '/app/tasks', icon: ListChecks, capability: 'projects:read' }`
- admin: `{ key: 'adminTasks', href: '/app/admin/tasks', icon: ListChecks, capability: 'projects:read' }`

### Scroll containers

Page scrolls vertically. The table sits in its own `overflow-x-auto` wrapper so
narrow viewports scroll the table, never the page body. The sheet body scrolls
independently of its header and footer.

### Form fields, in order (TaskSheet)

1. **Title** — required — text
2. **Description** — optional — textarea
3. **Assignee** — optional — grouped select: org members first, then contacts
4. **Due date** — optional — date input
5. **Priority** — required, defaults `normal` — select
6. **Project** — optional — combobox; blank = campaign-level work
7. **Stage** — optional — select of the campaign's stages
8. **Impact tag** — optional — **disabled unless a project is set**, with the
   reason shown inline

Template-derived tasks: `title`, `key` and `impactTag` are read-only. They come
from the checklist version and editing them per-record would make records
disagree about what the same step means.

### Edit behavior

`{#key task._id}` around the sheet's form, so switching rows remounts it. No
manual reset, and no chance of the previous task's unsaved text bleeding into
the next one.

### States

- **Empty, no tasks at all:** "No tasks yet" + a New task action.
- **Empty, filters exclude everything:** "No tasks match these filters" + a
  Clear filters action. Distinct copy from the above — otherwise a filtered
  page reads as a broken one.
- **Loading:** skeleton rows in the table body; the filter bar renders
  immediately so it never jumps.
- **Error:** toast, matching every other mutation in the app.
- **Truncated:** an explicit notice when `TASK_PAGE_MAX` is hit.

---

## Edge Cases

| Case | Behaviour |
|---|---|
| **Project deleted** | Its tasks are deleted — existing `deleteProjectCascade`. |
| **Campaign deleted** | `deleteCampaignCascade` must **also delete tasks by `campaignId`**. Project-less tasks are not reached by the per-project cascade and would otherwise be orphaned. |
| **Contact deleted** | Assignee is **cleared, task kept** — the same posture the ledger takes with `transactions.contactId`. The work happened; the person left. |
| **Member removed from org** | Same: clear the assignee. If a stale id survives, the row renders "Unassigned" rather than crashing or leaking an id. |
| **Stage deleted or renamed** | Renaming is safe — keys are immutable. A key that no longer resolves renders muted rather than blank, matching `stage?.label ?? project.stage`. |
| **Duplicates** | Template tasks stay `unique(projectId, key)`. Manual tasks have no natural key; duplicates are allowed and are the user's business. |
| **Unsaved changes** | Closing a dirty sheet asks first. Navigating away does not — SvelteKit navigation is not blocked, and a lost draft is better than a trapped user. |
| **Deletion** | Any task, with confirmation. **The confirm names the consequence** when the task is completed AND tagged AND its stat is public: deleting it reduces a number currently on the donor page. Your call to allow it; not silently. |
| **Bulk actions** | Assign, set due date, set priority, mark complete. Bulk complete warns when the selection includes tagged items whose stat is public — one click can move a published figure. |
| **Impact tag without a project** | Refused at write time. Stats count `distinct projectId`; a tagged campaign-level task would otherwise count zero forever and look broken. |
| **"Overdue"** | Computed against a `today` passed in from the client. A Convex query must not read the clock — the result would go stale with no write, and it poisons the query cache. |
| **Permissions** | `projects:write` (campaign-scoped) for create, assign, edit, complete, delete. `projects:read` to view. `settings:manage` to publish a shared view. |
| **Saved view scope** | A view stores a query string that may name a campaign the viewer cannot access. Applying it filters to what they may see; it never widens access. |

---

## Implementation Order

1. **`TaskListView` + `filters.ts`** — the generic and its pure module, with
   tests. First, so neither page is built twice.
2. **Schema + migration** — widen, migrate (`source`, `priority`, `note` →
   `description`), narrow. Plus the campaign cascade and the contact-delete
   assignee clearing, in the same change as `projectId` going optional.
3. **Mutations and queries** — `createTask`, `updateTask`, `deleteTask`,
   `bulkUpdateTasks`, `listTasks` (scoped), `taskViews` CRUD.
4. **Campaign page** — `/app/tasks` + nav entry.
5. **Admin page** — `/app/admin/tasks` + nav entry, campaign column and filter.
6. **Saved views** — after filters are proven in the URL.
7. **Edge-case polish** — truncation notice, impact-moving warnings, missing
   reference rendering.

---

## Out of Scope (noted, not built)

- **The role expansion.** `campaign_manager` and `portal_member` do not exist in
  the `Role` union (`owner | admin | team_leader | member`), and `admin`
  currently has no billing/org-settings restriction. This feature is built on
  existing capabilities so nothing here needs rewriting when roles change.
- **The client portal.** The assignee model is designed for it — a contact with
  `authUserId` is already the link — but no portal surface is built here.
- **Member ↔ contact association UI.** `contacts.authUserId` exists; nothing
  creates the link yet. Assigning to a contact works regardless; it is the
  "assigned to me" resolution that becomes richer once the link is settable.
