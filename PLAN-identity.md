# One person, two records

A donor has a Better Auth **account** and a `contacts` **row**, and today both surface in the
product. That is why the site header can greet "Jonathan" while the account dialog on the same page
says "Zeek Pardo".

This is the plan for making the donor see one identity, and for deciding which record owns it.

Extends [PLAN-portal.md](PLAN-portal.md) and [PLAN-signed-in-site.md](PLAN-signed-in-site.md).

---

## The constraint everything follows from

```
Better Auth `user`     ONE row per person.   name, email, image.        GLOBAL
`contacts`             ONE row per ORG.      firstName, lastName,       PER-ORG
                                             email, phone, address, …
```

`unique(orgId, authUserId)` permits one contact per account **per org**. A donor giving to three
nonprofits has three contact rows and one account.

So "the same name and email everywhere" cannot be made globally true: three orgs may legitimately
know one person by different names, at different addresses. Normalization has to choose a direction
and a scope, and this is the reason every option below is a trade rather than a fix.

---

## Decisions

| Question                            | Answer                                                     |
| ----------------------------------- | ---------------------------------------------------------- |
| Who owns a donor's identity         | **The contact.** The account is credentials only           |
| Where the account appears to donors | **Nowhere.** No profile dialog, no account name            |
| Changing email                      | **Self-service**, proved by a link sent to the new address |
| Changing name                       | **By request** — one click, filed as a staff task          |
| Rejected                            | Propose-and-revert (§4)                                    |

---

## 1. What breaks today

**Two names, both shown.** The site header greets from `contact.firstName`; the account dialog shows
`user.name`. Structural, not a seeding quirk.

**Two emails, and one is load-bearing.** The Me page shows `contact.email` and says "Your name and
email are how we recognise you. Ask us to change either." Meanwhile the account dialog lets the donor
change `user.email` freely, with no effect on the contact. Receipts would go to one address, sign-in
uses the other.

**A silent lockout.** `revokePortalAccess` clears `authUserId`. Getting back in re-runs
`claimPortalContact`, which matches `contacts.emailLower` — the PRIMARY address only, although
`contactEmails` may hold several. A donor invited at one address who signs in with another is not
found, lands on the org's public home, and has no self-service route back.

**Admin surface on donor pages.** The root layout mounts `UserProfileHost` and
`OrganizationProfileHost`, so "API Keys", "Delete account" and the org's settings are in the DOM of
every public campaign page.

---

## 2. Contact owns identity

The org's record is what the product shows. The account is how someone proves they may see it.

That matches what the code already believes: the Me page renders name and email **read-only** with
"Ask us to change either", and `PORTAL_EDITABLE_PROFILE_FIELDS` permits only phone, address,
`updateDetail` and `preferredContact`. This plan makes the rest of the app agree with that, rather
than introducing a new rule.

Consequences:

- Nothing a donor sees renders `user.name`. `toSiteGreeting` and `toPortalProfile` already read the
  contact; the account name appears only in the dialogs, which move (§3).
- The account email keeps one job: signing in. It is never presented as "your email".
- Per-org difference stays legal. Two orgs may hold different names for one person, and neither is
  wrong.

---

## 3. The account dialog leaves donor surfaces — DONE

`UserProfileHost` and `OrganizationProfileHost` mount only under `/app`. Public, `(embed)` and
`(me)` pages no longer contain them.

This is the largest single step toward "one identity", because it is what puts the second one on
screen.

---

## 4. Email: self-service, proved by the address itself

**The donor changes it; a link to the new address proves it.**

Email is where receipts go and how sign-in works. When it is wrong, the donor is the only person who
knows the right answer — nobody at the org can verify it better. And unlike a name, it can prove
itself: a confirmation link to the new address is a stronger check than staff review.

Better Auth already implements the flow (`changeEmail`, with the verification step visible in the
existing account dialog). What this needs:

1. Expose it on `/{orgSlug}/me/profile` rather than in the account dialog that just left.
2. On verified change, write the address to the CONTACT — the owner of identity — and keep the
   account in step so sign-in still works.
3. Uniqueness: `assertEmailAvailable` already refuses an address held by another contact in the org.
   That refusal must surface as a sentence a donor can act on, not a stack trace.
4. Multi-org: one account, N contacts. A verified address should be **recorded on the contact**
   (`contactEmails`) without necessarily becoming its primary — see §5, which is what makes that
   safe.

**Open question for implementation:** the verified-change callback. Better Auth completes the change
out-of-band, so something has to tell Convex. Either a Better Auth hook, or reconciliation on the
`(me)` load where `claimPortalAccess` already runs every time. The second needs no new plumbing and
is idempotent by nature; prefer it unless it proves unable to see the verification state.

### Why not propose-and-revert

The model considered and rejected: donor edits freely, org is notified and may revert.

1. **The change lands before review.** Receipts go to the new address in the meantime, so a typo has
   already done its damage by the time anyone objects. A review after the effect is not a review.
2. **The queue will not be drained.** These are small, understaffed nonprofits. A queue nobody works
   is auto-approval with added guilt, which is worse than no queue.
3. **Revert to what?** It needs the prior value stored, a rule for two changes in a row, and an
   answer for a donor who changed it back themselves.

---

## 5. Claim matches every address a contact holds — DONE

`claimPortalContact` now looks beyond `contacts.emailLower` to the `contactEmails` child table. The
guards are written once and applied to whichever lookup produced the contact, so the new path
structurally cannot skip one: right org, `authUserId` unset, `portalAccess === 'invited'`, and
`assertAuthUserAvailable`.

The child lookup runs only when the primary lookup found NOBODY. A primary that found someone who
then failed a guard is an answer about the person who owns that address, and looking past it for a
second person holding the same one is the widening the guards exist to prevent.

**Two contacts in one org may legitimately share an address.** `assertEmailAvailable` tests only the
primary projection, and `assertContactEmailAvailable` is scoped to a single contact — so nothing
forbids one address appearing as a SECONDARY on two records. Two spouses each carrying the household
address is the everyday case. The lookup therefore returns null on ambiguity rather than throwing:
a throw would take the portal down for every such household over a state the schema permits.

**Blocked addresses are refused.** `blocked` covers both a hard bounce and an unsubscribe and cannot
say which. The bounce is the case that decides it: a bounce is the org's own evidence the address
stopped reaching this person, and a work address handed to their successor is exactly that — a
scenario that defeats every other guard, because the contact really is in this org, unlinked and
invited. Better Auth proves someone controls the mailbox today; it cannot prove the mailbox is still
theirs.

**This narrows the lockout; it does not remove it.** A blocked address and an ambiguous one still
resolve to no viewer, and that person still lands on the org's public home with no explanation. §6's
request flow is the eventual answer for them; until it exists, they need a human.

---

## 6. Name: one click, not a phone call

**Requested, not self-served — but the request is a button.**

A name changes rarely and meaningfully: marriage, transition, a misspelling. It appears on tax
receipts, where the legal name is the one that counts. Staff hold context the donor does not —
household matching, duplicate avoidance, the name the org's own files already use.

But "ask us" as a bare instruction is bad experience, and that is the part worth fixing. The app has
a tasks system. A **Request a name change** action on the Me page opens a short form and files a
staff task, turning a support email into one click and giving staff the review they want BEFORE the
record changes rather than after.

To design when built:

- Which campaign or queue the task belongs to — a portal member holds no capability and no campaign
  assignment, so the write is an internal path, not a portal-authored task
- What the task carries: current value, requested value, who asked, when
- Whether approving it writes the contact directly, or only takes staff to the contact where they
  make the edit. Prefer the second: fewer write paths into a record that carries tax-receipt names
- Rate limiting, so the form cannot become a way to spam a queue

---

## 7. What this deliberately does not do

- **Make one name true across orgs.** Three orgs may know one person three ways. The account is not
  a global profile and should not become one
- **Let a donor rename themselves in an org's CRM**
- **Sync the account name to contacts.** The account name is now invisible to donors; syncing an
  invisible field is work with no reader
- **Delete the account dialog.** Staff still need it. It moved, it did not go

---

## 8. Order

1. ~~Account dialogs off donor surfaces~~ — DONE
2. ~~Claim matches all of a contact's addresses~~ — DONE, plus the `contactEmails` index it needed
3. Email self-service on the Me page, with the verified-change write-back (§4)
4. Name-change request and its staff task (§6)

Steps 1 and 2 are fixes: one closes a surface leak, the other a silent lockout. Steps 3 and 4 are
features and are sized accordingly — 3 needs a decision about the verification callback, 4 needs a
task-authoring path for someone with no capabilities.
