# Project Jubilee — Rebuild on Convex + SvelteKit + Better Auth

## 1. What this is

`project-jubilee-2` is the target replacement for the live production app at
`/Users/zeek/Projects/Project Jubilee/next-shadcn-dashboard-starter`
(remote: `github.com/zeekpardo/project-jubilee`) — an admin + public web
platform for a nonprofit (Project Jubilee) that frees enslaved brick-kiln
families in Pakistan, generalized into a multi-campaign case-management +
CRM + donor-comms platform.

**Goal: full stack migration, eventual cutover.** Old stack: Next.js 16 +
Clerk + Drizzle/Postgres + shadcn (Base UI variant). New stack: **SvelteKit +
Convex + Better Auth**, using shadcn-svelte for UI once we get there.

**Order of operations: backend first.** Build the Convex data model and
functions to full (or better) parity with the old app's domain logic and
API surface, verified without any UI (Convex dashboard, `convex run`,
vitest). Only after the backend for a feature area is solid do we build its
screens.

## 2. What can actually be "copied" vs. what must be rebuilt

- **Copyable near-verbatim:** the pure domain functions in the old app's
  `src/lib/domain/*.ts` (`budget.ts`, `reconciliation.ts`, `stages.ts`,
  `followup.ts`, `campaign-stats.ts`, `campaign-defaults.ts`,
  `field-definitions.ts`) — no DB imports, no React, each has a paired
  `.test.ts`. These port with minimal changes into Convex helper modules.
- **Copyable as reference, not code:** the Drizzle schema (`src/lib/db/schema.ts`)
  — translates table-by-table into Convex `defineTable`, but the syntax and
  relationship model (FK+cascade vs. Convex's id references) differ enough
  that this is a rewrite guided by the old schema, not a port.
- **Design tokens only:** the OKLCH theme (`src/components/themes/*`) — plain
  CSS custom properties, framework-agnostic, copy directly when we reach UI.
- **Must be rebuilt from scratch:** every React/Base-UI component. The old
  app's `components.json` uses shadcn's **Base UI** variant, which has a
  different primitive API than the Radix-based shadcn-svelte we'd use. Old
  components are a *spec* (what the screen does, its states, its data shape),
  not a copy source.

## 3. Non-negotiable conventions carried over

These are load-bearing in the old app and must exist from day one of the
relevant phase, not bolted on later:

- **Privacy wall.** The old app funnels every public-facing read through a
  single query layer (`src/lib/db/queries/public.ts`) that enumerates exactly
  what's exposed (project number, first-name-only, story/photo/video,
  aggregate counts) vs. never exposed (internal site ref, full names, ages,
  relationships, sponsor PII, pledge amounts, raw IDs). Public UI is
  forbidden from importing feature service/query files directly. We
  replicate this as a dedicated `convex/public/` query module — the *only*
  thing public routes are allowed to call.
- **Money is integer cents**, everywhere, no exceptions.
- **Versioned, append-only templates** — `costTemplates` and `taskTemplates`
  are never mutated in place; a new version is inserted, and `budgets`/`tasks`
  snapshot the version they were created against.
- **Admin-managed pipeline stages** — stages are data (a table with
  `key`, `kind: funnel|terminal`, `isFundedGate`), not a hardcoded enum.
- **Real data never enters this repo.** Same rule as the old app: no real
  names, photos, or financial records get committed, seeded from a fixture,
  or hardcoded anywhere. Migrating real production data from the old
  Postgres DB to Convex is a **user-executed, one-time, out-of-band step**
  late in the plan — not something an agent does casually mid-build.

## 4. Backend phases (Tier 1 → Tier 4, dependency-ordered)

Each phase = Convex schema + queries/mutations/actions + ported domain
logic for one feature area, done when: `npx convex dev --once` deploys
clean, `vitest` passes for ported domain functions, and a scratch
`convex run` smoke-tests the core mutations/queries against dev data (no
UI needed to call a phase done).

### Tier 1 — Core case management (MVP parity, build first)

1. **Org & campaign shell** — `campaigns`, `orgSettings`; decide one-org
   (the nonprofit) vs. Better Auth's existing personal-org-per-user default
   (needs turning off — see open decision in §6). Port `campaign-defaults.ts`.
2. **Pipeline config** — `pipelineStages`, `costTemplates`, `taskTemplates`
   (versioned, campaign-scoped). Port `stages.ts`.
3. **Projects (case records)** — `projects`. Custom `attributes` as a JSON
   field mirrors the old JSONB approach. A campaign configures its own
   `objectLabel`/`objectPlural` (e.g. "Family"/"Families") for display.
   NOTE: `projectMembers` is deliberately NOT here — it links a project to a
   `contact`, so it lands in Tier 2 immediately after `contacts` (phase 8a).
   The old app had a standalone `people` table and later migrated it into
   contacts; rebuilding `people` first would be throwaway work.
4. **Budgets** — `budgets` (template snapshot + debt/extras → computed
   target). Port `budget.ts`.
5. **Tasks** — `tasks` (manual + derived auto-alerts), `documents`, `updates`.
6. **Money** — `transactions`, `allocations`, reconciliation. Port
   `reconciliation.ts`.
7. **Privacy wall** — `convex/public/*` read-only query layer, built against
   real Tier-1 tables, unit-tested for what it does/doesn't leak.

**Exit criteria:** a project can move end-to-end (create → stage transitions →
budget → money in → allocated → tasks completed) via `convex run`/dashboard
only, with reconciliation math verified.

### Tier 2 — CRM (contacts, replacing the old `sponsors` table)

8. **Contacts** — `contacts`, `tags`/`contactTags`, `campaignMemberships`,
   `contactConsent`.
8a. **`projectMembers`** — the project↔contact link (role: subject/member/head,
    per-link `attributes` for age/relationship). Deferred here from phase 3
    because it depends on `contacts`.
9. **Households** — `households`, `householdMembers`.
10. **Custom fields** — `customFieldCategories`, `customFieldDefinitions`,
    wired into `projects`/`contacts` attributes. Port `field-definitions.ts`.

### Tier 3 — Portal, dashboard, comms

11. **Sponsor portal auth** — map old Clerk org roles (`org:admin`/
    `org:sponsor`) onto Better Auth's organization plugin roles + access
    control; link `contacts` to Better Auth users (equivalent of the old
    `clerkUserId`).
12. **Dashboard stats** — `campaignStats`, port `campaign-stats.ts`.
13. **Newsletter/comms** — `newsletterDrafts`, `audienceSegments`,
    `broadcasts`, `emailLog`; wire to Resend (already set up in this repo).
14. **Chat** — `conversations`, `conversationMessages` (general, not
    WhatsApp-specific).

### Tier 4 — Integrations (last, matches old app's own ordering)

15. **Follow-up scheduling** — port `followup.ts`, Convex cron/scheduled
    functions replacing the old app's ad hoc route-handler jobs.
16. **WhatsApp** — `waContacts`, `waConversations`, `waMessages`, webhook
    intake, AI-driven intake agent. Explicitly last, same rationale as the
    old app: everything before it must work with manual entry.

## 5. UI phase (after Tier 1 backend is solid, per your call to gate on that)

Not detailed yet — revisit once Tier 1 backend ships. Expected shape:
port the OKLCH theme + layout shell first (sidebar/header via shadcn-svelte),
then screens one feature at a time in the same Tier order as the backend.

## 6. Decisions (locked)

- **Single org.** The Better Auth `onCreate` trigger in `auth.ts` that
  auto-creates a personal organization per signup is disabled. Project
  Jubilee is exactly one Better Auth organization (the nonprofit); new users
  join it as members. `campaigns` is a table inside that one org, matching
  the old app's `orgId`-per-tenant model.
- **Table naming: `projects` (not `families`).** Adopts the old app's own
  in-progress generalization (`campaigns-framework.md`'s `objectLabel` /
  `objectPlural` — a campaign can call its projects "Families," "Cases,"
  whatever it configures). The join table linking contacts to a project is
  `projectMembers` (was `objectMembers`/`familyMembers` conceptually in the
  old app).

## 7. Standing rules for all agents working this plan

- Reuse the old app's own validated **parallel-subagent pattern** (from its
  `HANDOFF.md`): one agent (or the lead session) owns the schema + shared
  type contract for a phase; consumers fan out to parallel subagents with
  **disjoint file ownership**, launched in one batch; lead integrates and
  runs the gates before committing the phase as one unit.
- Gates before every commit (this stack's equivalent of the old app's
  tsc/lint/test/build): `npx convex dev --once` (schema/functions deploy
  clean), `pnpm check` (svelte-check), `pnpm lint`, `pnpm test`, `pnpm build`.
- Never commit real names, photos, or financial records. Real-data migration
  from the old Postgres DB is a separate, later, user-executed step.
- Money is integer cents; render via a shared `formatCents` helper (port,
  don't reinvent).
- Domain math lives in pure, unit-tested Convex helper modules — Convex
  functions call into them, never reimplement inline.
- Every phase ends with a working `npx convex dev --once` deploy and passing
  domain-function tests before moving to the next phase.

---

# Part II — The admin frontend

Built after the Tier 1/2 backend. Admin surfaces only; no public routes.
The privacy wall exists in `convex/public/` but nothing renders it yet.

## 8. Access model

Four roles, in `src/lib/domain/permissions.ts` — pure and unit-tested, read
by both the Convex functions and the UI so a hidden control and a refused
mutation cannot disagree.

| Role | Reach |
|---|---|
| `owner` | everything, including org identity and billing |
| `admin` | everything except org identity and billing |
| `team_leader` | only campaigns assigned in `campaignAssignments` |
| `member` | no admin access; the future donor portal is its own surface |

Two deliberate departures from LaunchClub, whose own code comments flag both
as hazards:

- Assignments carry `orgId` directly rather than being reached by traversal,
  so a lookup cannot return one from another organization.
- Roles are stored on the membership, not derived from whether assignment
  rows exist, so a team leader with no campaigns is still a team leader.

The four roles are also registered with Better Auth's organization plugin in
`src/lib/domain/org-roles.ts`, and the same definitions are given to the
client — otherwise its permission checks disagree with the server's. See the
comment on `assignableRoles` for exactly where the rule is enforced and the
one place it is not.

## 9. Conventions

- **Shell.** `src/lib/shell/` — sidebar filtered by capability, campaign
  switcher, `PageContainer` (title, description, action, `access`). A section
  with nothing permitted disappears rather than rendering an empty heading.
- **Campaign vocabulary.** A campaign names its own records
  (`objectLabel`/`objectLabelPlural`). Headings and nav take that from data,
  never from the message catalogue.
- **i18n.** Paraglide, compile-time and tree-shaken. `messages/en.json` is the
  single catalogue; recompile after editing. Every user-facing string comes
  from `m.*` except campaign-supplied vocabulary.
- **Themes.** `data-theme` plus CSS custom properties, resolved from a cookie
  during SSR so the first paint is correct. Light/dark is independent of
  palette. Components only ever use tokens, never a literal colour.
- **Money.** Integer cents in the data; one `formatCents` per feature turns it
  into currency. No arithmetic on money in a template.
- **States.** Loading is a Skeleton, empty is an EmptyState. Never a bare blank.

## 10. Open items

- Settings screens exist for pipeline stages and the versioned templates;
  the custom-fields admin is the last one.
- The donor portal (own donations, campaigns joined, giving) is deliberately
  out of scope so far, and is UI-only when it comes — the donations API
  integration is later still.
- Two i18n hygiene passes are cheaper before a second locale exists than
  after: sweep keys with no call site, and review duplicate English values
  using the grammatical-agreement test (a string that agrees with a subject
  must stay split even when English collapses it).
