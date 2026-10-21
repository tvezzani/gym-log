# Questions and decisions

## Confirmed

| Topic | Decision |
| --- | --- |
| Workout meaning | Each record is an independent set; no session entity in v1 |
| Connectivity | Online only in v1 |
| Hosting | Separate Ubuntu server |
| Phone access | Tailscale |
| RPE default/range | Default 5; range 1–10 |
| Planning notes | Free text displayed after the exercise name |
| Version control | Local Git |
| Set numbering | Fresh entry defaults to 1; copy a selected record and increment its number |
| Weight | Pounds only; bodyweight tracking outside v1 |
| Plans | Private dated lists; no recurring routines in v1 |

## Highest-impact questions

1. **Dumbbells:** enter the weight of one dumbbell or the combined pair? Should this be a consistent user convention or shown as an exercise-specific hint?
2. **Plans:** is the calendar date enough, or does an exact scheduled time matter? Should entries be manually marked done/skipped?
3. **Server:** Docker Compose or native services? Existing PostgreSQL or reverse proxy? Approximate RAM and backup location?

## Product details to settle before implementation

4. **Family privacy:** should recorded sets be private? Plans are confirmed private. Should superadmin have an app feature to browse other users' records?
5. **Exercise catalog:** shared across the family or personal? Who may add, rename, and archive exercises?
6. **RPE:** whole values only or half points? Proposed copy behavior preserves RPE; fresh entries use the confirmed default of 5. Untouched defaults may distort future effort summaries.
7. **Logging scope:** only rep/weight strength sets? Need zero-rep failed attempts, warmup markers, timed holds, or cardio in the first version?
8. **Phone flow:** pick an exercise and keep logging, or start from today's plan? Need a previous-values shortcut? Which phone/browser is the target?
9. **Login:** admin-created accounts and admin-assisted recovery without email? How long should a phone stay logged in, and must temporary passwords be changed immediately?
10. **Time and history:** use a fixed user timezone or follow the phone while traveling? Is editing older sets important? Is a day/exercise list sufficient for history?
11. **Priorities:** if only three features could ship first, which are essential? Would a rest timer or copy-previous-day action displace something already in the PRD?

Unanswered items in the PRD are explicitly proposals. Keep this document updated as answers arrive; avoid turning suggestions into confirmed requirements.
