# Plan — agentic workflows

## 1. What this is

An **agentic workflow** is a configured AI agent that holds a conversation to a
purpose and produces a **report** at the end of it. An admin authors it: which
campaign it belongs to, what starts it, what it must find out, what it writes
back to the record, how it speaks, and what shape the report takes.

Project Jubilee's first one is the family check-in that produces a draft blog
update. That is one instance of the thing, not the thing itself, and the
vocabulary here is deliberately general: the same machinery should be able to
run a trip debrief or a sponsor follow-up without a schema change.

This supersedes the authoring vocabulary in PLAN-ai-checkin.md. **The engine in
that plan is unchanged** — objectives, the judge-first two-call turn, escalation
as a first-class path, the drafting tool with no publish sibling, the decision
trace. What changes is that its configuration stops being constants and
org-wide rows, and becomes one editable object.

## 2. Why the current shape is wrong

Three problems, in order of how much they cost.

**Configuration is scattered across five versioned things.** A conversation
today freezes `responderPromptVersion`, `drafterPromptVersion`,
`judgePromptVersion`, `templateVersion` and `updateFormatVersion`. Five strings,
independently promotable, with nothing asserting they belong together. An admin
can activate a template whose objectives feed a report format that has no
section for them, and the system will run happily and produce a bad draft.

**Nothing owns the relationship between questions and output.** The objectives
exist to feed the report. Modelling them as two tables that merely happen to
share a `campaignId` loses that, and it is the central fact of the feature.

**Append-only was applied to authoring, not to running.** The rule protects one
thing: a version that has already run must not change, because runs name it and
the log is the replay set (PLAN-ai-checkin §4, §5). It does not need to protect
a workflow nobody has ever run — and that is the common case while somebody is
building one. The result is a surface with no edit and no delete, which is
friction paid for nothing.

## 3. The object

One workflow owns everything needed to run it.

```
workflow
  name, description
  campaignId              which campaign's records it runs against
  trigger                 manual | schedule | stage_change
  objectives[]            ordered steps of what to find out
  report                  the sections the output is made of
  prompts                 responder, judge, drafter — its own voice
  status                  draft | published | archived
```

**Prompts are per-workflow.** A trip-debrief agent and a family check-in agent
should not share a voice, and the responder prompt is where the care about who
is being written to actually lives. A new workflow is seeded with the shipped
defaults so this is a starting point rather than three empty boxes.

**Objectives are unchanged from what shipped.** Key, label, the description the
judge reads, optional per-objective thresholds and attempt cap, and a capture
target:

- `capture: none` — the answer is held for the report and written nowhere. The
  common case, and the reason the report exists.
- `capture: field` — the answer is written to a chosen field on the record or
  the contact, once, when the judge accepts it.

The write is DIRECT, not proposed. The gate is the one the engine already
applies: an answer only writes at `answered`, never at `needs_review`, and a
picklist answer that is not one of the options writes nothing. See §7.

## 4. Draft, publish, archive

The rule from §2 stated positively: **freezing is earned by running, not
assumed at authoring.**

```
workflows          the editable draft. One row per workflow. Edit freely.
workflowVersions   immutable snapshots. Written on publish, never updated.
runs               name ONE workflowVersionId.
```

- Editing a workflow edits its `workflows` row. No version, no ceremony.
- **Publish** snapshots the whole thing — objectives, report, prompts, trigger —
  into a new `workflowVersions` row. New runs bind to it.
- Runs already in flight keep the version they started on, exactly as
  conversations keep their prompts today. A family does not get a different
  voice mid-conversation because an admin published.
- **Delete** removes a workflow that has never been published. A published
  workflow is **archived** instead: hidden from pickers, its versions kept, so
  every run that names one stays replayable. Same trade
  `deleteConversationCascade` already makes when it keeps a draft update after
  its conversation goes.

This is what makes create/edit/delete and replayability both true. It is also a
simplification: one `workflowVersionId` on a run replaces five version strings
that could disagree.

## 5. Triggers

A union on the workflow, and deliberately small:

- **`manual`** — a person starts it on a record. What exists today.
- **`stage_change`** — starts when a record enters a named pipeline stage.
  Stages are already data with `key`, `kind` and `isFundedGate`, so this is a
  hook in the mutation that moves a record, not new infrastructure. **Build this
  first**: "when a family reaches Freed, start the check-in" is more useful here
  than a calendar, and it costs almost nothing.
- **`schedule`** — every N months. The field exists; the cron does not. Deferred
  on purpose, the same way PLAN-ai-checkin §7 deferred cadence, and for the same
  reason: the thing that consumes it is the transport.

Whatever the trigger, the same guard applies as today — one open run per record,
and a check-in needs a record to be about.

## 6. Surfaces

Authoring is admin. Reading what the agent said is not.

```
/app/admin/workflows              list — name, campaign, trigger, status
/app/admin/workflows/[id]         full-page editor, tabbed:
      Objectives                  steps, and what each answer writes
      Report                      sections → the draft_update schema
      Voice                       responder / judge / drafter
      Trigger                     manual · stage change · schedule
/app/admin/workflows/settings     API key, model tiers, org defaults
/app/messages                     unchanged — the live inbox
```

**Full page, not a dialog.** The current dialog is 515 lines of nested
repeaters and it is already unpleasant at three objectives. There is a `tabs`
primitive and five tabbed pages to follow; `/app/projects/[number]` is the
closest match.

**Runs stay out of this section.** They live in the inbox. A tab that mixes
"configure the machine" with "read what it said to a family" invites editing a
workflow while looking at a conversation it is mid-way through.

**Campaign is a field, not a parent.** Workflows do not live inside a campaign:
a campaign with no workflow would carry a dead tab, and "duplicate this workflow
to another campaign" — the thing an admin will want on day two — would have
nowhere to live.

## 7. Non-negotiables carried over

Unchanged from PLAN-ai-checkin §2, and none of this is softened by making
configuration editable:

- **Nothing AI-generated publishes without a human.** No code path writes
  `status: 'published'`, and the drafting model is given no tool that could.
  A generated `draft_update` tool is name-checked before it is handed over, so
  an authored report cannot become a publish tool.
- **A published version is immutable.** §4 is the mechanism.
- **The judge never sees the family profile.** Enforced by the shape of
  `buildJudgeInput`, not by instruction.
- **A captured answer takes the same path a typed one does.** Writes go through
  `validateAttributes`: unknown key throws, select coerces to its options. A
  model's answer gets no privileged route into a record.
- **Real family data never enters a fixture.**

## 8. Migration — there wasn't one

The plan described a careful widen/backfill/narrow. It was not needed and not
done: the deployment held no production data, only seeded config and three
sandbox conversations. The old tables were dropped, the ~31 disposable rows
wiped, and the sandbox reseeded through the new path. The imported family
dataset was never touched.

One piece of the doctrine did apply. Narrowing `checkinConversations` while
rows still carried the five old fields was rejected by the deploy, exactly as
the rule predicts — so the sequence was widen (declare the legacy fields),
wipe, narrow. That is the whole reason widen-migrate-narrow exists, met in
miniature.

Three orphaned tables (`promptVersions`, `checkinTemplates`, `updateFormats`)
still hold a handful of unreachable rows on the dev deployment. They are absent
from the schema, so nothing can read them, and clearing them would have cost
another schema round-trip for no behavioural gain.

## 9. Out of scope

- The WhatsApp transport. Still.
- Branching. Steps are ordered and all of them run; `skipIfKnown` is the only
  thing that removes an objective and `maxAttempts` the only thing that stops
  one being re-asked. The engine's control structure is "which objectives are
  outstanding", and a graph drawn in a builder would be a second control
  structure competing with it.
- Autonomous publishing, under any confidence threshold, permanently.
- Workflows that are not conversations. The object is general enough to grow
  one; nothing here builds it.

## 10. Open questions

- **Does a run's report always become an `updates` row?** For Jubilee yes. A
  trip debrief probably wants somewhere else to land, which makes "where the
  report goes" a property of the workflow rather than a constant.
- **Should a workflow be duplicable across campaigns?** Almost certainly, and
  it is cheap once the object owns everything. Not in the first pass.
- **Per-objective model tier.** The judge is Haiku-tier and the responder top
  tier by env var today. Once prompts are per-workflow, the tier arguably
  belongs next to them.

## 11. What actually shipped, and where it differs

Written after the fact, like PLAN-trips.md §18 and PLAN-ai-checkin.md §8.

### `requires`, which the plan did not have

§3 said objectives were "unchanged from what shipped". They gained one field.

`defaultObjectivesForFamily` dropped `kids_update` and `school_status` for a
family without children, and the plan's design had nowhere to put that rule:
`skipIfKnown` asks whether a captured FIELD already holds the answer, and this
asks whether the question applies to the household at all. Consolidating
without it would have meant childless families being asked how their children
are — the exact failure `checkin-objectives.ts` calls "the kind of thing that
ends a family's willingness to answer at all".

So an objective may name household facts it `requires`, the shipped workflow
carries them, and a test asserts the new mechanism and the old one agree for
every combination of facts. The fact vocabulary is a closed list of two,
because each one costs a query and an open expression language over custom
fields is a different, larger feature.

### The report lost its own version and name

§3's `updateFormats` had both. A report is part of a workflow version now, so
the version it belongs to is the only version it has; a second could only ever
disagree with the first.

### `checkinSettings` reports a count, not three versions

It used to name the active responder, drafter and judge. Those were three facts
because prompts were three independently promotable rows. A workflow carries
its own voice, so the only question left is whether anything is published.

### A bug the consolidation found rather than caused

`engine.ts` never forwarded the resolved report into `advanceCheckin`, so every
draft since formats shipped fell through to the default. The call-site
inventory found it; nothing else would have, because the golden set exercises
the engine directly and passes a format of its own.

### Still not built

Everything in §9, plus the trigger fields are inert: `stage_change` is stored
but nothing hooks the mutation that moves a record yet, and `schedule` has no
cron. Both were always §5's stated order — the object had to exist first.
