# Wiring up Stripe Connect

How online giving gets built on this codebase. Written against the repo as of the `portal` branch,
Aug 2026.

> **Status, 2026-08-04.** This is no longer a plan for future work — every step of §15 is built,
> deployed and typechecked. What remains is **verification against a real Stripe sandbox**: no API
> key has been configured, so not one call in this integration has ever left the building. Read §15
> for what is done and what to do first once keys exist. The sections below are still accurate as
> design rationale; where reality diverged from the original plan, the divergence is called out
> inline.

---

## 0. Decisions, up front

| Decision | Choice | Why |
| --- | --- | --- |
| Charge type | **Direct charges** | Nonprofit is merchant of record; unlocks per-org nonprofit rate |
| Account config | Standard-equivalent controller properties | Orgs get their own dashboard and their own Stripe relationship |
| Fee payer | `controller.fees.payer = "account"` | The org pays Stripe at *its* discounted rate |
| Loss owner | `controller.losses.payments = "stripe"` | We never become an unsecured creditor of our own orgs |
| Onboarding | Hosted Account Links → embedded components for ongoing management | Full-dashboard accounts can't do seamless embedded onboarding |
| Convex Stripe component | **Do not use** | `@convex-dev/stripe` has zero Connect support |
| Donor UI | Payment Element, mounted directly (no wrapper lib) | Custom amounts, live fee-cover, per-org branding |
| Fulfillment | Webhook-driven, always | The browser is not a reliable witness that money moved |
| Recurring | Subscriptions on the connected account | Smart Retries + Card Account Updater are the retention story |

### Why direct charges

This is the load-bearing decision and it is worth stating the reasoning plainly.

Stripe's nonprofit discount (~2.2% + 30¢ vs 2.9% + 30¢) attaches to **whichever account pays the
processing fee**. With direct charges and `fees.payer = "account"`, each nonprofit applies for that
discount itself and keeps it. With destination charges, *we* pay at *our* rate card and the discount
is structurally unreachable for every org on the platform. At any real volume this dwarfs every
other consideration.

Four more reasons stack on top:

1. **Legal correctness.** A tax-deductible gift is made to the 501(c)(3), not to us. Direct charges
   put the nonprofit's name on the donor's bank statement and on the Stripe receipt, matching the
   acknowledgment letter the nonprofit issues. Being merchant of record for a charitable gift we did
   not receive raises charitable-solicitation-registration and donor-advised-fund questions.
2. **Charity interchange.** `business_profile.mcc = "8398"` (Charitable and Social Service
   Organizations) only means anything when the connected account is the merchant. Visa/Mastercard
   charity interchange programs key off MCC, and this is additive to Stripe's own discount.
3. **Dispute liability lands where the donor relationship is.** A chargeback on a $5,000 gift debits
   the nonprofit's balance, not ours. With destination charges, Stripe debits the *platform* in full
   and we'd have to build a whole transfer-reversal recovery pipeline.
4. **1099-K is Stripe's filing, not ours.** `fees.payer = "account"` makes Stripe the filer. That's
   an entire compliance workstream we don't staff.

### What we give up, honestly

- **Reporting fragments across N accounts.** We cannot `paymentIntents.list()` across the platform.
  Our own ledger, built from webhooks, is the source of truth for every admin view. This suits the
  existing `transactions` / `allocations` design well, but it must be built from day one —
  retrofitting cross-org reporting is brutal.
- **One donation cannot be split across multiple orgs.** A donor giving $100 across three
  nonprofits is three separate charges and three times the 30¢ fixed fee.
- **Refunds are bounded by the org's balance**, and a refund never returns Stripe's processing fee.
- **Donor payment methods don't carry across orgs** without PaymentMethod cloning (§7.4).

> **Decision needed before building.** If the product must split a single donation across multiple
> orgs, or hold funds in escrow before disbursing, that is a *fundamentally different legal
> structure* (a giving fund / DAF model) and requires separate charges and transfers. This flips the
> recommendation. Resolve it now, not after onboarding starts — `controller.stripe_dashboard.type`
> is immutable after account creation, so changing course later means re-onboarding every org.

---

## 1. Why not `@convex-dev/stripe`

Verified, not assumed: grepping the entire `get-convex/stripe` source for
`connect|stripeAccount|Stripe-Account|application_fee|transfer_data|on_behalf_of` returns **zero
matches**. There is no accounts table in its schema, and no method accepts Stripe `RequestOptions` —
which is the only place `{ stripeAccount }` could go. There is not even a seam to extend.

It is a single-account SaaS-billing component: customers, subscriptions, invoices, customer portal.
Adopting it would mean hand-writing 80%+ of our payment surface anyway, alongside a component we
can't extend, with tables in an isolated namespace that can't be joined against `transactions`,
`allocations`, or `campaigns`.

The usual argument for it — "it handles the annoying webhook plumbing" — is thin. That plumbing is
about forty lines (§8). And the component has no event-id dedupe and no out-of-order guard, so we'd
be adding those ourselves regardless.

Two smaller strikes: it declares a **non-optional `react` peer dependency** (we're SvelteKit), and
its documented usage pattern (`userId: identity.subject`) violates the project guideline mandating
`tokenIdentifier`.

**Verdict: hand-roll with the `stripe` npm SDK.**

There is a community package, `@raideno/convex-stripe`, that *does* support Connect. It is not a
Convex component (it spreads its tables into your app schema), it's solo-maintained, months stale,
and at ~0.4% the download volume of the official one. Read its Connect code as a reference
implementation; don't depend on it.

**Narrow exception, later:** if we ever charge orgs a platform subscription fee, `@convex-dev/stripe`
is a reasonable fit for *that* slice specifically, and can coexist since its tables are namespaced.
Separate decision, separate day.

### No `"use node"` required

`stripe@22` ships `worker`/`workerd` export conditions, and Convex's default runtime provides
`SubtleCrypto` and `fetch`. The official component itself ships this way with no `"use node"`
anywhere.

The one rule: use **`stripe.webhooks.constructEventAsync(...)`**, never the synchronous
`constructEvent` (which reaches for Node's `crypto`). Older Convex+Stripe writeups use the
`"use node"` + sync-verify pattern; that is legacy and our guidelines now call the extra
action-to-action runtime hop an anti-pattern.

`http.ts` can never be `"use node"` regardless — HTTP actions run in the same runtime as queries and
mutations.

> Verify on the first `npx convex dev` push that the bundler resolves the SDK's `worker` export. If
> it doesn't, fall back to `"use node"` internal actions — but the official component shipping this
> way is strong evidence it will.

---

## 2. Where this lands in the existing codebase

Everything below is grounded in what's already there.

### The ledger we're feeding

`transactions` ([schema.ts:436](svelte/src/convex/schema.ts:436)) — integer cents, always.
`type: 'donation' | 'transfer' | 'expenditure'`, `orgId` denormalized as `v.string()`, optional
`contactId`, free-text `method` and `reference`. **No campaign on the row.**

`allocations` ([schema.ts:459](svelte/src/convex/schema.ts:459)) — attribution.
`transactionId` + `campaignId` + optional `projectId`. A project-less allocation is campaign-level.
Invariant: `sum(allocations) <= transaction.amountCents`.

`recordProjectDonation` ([donation.ts:28](svelte/src/convex/transactions/donation.ts:28)) writes
both rows in one mutation so they commit or roll back together. It gates on
`requireCapability(ctx, 'money:write', campaignId)` — **which a webhook cannot satisfy**, since
there's no session. Online giving needs an `internalMutation` sibling that takes the same care with
the invariants but derives trust from the verified Stripe signature instead of from a user.

### Multi-tenancy

`orgId` is a Better Auth organization id, denormalized as `v.string()` on every row. There is no
`organizations` table. It is resolved **from the session only**, in
[model/access.ts:42](svelte/src/convex/model/access.ts:42) — never from arguments.

Webhooks invert this: there is no session, so `orgId` must be resolved from the Stripe account id.
That's why `stripeAccounts` below needs a `by_stripeAccountId` index.

Public routing is `orgSlug` (`orgSettings.slug`, globally unique) + `campaignSlug` (unique per org),
resolved in [public/queries.ts:29](svelte/src/convex/public/queries.ts:29).

### The permission gate is already there

`billing:manage` exists in [permissions.ts](svelte/src/lib/domain/permissions.ts) as an
**`OWNER_ONLY`** capability, granted to `owner` alone, and has **zero call sites** anywhere in the
app. It was written down and never used. Connect settings are exactly what it was for.

### Webhook and secret conventions

[http.ts](svelte/src/convex/http.ts) has exactly one app-owned route — the Resend webhook — via
`http.route({ path, method, handler: httpAction(...) })`. Endpoints serve from `CONVEX_SITE_URL`.

Secrets live in Convex deployment env only, read as bare `process.env.X` at module scope with a
per-use throw guard ([email.ts:16](svelte/src/convex/email.ts:16)). `svelte/.env.local` holds only
three non-secret Convex URLs; there is no `.env.example`. SvelteKit server code never reads a
secret — it only forwards the Better Auth session token.

> **Guideline tension.** The project Convex guidelines prefer typed env declared in
> `defineApp({ env: { ... } })` and read via `env` from `_generated/server`, over `process.env`.
> Existing code predates this. **Use typed env for the new Stripe keys**; leave existing code alone.

### The donor UI that already exists

[DonationForm.svelte](svelte/src/lib/features/public-site/DonationForm.svelte) collects amount
presets `[2500, 5000, 10000, 25000]`, custom amount, `once | monthly`, cover-fees, anonymous, donor
name, email, message, and a honeypot. All local `$state`; `onsubmit` calls `preventDefault()` and
nothing else. It's wrapped in `<fieldset {disabled}>`, and `disabled` is **hardcoded at the call
site** — [+page.svelte:223](svelte/src/routes/(site)/[orgSlug]/[campaignSlug]/[objectSlug]/[number]/+page.svelte:223)
passes bare `disabled`, not a derived value. That becomes
`disabled={!campaign.acceptsOnlineGifts}`.

Seventeen `publicSite_donate*` i18n keys already exist in `svelte/messages/en.json:769-785`,
including `publicSite_donateSecureNote` — "Card details are entered on Stripe's secure checkout,
never on this page."

### Frontend conventions to match

Svelte 5 runes exclusively. shadcn-svelte primitives over `@ark-ui/svelte`, Tailwind v4. No form
actions, no superforms, no zod — plain `onsubmit` + `event.preventDefault()` + `client.mutation(...)`
in try/catch, `ConvexError.data` surfaced through `svelte-sonner`, an `isSaving` guard. Reads use
`useQuery(api.x.y, () => cond ? args : 'skip')`. Money is never formatted inline — always
`formatCents` from `$lib/features/money/format`.

---

## 3. Money flow

A $100 gift where the donor covers fees, to an org on the nonprofit rate, with a 2% platform fee:

```
Donor charged                      $102.56   (gross-up, §9)
  ├─ Stripe fee        $2.56   ← from ORG balance, at ORG's 2.2% + 30¢
  ├─ application fee   $2.05   ← to PLATFORM balance
  └─ org net          $97.95
```

Note what this means for the ledger: the **donor's gift** is $102.56 (that is the tax-deductible
amount), the **org's receipt** is $97.95, and our revenue is $2.05. All three numbers need to be
stored. Campaign totals should be computed from `transactions` gross, never incremented in a webhook
handler — refunds, disputes, ACH failures and duplicate deliveries all mutate the truth.

---

## 4. Schema additions

Four new tables. Money stays in `transactions`; everything Stripe-shaped lives beside it.

```ts
// Per-org Stripe Connect state. Mirrors what Stripe tells us, plus what we
// configure ourselves. One row per org per livemode.
const stripeAccounts = defineTable({
  orgId: v.string(),
  stripeAccountId: v.string(),
  livemode: v.boolean(),

  // Mirrored from account.updated / accounts.retrieve
  chargesEnabled: v.boolean(),
  payoutsEnabled: v.boolean(),
  detailsSubmitted: v.boolean(),
  capabilityCardPayments: v.optional(v.string()),  // active | pending | inactive | unrequested
  capabilityTransfers: v.optional(v.string()),
  requirementsCurrentlyDue: v.array(v.string()),
  requirementsPastDue: v.array(v.string()),
  requirementsPendingVerification: v.array(v.string()),
  requirementsDisabledReason: v.optional(v.string()),
  requirementsCurrentDeadline: v.optional(v.number()),

  // Derived for the UI. Never expose raw Stripe flags to the product surface.
  status: v.union(
    v.literal('onboarding'),
    v.literal('pending_review'),
    v.literal('action_required'),
    v.literal('charges_only'),
    v.literal('active'),
    v.literal('restricted'),
    v.literal('rejected')
  ),

  // Platform-owned config
  feeRate: v.number(),            // 0.029 default; 0.022 once the discount lands
  feeFixedCents: v.number(),      // 30
  platformFeeBps: v.number(),     // our cut, basis points
  walletDomainsRegistered: v.array(v.string()),

  // Sync hygiene — account.updated is chatty and arrives out of order
  lastEventCreatedAt: v.number(),
  lastSyncedAt: v.number()
})
  .index('by_orgId', ['orgId'])
  .index('by_stripeAccountId', ['stripeAccountId']);   // webhook -> org resolution
```

```ts
// The donor-facing lifecycle. A gift lives here from "donor clicked give" until
// it settles. Only on success does a `transactions` row get written — the ledger
// never holds pending money.
const donationIntents = defineTable({
  orgId: v.string(),
  campaignId: v.id('campaigns'),
  projectId: v.optional(v.id('projects')),      // campaign-level gift when absent

  status: v.union(
    v.literal('pending'),
    v.literal('processing'),      // ACH in flight — NOT money yet
    v.literal('succeeded'),
    v.literal('failed'),
    v.literal('refunded'),
    v.literal('disputed')
  ),

  // Money. All three numbers matter; see §3.
  intendedCents: v.number(),      // what the donor meant to give
  chargedCents: v.number(),       // what we charged (gross-up applied)
  coverFees: v.boolean(),
  stripeFeeCents: v.optional(v.number()),      // actual, from balance_transaction
  platformFeeCents: v.optional(v.number()),
  netCents: v.optional(v.number()),            // what the org actually received

  // Stripe handles
  stripeAccountId: v.string(),
  stripePaymentIntentId: v.optional(v.string()),
  stripeChargeId: v.optional(v.string()),
  stripeInvoiceId: v.optional(v.string()),     // set when this is a recurring installment
  recurringGiftId: v.optional(v.id('recurringGifts')),

  // Donor intent
  contactId: v.optional(v.id('contacts')),
  donorName: v.optional(v.string()),
  donorEmail: v.optional(v.string()),
  anonymous: v.boolean(),         // "don't show my name publicly" — NOT "we don't know who"
  designation: v.optional(v.string()),
  dedicationType: v.optional(v.union(v.literal('honor'), v.literal('memory'))),
  dedicationName: v.optional(v.string()),
  message: v.optional(v.string()),

  transactionId: v.optional(v.id('transactions')),   // set on success
  failureMessage: v.optional(v.string())
})
  .index('by_orgId', ['orgId'])
  .index('by_orgId_and_status', ['orgId', 'status'])
  .index('by_campaignId', ['campaignId'])
  .index('by_stripePaymentIntentId', ['stripePaymentIntentId'])
  .index('by_stripeInvoiceId', ['stripeInvoiceId'])
  .index('by_contactId', ['contactId']);
```

```ts
// A monthly pledge. One Stripe Subscription, on the connected account.
const recurringGifts = defineTable({
  orgId: v.string(),
  campaignId: v.id('campaigns'),
  projectId: v.optional(v.id('projects')),
  contactId: v.optional(v.id('contacts')),

  status: v.union(
    v.literal('incomplete'),
    v.literal('active'),
    v.literal('past_due'),
    v.literal('paused'),
    v.literal('canceled')
  ),
  amountCents: v.number(),
  interval: v.union(v.literal('month'), v.literal('year')),
  coverFees: v.boolean(),
  designation: v.optional(v.string()),
  anonymous: v.boolean(),

  stripeAccountId: v.string(),
  stripeCustomerId: v.string(),        // lives on the CONNECTED account
  stripeSubscriptionId: v.string(),
  currentPeriodEnd: v.optional(v.number()),
  cancelAtPeriodEnd: v.boolean(),

  donorEmail: v.optional(v.string()),
  donorName: v.optional(v.string())
})
  .index('by_orgId', ['orgId'])
  .index('by_orgId_and_status', ['orgId', 'status'])
  .index('by_stripeSubscriptionId', ['stripeSubscriptionId'])
  .index('by_contactId', ['contactId']);
```

```ts
// Delivery dedupe. Stripe guarantees AT LEAST ONCE and does NOT guarantee order.
const stripeEvents = defineTable({
  stripeEventId: v.string(),
  type: v.string(),
  stripeAccountId: v.optional(v.string()),   // absent on platform events
  livemode: v.boolean(),
  createdAt: v.number(),                      // event.created, for ordering guards
  receivedAt: v.number(),
  handledAt: v.optional(v.number()),
  error: v.optional(v.string())
}).index('by_stripeEventId', ['stripeEventId']);
```

Plus a small addition to `orgSettings` for receipting (§10):

```ts
legalName: v.optional(v.string()),
ein: v.optional(v.string()),
acknowledgmentText: v.optional(v.string()),
```

### Notes on the shape

- **No `campaigns.acceptsOnlineGifts` column.** Derive it: the campaign is published *and* its org's
  `stripeAccounts.status === 'active'`. Denormalizing a flag that Stripe owns invites drift.
- **`anonymous` is explicit.** Today anonymity is modeled as the *absence* of `contactId`, which
  cannot distinguish "the donor chose anonymity" from "we never captured who this was." Online
  giving always knows the donor (we have their email for the receipt), so we need the boolean.
- **`transactions` gains nothing.** The link is `donationIntents.transactionId`. Set
  `transactions.method = 'stripe'` and `reference = <payment_intent_id>` for continuity with the
  manual-entry UI, but the authoritative join is the id.
- **Table name conventions** follow the existing `by_field1_and_field2` index-naming rule.

---

## 5. Convex module layout

Matching the existing one-directory-per-noun, split-by-kind convention:

```
svelte/src/convex/stripe/
  accounts.ts       actions: create account, mint Account Links, refresh status
  onboarding.ts     mutations/queries backing the admin onboarding UI
  donations.ts      action: createDonationIntent (public, unauthenticated)
  recurring.ts      actions: create/update/cancel subscriptions
  webhooks.ts       internalMutations: the event handlers
  queries.ts        authed reads for the admin surface
svelte/src/convex/model/
  stripe.ts         shared helpers: deriveStatus, resolveOrgByAccount, fee math
```

Rules this must respect, from the project guidelines:

- **Argument validators on every function**, including internal ones. A Stripe event cannot be
  passed through as `v.any()` — model the fields we actually consume.
- **The mutation an HTTP action calls is `internal`**, never public.
- **Never accept an identifier for authorization purposes as an argument.** For authed paths, derive
  from `ctx.auth`. For webhook paths, trust comes from the verified signature, and the org is
  resolved from `stripeAccountId` server-side — never from event metadata.
- **`crons.interval` / `crons.cron` only** — not the `daily`/`hourly` helpers.
- **`.take()` or paginate**, never `.collect()`; never `.collect().length` to count.
- Actions are **at most once** and are not auto-retried. Use `ctx.scheduler.runAfter` with backoff,
  or `@convex-dev/workpool` for bounded-parallelism retries of idempotent Stripe calls.

---

## 6. Connect onboarding

### Creating the account

```ts
const account = await stripe.accounts.create({
  country: 'US',
  email: orgAdminEmail,
  business_type: 'non_profit',        // routes KYC to EIN + determination letter,
                                      // representative + directors — not 25% owners
  controller: {
    fees:                   { payer: 'account' },
    losses:                 { payments: 'stripe' },
    stripe_dashboard:       { type: 'full' },     // IMMUTABLE — decide before launch
    requirement_collection: 'stripe'
  },
  capabilities: {
    card_payments: { requested: true },
    transfers:     { requested: true }    // required alongside card_payments, or NEITHER activates
  },
  business_profile: {
    mcc: '8398',                          // Charitable and Social Service Organizations
    name: org.legalName,
    url: org.website,
    product_description: 'Charitable donations'
  },
  settings: {
    payments: { statement_descriptor: 'HABITAT RESTORE' }
  },
  metadata: { jubilee_org_id: orgId }
}, { idempotencyKey: `acct:create:${orgId}` });
```

### Onboarding links

```ts
const link = await stripe.accountLinks.create({
  account: accountId,
  type: 'account_onboarding',
  refresh_url: `${APP_URL}/app/admin/giving/stripe/refresh`,
  return_url:  `${APP_URL}/app/admin/giving/stripe/return`,
  collection_options: { fields: 'eventually_due', future_requirements: 'omit' }
});
```

**Account Links expire in 5 minutes and are single-use.** Never store or email the URL — mint it in
the POST handler that redirects. `refresh_url` is hit when a link expired or was already consumed;
that endpoint mints a fresh one and redirects again.

**`return_url` means "the user came back," not "the account is ready."** Always re-fetch the account
and run it through the same reducer the webhook uses.

### The status machine

Gate donation acceptance on **`charges_enabled === true`**. Never on `details_submitted` — that flag
means only "they finished a form." This is the single most common Connect integration bug.

```ts
export function deriveStatus(a: Stripe.Account): OrgPayoutStatus {
  const r = a.requirements;
  if (r?.disabled_reason?.startsWith('rejected')) return 'rejected';
  if (!a.details_submitted) return 'onboarding';
  if ((r?.past_due?.length ?? 0) > 0) return 'action_required';
  if ((r?.currently_due?.length ?? 0) > 0) return 'action_required';
  if (!a.charges_enabled && (r?.pending_verification?.length ?? 0) > 0) return 'pending_review';
  if (!a.charges_enabled) return 'restricted';
  if (!a.payouts_enabled) return 'charges_only';
  return 'active';
}
```

`charges_only` is real and frequent — KYC passed but the bank account failed micro-deposit or was
mistyped. Donations keep arriving into a balance the org can't withdraw. Surface it loudly.

### Wallet domain registration — do not skip this

Apple Pay, Google Pay, and Link all require domain registration, and **a platform registering its own
domain does not cover its connected accounts.** With direct charges, every donation domain must be
registered on **every** connected account, via API (the Dashboard can't do it for connected
accounts).

```ts
for (const domain_name of DONATION_DOMAINS) {
  await stripe.paymentMethodDomains.create({ domain_name }, {
    stripeAccount: accountId,
    idempotencyKey: `pmd:${accountId}:${domain_name}`
  });
}
```

Wire this to fire the moment an account reaches `charges_enabled`. Store the returned per-wallet
status on the org row and surface "Apple Pay: not active" in admin. Silent wallet absence is
invisible — the Payment Element simply doesn't render the button — and it's the classic "why is our
conversion bad" ticket.

Registering in **live mode also registers sandboxes**; sandbox-only registration does not work in
live. Every domain and subdomain is separate; no wildcards.

### Onboarding UI

Hosted Account Links for initial onboarding, embedded components for ongoing management. The reason
we can't use embedded onboarding: `disable_stripe_user_authentication` requires
`requirement_collection: 'application'`, which conflicts with full-dashboard accounts. Users would
hit a jarring Stripe auth prompt inside our page. Redirecting to Stripe for the initial pass makes
that handoff expected.

For the org portal afterwards, embed `payments`, `payouts`, `balances`, `documents`, and
`notification_banner` via Account Sessions. Let the nonprofit control its own payout schedule —
finance staff have opinions about deposit cadence.

Gate all of it on **`billing:manage`** (owner-only, already defined, currently unused).

---

## 7. The donation flow

### 7.1 Server: create the PaymentIntent

A **public Convex action** — the donor is unauthenticated. Trust nothing from the client except the
campaign reference and the donor's stated intent.

```ts
export const createDonationIntent = action({
  args: {
    orgSlug: v.string(),
    campaignSlug: v.string(),
    projectNumber: v.optional(v.string()),
    intendedCents: v.number(),
    coverFees: v.boolean(),
    donorName: v.string(),
    donorEmail: v.string(),
    anonymous: v.boolean(),
    designation: v.optional(v.string()),
    dedicationType: v.optional(v.union(v.literal('honor'), v.literal('memory'))),
    dedicationName: v.optional(v.string()),
    message: v.optional(v.string())
  },
  handler: async (ctx, args) => {
    // 1. Resolve org + campaign + connected account from OUR data. Never from the client.
    const target = await ctx.runQuery(internal.stripe.queries.resolveGiftTarget, {
      orgSlug: args.orgSlug, campaignSlug: args.campaignSlug, projectNumber: args.projectNumber
    });
    if (!target) throw new ConvexError('This campaign cannot accept gifts yet.');

    // 2. Recompute money server-side. The client's figure is a display hint.
    const chargedCents = args.coverFees
      ? grossUpForFees(args.intendedCents, target.feeRate, target.feeFixedCents)
      : args.intendedCents;
    assertGiftAmount(chargedCents);   // >= 50 cents, <= platform max

    // 3. Our row first, so we own the id used for idempotency and correlation.
    const donationIntentId = await ctx.runMutation(internal.stripe.webhooks.createPendingGift, {
      ...args, chargedCents, stripeAccountId: target.stripeAccountId
    });

    const intent = await stripe.paymentIntents.create({
      amount: chargedCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      application_fee_amount: platformFeeCents(chargedCents, target.platformFeeBps),
      description: `Donation — ${target.campaignName}`,
      receipt_email: args.donorEmail,
      metadata: {
        jubilee_donation_intent_id: donationIntentId,
        jubilee_org_id: target.orgId,
        jubilee_campaign_id: target.campaignId,
        jubilee_env: APP_ENV,
        jubilee_intended_cents: String(args.intendedCents),
        jubilee_charged_cents: String(chargedCents),
        jubilee_cover_fees: String(args.coverFees),
        jubilee_anonymous: String(args.anonymous),
        jubilee_meta_v: '1'
      }
    }, {
      stripeAccount: target.stripeAccountId,           // <- this is what makes it a direct charge
      idempotencyKey: `pi_create:${donationIntentId}`
    });

    await ctx.runMutation(internal.stripe.webhooks.attachPaymentIntent, {
      donationIntentId, stripePaymentIntentId: intent.id
    });

    return {
      clientSecret: intent.client_secret,
      stripeAccount: target.stripeAccountId,
      donationIntentId,
      chargedCents
    };
  }
});
```

Notes:

- **Request options are the second argument** to `stripe.paymentIntents.create`, not a field in the
  params object. `stripeAccount` and `idempotencyKey` both live there.
- **Idempotency keys are scoped per connected account.** Include our own domain id in the key.
  Reusing a key with different params errors — which is exactly the safety net we want.
- **Metadata is a convenience mirror, not the source of truth.** A nonprofit admin can edit metadata
  in their own Stripe Dashboard. The webhook resolves by `stripePaymentIntentId` against our table
  first; metadata is fallback only. Limits: 50 keys, 40-char names, 500-char values, no PII.

**Abuse control.** An open, unauthenticated, arbitrary-amount endpoint is a perfect card-testing
oracle, and card-testing bursts produce mass chargebacks that hit *the nonprofit's* dispute ratio.
Before launch: rate-limit by IP and by donor fingerprint, enforce a minimum amount, keep the existing
honeypot field, enable Radar rules, and subscribe to `radar.early_fraud_warning.created`.

### 7.2 Client: mounting the Payment Element

The one rule that trips everyone up: **initialize Stripe.js with the same connected account the
PaymentIntent was created on.**

```ts
// svelte/src/lib/features/donate/stripe-client.ts
import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { PUBLIC_STRIPE_PUBLISHABLE_KEY } from '$env/static/public';

const cache = new Map<string, Promise<Stripe | null>>();

/** Direct charges require the client to be scoped to the same acct_ as the intent. */
export function stripeForAccount(stripeAccount: string): Promise<Stripe | null> {
  let p = cache.get(stripeAccount);
  if (!p) {
    p = loadStripe(PUBLIC_STRIPE_PUBLISHABLE_KEY, { stripeAccount });
    cache.set(stripeAccount, p);
  }
  return p;
}
```

We use **our platform's publishable key** with the `stripeAccount` option — there is no such thing as
fetching a connected account's publishable key. `stripeAccount` is a **constructor option only**; a
different org means a different `loadStripe` call.

`clientSecret` is **not** an updatable Elements option. When the amount changes and we mint a new
intent, the Elements instance must be torn down and rebuilt — `{#key intent.clientSecret}` in the
parent.

```svelte
<script lang="ts">
  let { stripeAccount, clientSecret, returnUrl, appearance } = $props();

  let mountNode = $state<HTMLDivElement>();
  let stripe = $state<Stripe | null>(null);
  let elements = $state<StripeElements | null>(null);
  let paymentElement: StripePaymentElement | null = null;
  let complete = $state(false);
  let errorMessage = $state<string | null>(null);

  $effect(() => {
    const account = stripeAccount, secret = clientSecret, node = mountNode;
    if (!node || !secret || !account) return;
    let cancelled = false;

    (async () => {
      const s = await stripeForAccount(account);
      if (cancelled || !s) return;

      const els = s.elements({ clientSecret: secret, appearance, loader: 'auto' });
      const pe = els.create('payment', {
        layout: { type: 'accordion', defaultCollapsed: false, radios: true },
        // Donors are giving, not buying. We collect name/email ourselves so we
        // can write them to Convex.
        fields: { billingDetails: { name: 'never', email: 'never' } }
      });
      pe.on('change', (e) => { complete = e.complete; errorMessage = null; });
      pe.mount(node);
      stripe = s; elements = els; paymentElement = pe;
    })();

    return () => { cancelled = true; paymentElement?.destroy(); paymentElement = null; elements = null; };
  });

  export async function confirm(billing: { name: string; email: string }) {
    if (!stripe || !elements) return { ok: false as const, message: 'Payment form not ready.' };

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: returnUrl,
        payment_method_data: { billing_details: { name: billing.name, email: billing.email } }
      },
      // Default is 'always' — Stripe redirects even for cards. 'if_required' keeps
      // card and wallet donors on-page and only redirects for 3DS / bank redirects.
      redirect: 'if_required'
    });

    if (error) { errorMessage = error.message ?? 'Something went wrong.'; return { ok: false as const, message: errorMessage }; }
    return { ok: true as const, status: paymentIntent?.status ?? 'unknown' };
  }
</script>

<div bind:this={mountNode}></div>
{#if errorMessage}<p role="alert" class="text-sm text-destructive">{errorMessage}</p>{/if}
```

**Mount Stripe.js directly — don't use `svelte-stripe`.** It is genuinely Svelte 5 and reasonably
maintained, but its `Elements.svelte` runs `$effect(() => elements?.update(options))` across all
spread props, which fights the `clientSecret` immutability we hit on every amount change. It also
calls `registerAppInfo` attributing the integration to the wrapper. It's forty lines to own.

### 7.3 The return page

Stripe appends `payment_intent` and `payment_intent_client_secret` to `return_url` — **but not the
connected account id**, which `retrievePaymentIntent` needs for a direct charge. So put our own
donation id in the URL when we build it server-side and look the account up from it:

```
return_url: `${origin}/${orgSlug}/${campaignSlug}/thanks?d=${donationIntentId}`
```

Then the thanks page **subscribes to the donation row via Convex** and updates live as the webhook
lands. This is materially better than every Stripe example, which polls or reads a one-shot status —
we already have the reactivity, so use it.

Copy matters here. Say "Thank you — we're confirming your gift," not "Your donation of $50 has been
received." For ACH you genuinely cannot assert the latter yet.

### 7.4 Recurring

Subscriptions created **on the connected account** — Customer, Product, and Subscription all live
there for direct charges.

```ts
const opts = { stripeAccount: target.stripeAccountId };

const customer = await stripe.customers.create({
  email: donorEmail, name: donorName,
  metadata: { jubilee_contact_id: contactId, jubilee_org_id: orgId }
}, { ...opts, idempotencyKey: `cust:${contactId}:${orgId}` });

// Inline price_data — donors give $37/month, not $25. Don't build a Price catalog.
const subscription = await stripe.subscriptions.create({
  customer: customer.id,
  items: [{ price_data: {
    currency: 'usd',
    product: target.stripeProductId,     // one Product per campaign
    unit_amount: chargedCents,
    recurring: { interval: 'month' }
  }}],
  payment_behavior: 'default_incomplete',
  payment_settings: { save_default_payment_method: 'on_subscription' },
  application_fee_percent: platformFeePercent,
  metadata: recurringMetadata,
  expand: ['latest_invoice.confirmation_secret']
}, { ...opts, idempotencyKey: `sub:${recurringGiftId}` });

const clientSecret = subscription.latest_invoice.confirmation_secret.client_secret;
```

**The client side is byte-identical to the one-time flow** — same Elements, same
`confirmPayment`. Only the endpoint minting the client secret differs. That's precisely why the
once/monthly toggle is cheap with the Payment Element and expensive with hosted Checkout (which
would need a Price object per org × amount × interval).

Note `application_fee_percent` (a percentage, per invoice) rather than `application_fee_amount`.

Documented Connect restrictions that matter:

- The platform **cannot update or cancel subscriptions it didn't create**.
- Subscriptions are **not auto-canceled when an org disconnects**. On
  `account.application.deauthorized` we must cancel them ourselves, or keep charging donors for an
  org that left.
- `application_fee_percent` keeps applying after disconnect on direct charges.

**Donor self-service: build it ourselves.** Stripe's Billing customer portal documents the
`on_behalf_of` pattern, which describes the destination-charge model where the Customer lives on the
platform. For direct charges, where the Customer lives on the connected account, the portal path is
**undocumented** — verify in a sandbox before designing around it. Independent of that: the portal's
copy is commerce copy ("Subscriptions", "Cancel plan") and donors respond badly to being told they
have a plan. We want "Change your monthly gift" and "Pause until January," plus a retention offer on
the cancel path. Three endpoints with `{ stripeAccount }` cover it.

Guard every one of those endpoints by checking the subscription's `metadata.jubilee_org_id` against
the org the authenticated donor is acting on — we're calling into a connected account with platform
credentials, so an IDOR here is cross-tenant.

**Cross-org recurring is a later problem.** A donor giving monthly to four orgs needs four Customers
and four subscriptions. Sharing one saved card across them requires PaymentMethod cloning, and clones
**do not sync** — a card update on our side leaves every clone stale, needing a fan-out job. V1:
collect the payment method per org. Also note the fixed-fee math: $5/month across four orgs loses 24%
to the 30¢ per charge. Consider a minimum recurring amount.

---

## 8. Webhooks

Two endpoints, two signing secrets, never shared.

| | Platform endpoint | **Connect endpoint** |
| --- | --- | --- |
| Receives | Events on our own account | Events on all connected accounts |
| `event.account` | absent | `acct_...` |
| For direct charges | Almost nothing | **Everything** |

With direct charges, essentially all donation traffic arrives on the **Connect** endpoint. Use one
platform-level Connect endpoint rather than per-account endpoints — it covers accounts that onboard
tomorrow.

```ts
// svelte/src/convex/http.ts — default runtime, NOT "use node"
http.route({
  path: '/stripe/connect-webhook',
  method: 'POST',
  handler: httpAction(async (ctx, req) => {
    const signature = req.headers.get('stripe-signature');
    if (!signature) return new Response('No signature', { status: 400 });

    const body = await req.text();   // RAW body — must not be parsed first

    let event: Stripe.Event;
    try {
      event = await stripe.webhooks.constructEventAsync(
        body, signature, process.env.STRIPE_CONNECT_WEBHOOK_SECRET!
      );
    } catch {
      return new Response('Signature verification failed', { status: 400 });
    }

    // Dedupe on event.id and hand off. Return 200 fast; Stripe times out and retries.
    await ctx.runMutation(internal.stripe.webhooks.ingest, {
      stripeEventId: event.id,
      type: event.type,
      stripeAccountId: event.account,
      livemode: event.livemode,
      createdAt: event.created
      // narrow event.data.object per type — no v.any()
    });

    return new Response(null, { status: 200 });
  })
});
```

Rules:

1. **Raw body.** The signature is HMAC-SHA256 over `${timestamp}.${rawBody}`. Any parse, re-serialize,
   or proxy reformat breaks it.
2. **Dedupe on `event.id`** via the `stripeEvents` unique index, insert-if-absent. Delivery is at
   least once.
3. **Out-of-order delivery is normal.** For `account.updated` especially, don't blindly apply the
   payload — guard against `lastEventCreatedAt`, or better, re-fetch the account and apply the
   authoritative state.
4. **`account.updated` is chatty.** Debounce.
5. **When `event.account` is present, follow-up API calls must be authenticated as that account.**
   `stripe.paymentIntents.retrieve(id)` from the platform will 404.
6. **Return 200 within seconds.** Non-2xx triggers retries with backoff for ~3 days, then Stripe
   disables the endpoint.
7. **Check `event.livemode`** against the environment, and `jubilee_env` in metadata. Test-mode and
   live-mode `acct_` ids are different objects.

### Events to handle

**Account lifecycle** — `account.updated`, `capability.updated`, `person.updated`,
`account.external_account.updated`, `account.application.deauthorized` (halt charges, cancel
recurring, mark org inactive).

**Donations** — `payment_intent.succeeded` (the primary signal; **skip if `invoice` is set**, that's
a subscription installment), `payment_intent.processing` (ACH in flight — not money yet),
`payment_intent.payment_failed`, `charge.succeeded` (carries `balance_transaction` for actual fees),
`charge.updated` (late-arriving fee data).

**Reversals and risk** — `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`,
`radar.early_fraud_warning.created`.

**Payouts** — `payout.paid`, `payout.failed` (bad bank details; highest-priority org notification).

**Recurring** — `invoice.paid` (a new donation row, keyed on `invoice.id`),
`invoice.payment_failed` (dunning), `customer.subscription.updated`/`.deleted`,
`payment_method.automatically_updated` (Card Account Updater refreshed an expiring card — the single
biggest recurring-retention lever).

**Platform endpoint** — `application_fee.created`, `application_fee.refunded`, our own `payout.*`.

### Writing the ledger

On `payment_intent.succeeded`, an `internalMutation` that mirrors what
[donation.ts](svelte/src/convex/transactions/donation.ts) does, minus the session gate:

1. Look up `donationIntents` by `stripePaymentIntentId`. If already `succeeded`, no-op.
2. Find-or-create the `contacts` row by `by_orgId_and_emailLower`, with `source: 'donation'`.
3. Insert `transactions` — `type: 'donation'`, `amountCents: chargedCents`, `method: 'stripe'`,
   `reference: <pi_id>`, `contactId`.
4. Insert `allocations` for the full amount with `campaignId` and optional `projectId`. **No
   `budgetItem`** — same rule as the manual path.
5. Patch the intent to `succeeded` with `transactionId`.
6. Schedule the acknowledgment email.

Steps 3–5 must be one mutation so they commit or roll back together, matching the existing invariant.

**Never increment a campaign total in a handler.** Compute from the ledger — refunds, disputes, ACH
failures and redeliveries all move the number.

---

## 9. Cover-the-fees math

Naively adding the fee undercharges, because the added amount is itself charged a fee. Gross up:

```
gross = ceil((net + fixed) / (1 - rate))
```

```ts
export function grossUpForFees(netCents: number, rate: number, fixedCents: number): number {
  if (rate >= 1) throw new Error('Fee rate must be below 100%.');
  return Math.ceil((netCents + fixedCents) / (1 - rate));
}
```

Check, at 2.2% + 30¢, donor wants the org to net $100.00:

```
gross = ceil((10000 + 30) / 0.978) = 10256      // $102.56
fee   = round(10256 × 0.022) + 30 = 256
net   = 10256 − 256 = 10000  ✓
```

Rounding is **up**, always. A cent short on a $10,000 gift is a reconciliation ticket.

Rules:

- **The rate is per-org config, never a constant.** Once orgs start getting the 2.2% nonprofit
  discount, a hardcoded 2.9% systematically overcharges every donor of every discounted org. That's
  what `stripeAccounts.feeRate` is for.
- **Show the total charged, prominently, always.** The donor consented to $102.56, not $100.
- **Default the toggle OFF.** Pre-checked fee-cover is a dark pattern and several state AGs have said so.
- **Recompute server-side.** The client figure is a display hint.
- **Store both numbers.** `intendedCents` and `chargedCents`.
- **The tax-deductible amount is `chargedCents`** — the covered fee is part of the gift. Whether the
  portion that becomes *our* platform fee is deductible is a question for a tax advisor, not for this
  document.
- **Small gifts carry proportionally huge fees.** $5.00 net → charge $5.42, a 8.4% load. Consider not
  offering fee-cover below a floor.
- **The rate varies by payment method** and the donor picks theirs *inside* the Payment Element,
  after our toggle. Simplest honest approach: quote the card rate and let ACH donors slightly
  over-cover. Per-method recalculation needs deferred-intent mode — more machinery, more edge cases.

ACH is worth having for large gifts (0.8% capped at $5.00 vs 2.2% uncapped), but the cap makes the
gross-up piecewise, and ACH settles days later as `processing`, not `succeeded`.

---

## 10. Receipts and tax acknowledgment

**Stripe does not produce tax-deductible donation receipts.** This is our job, and it is a real
product requirement.

What Stripe gives us: a payment receipt — merchant name, amount, last4, date — and with direct
charges it carries **the connected account's branding**, which is correct. `charge.receipt_url`
exists but **the link expires after 30 days**, so don't put it in an email a donor might open in
February.

What a US contemporaneous written acknowledgment under IRC §170(f)(8) additionally requires, and
Stripe's receipt lacks entirely:

- The nonprofit's **legal name and EIN**
- The date and the **amount of cash** contributed (= `chargedCents`)
- Either **"No goods or services were provided in exchange for this contribution"**, or a description
  and good-faith estimate of anything provided
- Required **in writing for any single gift ≥ $250**; quid-pro-quo disclosure required over $75

So:

1. **We send the acknowledgment**, from the webhook, on `payment_intent.succeeded` / `invoice.paid`.
   Resend is already wired up in this stack ([email.ts](svelte/src/convex/email.ts)).
2. **Template it per org** from the new `orgSettings` fields — `legalName`, `ein`,
   `acknowledgmentText`.
3. **Void or amend on `charge.refunded` and `charge.dispute.created`.** A donor holding a valid
   acknowledgment for a refunded gift is an IRS problem.
4. **Immutable receipt numbers**, sequential per org per year.
5. **Year-end aggregate statements** in January. Recurring donors need one document listing twelve
   gifts, not twelve receipts. Table stakes, and entirely ours — Stripe has no equivalent.
6. **Never issue on `processing`.** ACH can fail days later.
7. Consider having orgs turn off Stripe's own "Successful payments" email to avoid two receipts. For
   Standard accounts that's a Dashboard setting the *nonprofit* controls, so it's an onboarding
   checklist item, not something we can enforce.

**Stripe Tax: off.** It automates sales tax / VAT / GST. A charitable contribution is not a sale.
Enabling it would at best compute $0. Gala tickets, auctions and merchandise *are* potentially
taxable — which is exactly why they should be modeled as a separate commerce flow, not as gifts. (It
is also why Stripe excludes them from the nonprofit-discount volume test.)

---

## 11. The nonprofit rate

Eligibility, from Stripe's own support documentation: a registered nonprofit with valid tax
documentation (US: EIN + IRS determination letter), in an eligible region, where **at least 80% of
the account's Stripe volume is tax-deductible donations**. Explicitly excluded from that 80%:
membership fees, tuition, ticket sales, registration fees, auction payments.

Stripe does not publish the discounted percentage on that page. Third-party sources consistently
report **2.2% + 30¢** for the US, with Amex flat at 3.5%. **Treat those numbers as unverified** —
which is another reason `feeRate` is per-org config rather than a constant.

The org applies directly through Stripe support. Because we chose direct charges, they can — and
they keep the benefit.

**Build this into onboarding**: a checklist step, "Apply for Stripe's nonprofit rate," with a deep
link and the document list. It costs us nothing and it is a genuine differentiator.

Warn orgs that running a gala with ticket sales through the same Stripe account can push them below
the 80% threshold and cost them the discount.

---

## 12. Permissions

| Surface | Capability |
| --- | --- |
| Connect onboarding, account status, payout settings | `billing:manage` (owner-only, already defined) |
| Viewing online gifts in the ledger | `money:read` (existing) |
| Refunding a gift from our admin UI | `money:write` (existing) |
| Campaign-level giving config | `campaign:edit` (existing, campaign-scoped) |

`billing:manage` needs no schema or permission change — it exists, it's owner-only, and it has zero
call sites today. It just needs a nav entry and a page.

Note that `money:*` capabilities are declared `CAMPAIGN_SCOPED` but transactions carry no campaign,
so they're gated org-wide in practice. Online gifts *do* know their campaign, so the webhook-written
rows can be gated properly on read.

---

## 13. Environment and secrets

Convex deployment env, via `npx convex env set`. Nothing in the repo.

| Name | Where | Notes |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | Convex | Platform key. Connected-account calls pass `stripeAccount`. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Convex | Connect endpoint only |
| `STRIPE_PLATFORM_WEBHOOK_SECRET` | Convex | Platform endpoint only — **never share with the above** |
| `PUBLIC_STRIPE_PUBLISHABLE_KEY` | SvelteKit / Vercel | Safe to expose |
| `STRIPE_DONATION_DOMAINS` | Convex | Comma-separated, for wallet registration |

> **Corrected 2026-08-04.** Typed env is not available on this repo. The guidelines target Convex
> `^1.41.0`, but the repo is pinned to **1.36.1**, whose `defineApp` accepts `{ httpPrefix }` and
> nothing else — there is no `env` option and no `env` export from `_generated/server`. So the Stripe
> secrets follow the existing `email.ts` convention instead: read at module scope, throw at the point
> of use. That is confined to [`stripe/env.ts`](svelte/src/convex/stripe/env.ts), which is the only
> file touching `process.env` for Stripe, so switching to typed env after a Convex upgrade is a
> one-file change. (`npx convex dev` reports 1.43.0 available; the upgrade is its own decision,
> because `@convex-dev/better-auth` is pinned at 0.12.0.)

`isLivemode()` derives test-vs-live from the `sk_live_` key prefix rather than adding a fifth env var
that could disagree with the key it describes.

Webhook URLs are `https://<deployment>.convex.site/stripe/connect-webhook` and `/stripe/webhook`.

There is no `.env.example` in this repo. Worth adding one as part of this work.

---

## 14. Testing

Stripe CLI 1.23.3 is already installed on this machine.

```bash
stripe listen \
  --forward-to         https://<deployment>.convex.site/stripe/webhook \
  --forward-connect-to https://<deployment>.convex.site/stripe/connect-webhook
```

```bash
stripe trigger payment_intent.succeeded --stripe-account acct_1234
```

```bash
stripe trigger account.updated --stripe-account acct_1234
```

Magic test values that matter here:

| Field | Value | Result |
| --- | --- | --- |
| `company.tax_id` | `000000001` | Successful match, **non-profit** |
| `company.address.line1` | `address_full_match` | Charges and payouts enabled |
| `company.address.line1` | `address_no_match` | **Charges only** — tests the `charges_only` state |
| Bank account | `000123456789` (routing `110000000`) | Success |
| Bank account | `000111111113` | `account_closed` |
| Card | `4000000000004202` | Triggers next requirements tier |
| Card | `4000000000000259` | Dispute, fraudulent |
| SMS code | `000-000` | Always, in test mode |

Sandboxes may not enforce capabilities — don't rely on test mode to catch a missing-capability bug.
Assert `charges_enabled` in our own code path.

---

## 15. Build sequence

1. ~~**Schema + `billing:manage` admin shell.**~~ **Done 2026-08-04.** Four tables plus the
   `orgSettings` receipting fields in [schema.ts](svelte/src/convex/schema.ts); `stripe/env.ts`,
   `stripe/client.ts` and `stripe/queries.ts`; an owner-only `/app/admin/giving` showing "not
   connected", wired into `ADMIN_NAV`. No migration was needed — every addition is a new table or an
   optional field, so existing rows validate unchanged. `billing:manage` now has its first call site.
2. ~~**Connect onboarding.**~~ **Done.** `stripe/accounts.ts` (create, Account Links, sync),
   `stripe/onboarding.ts`, `/app/admin/giving` with `return` and `refresh` routes, `deriveStatus`
   under unit test.
3. ~~**Wallet domain registration**~~ **Done.** Fires on reaching `charges_enabled`, per-domain
   outcome stored on the row and surfaced in admin.
4. ~~**One-time giving.**~~ **Done.** `createDonationIntent` with server-side money recomputation
   and rate limiting, Payment Element mounted directly, `payment_intent.succeeded` → ledger,
   reactive thanks page. `DonationForm`'s `disabled` now derives from account status.
5. ~~**Receipting.**~~ **Done.** IRC §170(f)(8) acknowledgment via Resend, per-org legal name / EIN /
   goods-and-services statement, gapless per-org-per-year receipt numbers, void-on-refund.
6. ~~**Refunds, disputes, payouts** in admin.~~ **Done.** `/app/admin/donations` (gated on
   `money:read`, deliberately a wider audience than the owner-only Stripe settings page): a
   paginated gift table with a partial-or-full refund dialog behind `money:write`, plus payout and
   dispute cards fed by new `stripePayouts` and `stripeDisputes` tables.

   **Embedded Stripe components in the org portal: deliberately not built.** §6 notes that embedded
   *onboarding* is unavailable to full-dashboard accounts because
   `disable_stripe_user_authentication` requires `requirement_collection: 'application'`. Whether
   the same auth prompt afflicts the ongoing-management components is unverified, and building on
   an unverified assumption is what this document exists to avoid. It is also largely redundant:
   the whole point of Standard-equivalent accounts is that the org already has its own Stripe
   dashboard. Revisit if orgs ask for it.
7. ~~**Recurring.**~~ **Done, unverified.** Subscriptions on the connected account with a per-campaign
   Product, `invoice.paid` → installment → ledger, cancel-on-deauthorize, and donor self-service
   (change amount / cancel / cancel-at-period-end) built ourselves rather than via the Billing
   portal — see §16.4, which is still unverified.
8. ~~**Reconciliation cron.**~~ **Done.** Four `crons.interval` sweeps: retry failed events, resync
   accounts, reconcile unsettled gifts against Stripe, expire abandoned intents.

A correctness fix worth noting, found while building step 6: `charge.refunded` fires for
**partial** refunds too, and the original handler deleted the whole ledger transaction on any
refund — erasing money the nonprofit still held. Refunds now carry Stripe's cumulative
`amount_refunded` through `planRefund` (`lib/domain/giving.ts`, unit-tested), which reduces the
transaction and its allocations for a partial and only removes rows on a full reversal. Taking the
running total rather than the delta is also what makes re-delivery idempotent.

**Nothing above has been exercised against Stripe.** Every path is written, typechecked, deployed
and unit-tested where it is pure, but no API key has been set, so no call has ever left the
building. §14 is the next step, in this order: set the four Convex env vars and the publishable key,
`stripe listen --forward-connect-to`, onboard a sandbox account with `company.tax_id 000000001`,
then walk a card gift end to end. Expect the first real run to surface shape mismatches the types
could not — particularly around invoice → subscription resolution (`getSubscriptionId` in
`stripe/events.ts`), which Stripe has moved between API versions and which is guarded by an
accessor rather than assumed.

---

## 16. Open questions

**Blocking — RESOLVED 2026-08-04, before step 1. Reopening any of these costs a re-onboarding of
every org, so treat them as settled.**

1. ~~Can a single donation ever be split across multiple orgs?~~ **No — one gift, one org.** Direct
   charges confirmed; no escrow and no DAF structure. A donor giving to three orgs makes three
   charges and pays the 30¢ fixed fee three times, and that is accepted.
2. ~~What is our platform fee?~~ **Zero, with the plumbing built.** `platformFeeBps` sits on the
   `stripeAccounts` row and `application_fee_amount` is passed on every intent, so turning a fee on
   later is a config change rather than a schema migration. Question #10 (tax treatment of the
   covered fee that becomes our revenue) stays open but is not blocking while the rate is zero.
3. ~~Confirm `controller.stripe_dashboard.type`.~~ **Full dashboard**, Standard-equivalent. Orgs get
   their own Stripe relationship and pay fees at their own discounted rate; Stripe owns losses and
   1099-K filing. This is what forces hosted Account Links for initial onboarding (§6).

**Verify in a sandbox before building on them:**

4. Billing customer portal sessions with `Stripe-Account` on a direct-charge connected account —
   Stripe's docs describe only the `on_behalf_of` (destination) pattern.
5. ~~Whether Convex's bundler resolves `stripe@22`'s `worker` export without `"use node"`.~~
   **Verified 2026-08-04: yes.** `stripe@22.4.0` installed and pushed with `npx convex dev --once`;
   the bundle resolved clean with no `"use node"` anywhere. Its `worker` entrypoint initializes
   `WebPlatformFunctions` (fetch transport, SubtleCrypto signatures), both of which the default
   Convex runtime provides. The `constructEventAsync` rule in §1 stands — the synchronous
   `constructEvent` still reaches for Node's `crypto`.
6. Whether Subscription `metadata` reliably propagates to each invoice's PaymentIntent, or must be
   set separately.
7. The `buttonType: 'donate'` enum on the Express Checkout Element (Apple's HIG effectively requires
   the Donate button style for nonprofits).
8. Current nonprofit rate figures — 2.2% + 30¢ is widely reported but not published by Stripe.
9. Whether the "Successful payments" customer-email toggle is API-settable for any account type.

**Needs a professional, not a docs search:**

10. Tax treatment of the covered-fee portion that becomes our platform fee.
11. Charitable solicitation registration obligations for the platform itself, in whichever states
    orgs fundraise from.

---

## Sources

Stripe Connect: [overview](https://docs.stripe.com/connect) ·
[design an integration](https://docs.stripe.com/connect/design-an-integration) ·
[charges](https://docs.stripe.com/connect/charges) ·
[direct charges](https://docs.stripe.com/connect/direct-charges) ·
[accounts](https://docs.stripe.com/connect/accounts) ·
[onboarding](https://docs.stripe.com/connect/onboarding) ·
[handling verification](https://docs.stripe.com/connect/handling-api-verification) ·
[webhooks](https://docs.stripe.com/connect/webhooks) ·
[subscriptions](https://docs.stripe.com/connect/subscriptions) ·
[disputes](https://docs.stripe.com/connect/disputes) ·
[payouts](https://docs.stripe.com/connect/payouts-connected-accounts) ·
[testing](https://docs.stripe.com/connect/testing)

Payments: [Payment Element](https://docs.stripe.com/payments/payment-element) ·
[verifying status](https://docs.stripe.com/payments/payment-intents/verifying-status) ·
[domain registration](https://docs.stripe.com/payments/payment-methods/pmd-registration) ·
[Express Checkout Element](https://docs.stripe.com/elements/express-checkout-element) ·
[idempotency](https://docs.stripe.com/api/idempotent_requests) ·
[receipts](https://docs.stripe.com/receipts) ·
[nonprofit fee discount](https://support.stripe.com/questions/fee-discount-for-nonprofit-organizations)

Convex: [components](https://docs.convex.dev/components) ·
[HTTP actions](https://docs.convex.dev/functions/http-actions) ·
[runtimes](https://docs.convex.dev/functions/runtimes) ·
[environment variables](https://docs.convex.dev/production/environment-variables) ·
[@convex-dev/stripe](https://github.com/get-convex/stripe) (evaluated and rejected — no Connect support)
