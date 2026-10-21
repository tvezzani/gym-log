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

## Highest-impact questions

1. **Pending exercises:** can the submitter log against a pending exercise privately, or is approval required before any logging? Shared availability always requires approval.
2. **Dumbbells:** enter the weight of one dumbbell or the combined pair? Should this be a consistent user convention or shown as an exercise-specific hint?
3. **Plans:** is the calendar date enough, or does an exact scheduled time matter? Should entries be manually marked done/skipped?

## Product details to settle before implementation

4. **Server details:** existing PostgreSQL or reverse proxy? Approximate RAM and backup location?
5. **Exercise maintenance:** proposed superadmin-only rename/archive. Is that sufficient? Do rejected submissions need a visible reason?
6. **Logging scope:** only rep/weight strength sets? Need zero-rep failed attempts, warmup markers, timed holds, or cardio in the first version?
7. **Phone flow:** pick an exercise and keep logging, or start from today's plan? Need a previous-values shortcut? Which phone/browser is the target?
8. **Login:** how long should a phone stay logged in, and must temporary passwords be changed immediately?
9. **Time and history:** use a fixed user timezone or follow the phone while traveling? Is editing older sets important? Is a day/exercise list sufficient for history?
10. **Priorities:** if only three features could ship first, which are essential? Would a rest timer or copy-previous-day action displace something already in the PRD?

Unanswered items in the PRD are explicitly proposals. Keep this document updated as answers arrive; avoid turning suggestions into confirmed requirements.
