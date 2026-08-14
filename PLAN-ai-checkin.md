# Plan — AI family check-in engine

## 1. What this is

The first AI feature on top of the Project Jubilee foundation: a periodic
(monthly or quarterly) WhatsApp check-in with freed families, covering job,
school, kids, and general wellbeing, that produces a draft blog-style update
for a human to review and publish.

**The WhatsApp transport is not the hard part.** The hard part, and the
actual scope of this plan, is the conversation engine: how it decides what to
ask, how it decides an objective is answered, how every decision is logged so
it can be audited and tested, and how it hands off to a human the moment
something is outside what an AI should handle alone.

Everything here uses the Anthropic Messages API directly (or the Agent SDK
where noted), not a third-party conversation-flow platform.

## 2. Non-negotiable conventions carried over

Same discipline as the rest of this codebase:

- **Versioned, append-only prompts and objective schemas.** Never edit a
  live prompt in place. Insert a new version; every logged conversation
  turn records which version produced it. Same pattern as `costTemplates`.
- **Nothing AI-generated publishes without a human.** The model can draft;
  it cannot send. This is enforced architecturally (see §5), not by asking
  nicely in the system prompt.
- **Real family data never enters fixtures or test scenarios committed to
  this repo.** Eval scenarios are synthetic, modeled on real patterns but
  not real transcripts.

## 3. Conversation architecture

### 3.1 Objective-based, not free-form

Each check-in has a fixed objective set for that family (drawn from what's
already known: `job_status`, `school_status`, `kids_update`,
`general_wellbeing`, extendable per family). The responder works through
whichever objectives aren't yet answered and stops once it has them, the same
modular pattern already used for the NG grant coach.

### 3.2 Two Claude calls per turn

1. **Responder** — full context (family profile, conversation history so
   far, remaining objectives). `tool_choice: {"type": "auto"}`. This is the
   only call the family's reply is generated from.
2. **Judge** — a second, cheap call (Haiku-tier model) fed _only_ the
   objective descriptions plus the recent turns, not the family profile or
   full history. Forced tool use:
   `tool_choice: {"type": "tool", "name": "rate_objectives"}` against a
   schema that returns, per objective, a rating, an answer, and a
   confidence, with `answer` nullable so the model returns `null` instead
   of fabricating when the family hasn't addressed it yet:

   ```json
   {
   	"checks": [
   		{
   			"objective": "job_status",
   			"rating": 0.0,
   			"answer": null,
   			"confidence": 0.0
   		}
   	]
   }
   ```

   `tool_use` with a schema guarantees syntactically valid output; it does
   not guarantee the value is right, which is why confidence and nullability
   both exist, and why low-confidence answers route to human review rather
   than getting accepted silently.

### 3.3 Escalation is a first-class path, not a fallback

Build this before the blog-update feature, not after. If a family's
response contains anything indicating danger, abuse, or crisis, that is an
immediate, deterministic handoff to a human, not something inferred from
sentiment or left to model judgment (both are explicitly unreliable
escalation triggers). The escalation check runs on every incoming message,
independent of and prior to normal objective processing.

### 3.4 Publishing is a hook, not a prompt instruction

Prompt instructions are probabilistic. A `PreToolUse` hook (Agent SDK) or,
if calling the Messages API directly, the simple fact that the model is
never given a `publish_update` tool at all, only `draft_update`, is what
actually guarantees nothing goes out without a human. "Never auto-send" is
enforced architecturally, the same rule already applied to sponsor updates
elsewhere in this system.

## 4. Logging: transcript + decision trace

The API is stateless; every call resends full context. Log what was
actually sent, not deltas, one row per responder call and one row per judge
call, linked by conversation and turn:

- `conversationTurns` — familyId, turn number, promptVersion, full input
  context, model output, timestamp, latency, model name.
- `objectiveChecks` — familyId, turn number, objective, promptVersion
  (of the judge schema), rating, answer, confidence, timestamp.
- `promptVersions` — append-only, id, role (`responder` | `judge`),
  content, createdAt. Never mutated after creation.

This is both the audit trail ("why did it respond that way") and the
replay set for testing: pull real logged conversations and re-run them
against a new prompt version before shipping it.

## 5. Testing strategy

- **Golden set (5-10 synthetic scenarios)** before anything ships: a normal
  update, a struggling family, a non-responsive family, an ambiguous
  answer, a family with no school-age kids, a crisis-disclosure case
  (verifies the escalation path fires).
- **Replay real logged conversations** against any new prompt version
  before promoting it, using the versioned prompt/turn log from §4.
- **Confidence-based routing for review**, not full-manual review of every
  case: high-confidence, unambiguous check-ins can go straight to a draft
  blog update; low-confidence or flagged turns route to a human before a
  draft is even generated.

## 6. What's explicitly out of scope for v1

- The WhatsApp transport/integration itself (secondary to the engine).
- Multi-language support for the check-in (English/Spanish only initially,
  same rationale as the rest of the platform).
- Fully autonomous publishing, under any confidence threshold. Publishing
  stays human-gated indefinitely, not just for v1.

## 7. Open questions

- Exact objective set per family type (does every family get the same four
  objectives, or does it vary by stage/case type?).
- Cadence: monthly vs quarterly, and whether it's configurable per family
  or per campaign.
- Which model tier for the responder (cost vs quality tradeoff once real
  conversation volume is known).

## 8. What actually shipped, and where it differs

This section is written after the fact, like PLAN-trips.md §18. Everything
above is the plan as written; everything below is where the code diverges from
it, and why.

### The two calls run judge-first, not responder-first

§3.2 numbers the responder 1 and the judge 2. The engine runs them the other
way round.

The reason is §3.1's own stopping rule: "the responder works through whichever
objectives aren't yet answered and **stops once it has them**." A responder that
runs before the judge cannot know that the message it is answering was the last
one needed — so it asks one more question after the family has already told us
everything, every single time. Rating first costs nothing, because the judge
never sees the responder's output either way.

The logging contract §4 actually specifies is unchanged: one row per responder
call, one per judge call, linked by conversation and turn.

There is one further consequence worth naming: on the OPENING turn there is no
incoming message, so there is nothing to rate and the judge call is skipped
entirely. A turn is one or two model calls, not always two.

### A fifth table: `checkinMessages`

§4 names three tables, and all three exist. A fourth — the transcript — was
added.

The plan's three are the _decision_ trace: what was sent to a model and what
came back. The transcript is a different fact, and without its own table the
only place it exists is embedded inside each responder call's `input`, mixed
with the profile and the outstanding-objective list in whatever shape that
prompt version happened to use. Recovering "what did the family say" by parsing
a prompt would make the engine, the admin view and the replay harness all
depend on a prompt's formatting — the one thing this design guarantees will
change.

It is also the seam the WhatsApp transport (§6, out of scope) plugs into:
`outbound` rows are what something else sends, `inbound` rows are what it
delivers back.

### `drafter` is a third prompt role

§2 and §4 imply two roles, `responder` and `judge`. There are three. The
drafter writes _about_ a family for supporters; the responder writes _to_ a
family. Same tier, different job, different reader — and collapsing them would
mean only one of the two could be the active version at a time.

Its output tool is `draft_update` and there is no sibling that sends one, which
is §3.4 enforced rather than requested.

### Two things §7 left open, and what was decided

**Objective set per family.** Every family gets the same four, minus the ones
that do not apply: no `kids_update` for a family with no children, no
`school_status` with no school-age children. The set is snapshotted onto the
conversation at open, the same contract `budgets` keep with `costTemplates`.
The rule is one function — `defaultObjectivesForFamily` — so widening it later
is a change in one place.

**Cadence.** Still open, and deliberately not implemented. There is no cron. A
conversation is opened by an explicit `startCheckin` call, because "monthly or
quarterly, per family or per campaign" is a product decision and the thing that
would consume it — the transport — is out of scope. Wiring a cron to
`startCheckin` is the whole of the remaining work once that is decided.

**Responder model tier.** `claude-opus-5` by default, overridable with
`CHECKIN_RESPONDER_MODEL`. Top tier because the responder's failure mode is a
clumsy message to a family in a fragile situation, not a worse sentence. The
judge is `claude-haiku-4-5` per §3.2, which is where the volume is.

### Additions the plan did not call for

- **A turn cap** (`MAX_RESPONDER_TURNS = 6`). §5's "non-responsive family"
  scenario has no terminating condition otherwise. Hitting it routes to a
  person, exactly like a low-confidence answer.
- **`model_error` as a review reason.** A refused, truncated, or tool-call-less
  model response is a conversation for a person. §3.3 covers what a _family_
  discloses; this covers the model declining to engage with it.
- **Server-side fallbacks on every call** (`fallbacks: "default"`). This
  system's incoming messages are about bonded labour, abuse and coercion, so a
  safety classifier declining a request is routine here rather than exotic.
  `stop_reason` is checked before `content` is read on every call.
- **`updates.checkinConversationId`.** Marks a post as machine-drafted and
  links it back to the transcript and the decision trace. An AI draft with no
  path to its evidence is not reviewable, it is just text. Machine drafts also
  carry a sentinel `authorUserId` that resolves to nobody, so a staff member's
  name never appears on prose they have not read.

### Still not built, and still correct not to be

Everything in §6. The WhatsApp transport, multi-language beyond the English
and Spanish the escalation scanner reads, and autonomous publishing — which
stays architecturally impossible rather than merely disabled, because no code
path in `checkins/` writes `status: 'published'` and the drafting model is
never given a tool that could.

**No admin UI shipped.** The queries exist — `listCheckins`, `getCheckin` with
the whole trace, `listEscalations`, `listPromptVersions` — and nothing under
`svelte/src/routes` calls them yet. The plan is explicit that its scope is the
conversation engine rather than a surface, so this is a deliberate stop rather
than an omission; the escalation queue in particular is the first screen anyone
should build, because an escalation nobody can see is an escalation that did
not happen.

The §5 replay harness is _possible_ but not packaged: the engine takes a
`CheckinModel`, so re-running a logged conversation against a new prompt
version is a loop over `conversationTurns` feeding `advanceCheckin`. The golden
set in `checkin-engine.test.ts` is that loop, with synthetic inputs. What is
missing is the admin-facing button that runs it over real logged conversations.
