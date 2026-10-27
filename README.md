# RepCall

[Open RepCall](https://yostboy6.github.io/repcall-demo/) · [Source code](https://github.com/yostboy6/repcall-demo)

A working website prototype that connects learners with supervised procedure opportunities. Nurses and surgical residents post an opportunity; available learners receive an alert, claim it, contact the posting clinician, and arrange supervision. A simple procedure log and editable personal goals help learners track their experience.

## Try it

Create a local account as a nurse, fourth-year medical student, or surgical resident (PGY-1 through PGY-5). Residents can both post and claim opportunities. The sign-in screen also offers sample profiles:

| Role | Account | Password |
| --- | --- | --- |
| Nurse — Maya Patel | `staff@repcall.app` | `demo1234` |
| MS4 — Jordan Kim | `learner@repcall.app` | `demo1234` |
| Surgical resident | `resident@repcall.app` | `demo1234` |

1. Sign in as a nurse or resident and post a procedure, location, and contact extension. Use fictional information.
2. Review the simulated alert recipients. Only available learners receive new alerts.
3. Switch to a student or resident profile. Set availability, select an arrival estimate, and claim an opportunity.
4. Contact the posting staff member and arrange supervision using the directory. Confirm those steps before starting.
5. Complete the opportunity, review the procedure log, and adjust personal goals. Log entries record experience; they do not establish clinical competence or replace supervisor verification.
6. Inspect an expired opportunity: if nobody claims within 10 minutes, it closes and the usual care team continues its normal workflow. Expiration does not contact a real care team or perform a clinical action.

The ten-minute window is a **claim deadline**, not a promise that a procedure will be completed within ten minutes. A hospital pilot must define arrival, cancellation, and escalation rules. Care should never wait on this prototype.

## Run locally

Requires Node.js 20 or newer. There are no third-party runtime dependencies.

```sh
npm start
```

Open the local URL printed by the server. Run the workflow tests with:

```sh
npm test
```

GitHub Pages serves the static files from the root of `main`. There is no build step or hosted application server.

## Goals and education references

The procedure count goals are **editable personal targets**, not accreditation requirements. Starting targets of five are product defaults for each tracked skill. They are not AAMC or ACGME minimums.

For medical students, the [AAMC Core EPAs](https://www.aamc.org/about-us/mission-areas/medical-education/cbme/core-epas) describe expected abilities at the transition to residency. The [EPA 12 toolkit](https://www.aamc.org/media/20166/download) covers basic CPR, bag-mask ventilation, sterile technique, venipuncture, IV insertion, and Foley catheter placement. It does not assign procedure-count quotas. Residents also have personal targets for suturing, central lines, and chest tubes.

The separate surgical training reference summarizes the [ACGME 2026 General Surgery requirements](https://www.acgme.org/globalassets/pfassets/programrequirements/2026-prs/440_generalsurgery_2026.pdf), section 4.11.j: 850 major cases over residency, including at least 250 operations before PGY-3, 200 major cases during the chief resident experience, and 25 teaching-assistant cases. These categories are reference information; bedside entries are not automatically mapped to them, and these totals are not medical-student targets. Programs must use the [ACGME Case Log System and category guidance](https://www.acgme.org/specialties/surgery/documents-and-resources/case-log-information/) for official reporting.

## Prototype boundaries

The forms, signup, sign-in, availability, claim deadlines, status changes, coordination confirmation, procedure log, and personal goals work in the browser. State persists locally and updates between tabs on the same browser and origin.

Local signup stores a salted PBKDF2 password verifier in browser storage. It is a prototype account system, not server-backed authentication or secure institutional access control. Browser storage is user-editable. Do not reuse a real password or enter patient information. Sample profiles and directory entries are fictional.

Alerts are simulated; no texts, pages, calls, or emails are sent. Different devices do not share state. Browser storage does not guarantee reliable concurrent claims or enforce hospital privileges.

## Developer handoff

The interface and procedure state transitions are separate so a service can replace local persistence without rebuilding the workflow. A production service must own identity, authorization, timing, and assignment decisions.

The first backend increment should provide:

- Hospital-approved authentication, verified roles, learner eligibility, and a maintained supervisor directory.
- A transactional claim endpoint assigning each request to exactly one eligible learner, with a server-enforced deadline.
- Server-driven expiration, cancellation, and a defined no-show timeout or escalation back to the care team.
- An approved SMS or paging queue with opt-in, shifts, availability, delivery outcomes, and duplicate-send protection.
- Handoff acknowledgement, an event history, and a distinction between reported experience and supervisor-verified procedures.
- Institution-specific review of supervision, consent, data handling, and the minimum information each request needs. The prototype has no patient record fields.

Keep ratings, simulation gates, competency decisions, cohort comparisons, and leadership analytics outside that first backend increment.

## Source context

The workflow follows the MVP proposed in the product conversation: a website for staff to post opportunities, learners to manage availability, a short response window, staff contact details, and a supervisor list. Signup, resident roles, logging, and goals reflect subsequent product direction. The original transcript and screenshots are not included in the repository.
