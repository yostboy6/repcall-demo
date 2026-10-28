# RepCall

[Open RepCall](https://yostboy6.github.io/repcall-demo/) · [Source code](https://github.com/yostboy6/repcall-demo)

RepCall connects nurses, fourth-year medical students, and surgical residents with supervised procedure opportunities. Nurses and residents post a procedure, an available learner claims it, and the learner contacts staff and confirms supervision before starting. Completing it adds a procedure-log entry and updates personal goal progress.

## Accounts and workflow

**Create account** is the only registration path. Choose nurse, fourth-year student, or surgical resident (PGY-1–5). Sign in on another device with the same email and password to see the same account, requests, log, and targets. There are no sample accounts or account-switching shortcuts. Earlier browser-only accounts are not migrated; create a shared account through the registration form.

1. A nurse or resident posts the procedure, location, and callback extension.
2. Available students and residents receive an in-app notification. Requests also appear on the shared board.
3. One eligible learner claims the request within 10 minutes and supplies an arrival estimate.
4. The learner contacts the posting clinician and confirms a supervising resident.
5. Complete the procedure as performed, assisted, or observed. Performed procedures count toward personal targets.
6. Unclaimed requests expire. A learner who cannot attend can return a claim to the usual care team.

Residents can both post and claim. The supervisor directory contains registered residents, not fictional seeded clinicians. The 10-minute window is a claim deadline. Arrival estimates are separate; an overdue estimate prompts contact with the team.

**SMS is not connected.** Notifications currently appear inside RepCall. Twilio is deferred.

## Shared backend

The deployed frontend uses the API origin declared in `config.js`. The API uses Cloudflare D1 with normalized users, sessions, requests, alerts, and goals tables. The hosting source is maintained in the sibling `repcall-backend` Sites project; its runtime route imports the same `backend.mjs` and `domain.js` published here. `backend-schema.ts` is the Drizzle schema used to generate hosting migrations. `schema.sql` is its equivalent local SQLite schema.

Passwords are salted scrypt verifiers on the server. Random bearer sessions are stored hashed in the database and expire after 30 days; the browser keeps only its current session token in session storage. Sign-out revokes that token. All mutation identity comes from the authenticated session, never a caller-supplied user ID. Login does not create accounts.

The request board is shared across registered accounts. Completed procedure logs and goals are returned only to their learner, with posted-request activity visible to the posting clinician. Other accounts' email addresses and authentication data are omitted. Registered roles are self-reported, not institution-verified privileges.

Claims use conditional SQL updates and a partial unique index: one learner per request and one current request per learner. The server enforces deadlines and required coordination. No patient-record fields are present. Do not enter patient information or use this educational mockup to coordinate real care.

## Run locally

Requires Node.js 24 or newer. There are no third-party runtime dependencies for the frontend and local backend.

```sh
npm start
```

Open `http://127.0.0.1:4173`. Localhost uses the local API and a persistent SQLite database at `data/repcall.sqlite`. It does not write to the hosted database. `DATABASE_PATH`, `PORT`, and `ALLOWED_ORIGIN` can override local settings. Local databases and environment files are ignored by Git.

```sh
npm test
npm run check
```

The test suite exercises registration and login separately, fresh-device sessions, persistence after reopening a database, role and ownership checks, private logs/goals, notification availability, exact expiry, and competing claims. API transport tests verify routes, bearer tokens, error handling, and session revocation.

GitHub Pages serves the frontend from the root of `main`. It cannot run the API; the shared service must be deployed and accessible before publishing a frontend configured to use it.

## Goals and education references

The procedure counts are editable personal targets. The starting target of five is a product default, not an accreditation minimum.

The medical-student skills list follows [AAMC Core EPA 12](https://www.aamc.org/about-us/mission-areas/medical-education/cbme/core-epas): basic CPR, bag-mask ventilation, sterile technique, venipuncture, IV insertion, and Foley catheter placement. AAMC does not assign procedure-count quotas. Residents also have personal targets for suturing, central lines, and chest tubes.

The resident reference uses the [ACGME 2026 General Surgery requirements](https://www.acgme.org/globalassets/pfassets/programrequirements/2026-prs/440_generalsurgery_2026.pdf), section 4.11.j: 850 major cases over residency, including 250 operations before PGY-3, 200 chief-year major cases, and 25 teaching-assistant cases. Bedside logs do not automatically count toward those operative categories or replace the [ACGME Case Log System](https://www.acgme.org/specialties/surgery/documents-and-resources/case-log-information/). Completion records experience, not competency.

## Next integration

Connect an institution-approved SMS provider only after configuring a sender and the necessary credentials outside source control. Add phone verification, opt-in/out, shift-aware delivery, delivery tracking, and retries. No phone data or SMS credentials are collected in this version. A hospital rollout also needs verified identities and roles, approved supervision rules, organizational access, and operational escalation.

The original product transcript and screenshots are not included in this repository.
