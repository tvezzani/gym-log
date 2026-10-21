# Questions and decisions

## Confirmed

| Topic | Decision |
| --- | --- |
| Workout meaning | Each record is an independent set; no session entity in v1 |
| Connectivity | Online only in v1 |
| Hosting | Separate Ubuntu server |
| Phone access | Tailscale |
| RPE default/range | Whole numbers only; default 5; range 1–10 |
| Planning notes | Free text displayed after the exercise name |
| Version control | Local Git |
| Set numbering | Fresh entry defaults to 1; copy a selected record and increment its number |
| Weight | Pounds only; bodyweight tracking outside v1 |
| Plans | Private dated lists; no recurring routines in v1 |
| Exercise catalog | Shared; new exercises require superadmin approval |
| History privacy | Private through app/API, including superadmin; database owner retains direct access to everything |
| Deployment | Docker Compose on Ubuntu |
| Accounts/recovery | Admin-created accounts and admin-assisted password reset; no signup/email features |
| Pending exercises | Submitter can log privately while pending; shared selection requires approval |
| Dumbbells | User's convention; preserve entered pounds without interpreting individual versus combined weight |
| Plan scheduling | Calendar date only; SQL `date` / API `YYYY-MM-DD`; no scheduled time |

## Remaining implementation details

The core MVP scope is sufficiently defined for scaffolding. The items below can use documented defaults or be resolved when their implementation begins.

1. **Server details:** existing PostgreSQL or reverse proxy? Approximate RAM and backup location?
2. **Exercise maintenance:** proposed superadmin-only rename/archive. Proposed rejection behavior preserves history and blocks new entries against the rejected name. Do rejected submissions need a visible reason?
3. **Logging scope:** proposed positive-rep strength sets only. Need zero-rep failed attempts, warmup markers, timed holds, or cardio later?
4. **Phone flow:** proposed Today screen supports direct entry and logging from a plan. Which phone/browser should be used for final checks?
5. **Login:** how long should a phone stay logged in, and must temporary passwords be changed immediately?
6. **Time and history:** user timezone for performed timestamps; calendar dates for plans. Should workout-day grouping follow the phone while traveling? Proposed history supports day/exercise filtering and editing older sets.
7. **Plan completion:** no automatic completed sets. Is a manual done/skipped marker needed later?

Unanswered items in the PRD are explicitly proposals. Keep this document updated as answers arrive; avoid turning suggestions into confirmed requirements.
