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

## Highest-impact questions

1. **Set numbers:** next number per exercise per local calendar day, with manual reset/edit, or entirely manual? What should a second visit on the same day do?
2. **Weight:** pounds, kilograms, or both? Per dumbbell or combined pair? Is bodyweight represented as zero added weight? Any assisted movements requiring negative numbers?
3. **Plans:** personal dated lists, shared family lists, or reusable routines in v1? Is the date enough, or does an exact scheduled time matter? Should entries be manually marked done/skipped?
4. **Server:** Docker Compose or native services? Existing PostgreSQL or reverse proxy? Approximate RAM and backup location?

## Product details to settle before implementation

5. **Family privacy:** only your own history/plans, or should others see them? Should superadmin have an app feature to browse other users' records?
6. **Exercise catalog:** shared across the family or personal? Who may add, rename, and archive exercises?
7. **RPE:** whole values only or half points? Keep the requested default of 5 even though untouched defaults can distort future effort summaries?
8. **Logging scope:** only rep/weight strength sets? Need zero-rep failed attempts, warmup markers, timed holds, or cardio in the first version?
9. **Phone flow:** pick an exercise and keep logging, or start from today's plan? Need a previous-values shortcut? Which phone/browser is the target?
10. **Login:** admin-created accounts and admin-assisted recovery without email? How long should a phone stay logged in, and must temporary passwords be changed immediately?
11. **Time and history:** use a fixed user timezone or follow the phone while traveling? Is editing older sets important? Is a day/exercise list sufficient for history?
12. **Priorities:** if only three features could ship first, which are essential? Would a rest timer or copy-previous-day action displace something already in the PRD?

Unanswered items in the PRD are explicitly proposals. Keep this document updated as answers arrive; avoid turning suggestions into confirmed requirements.
