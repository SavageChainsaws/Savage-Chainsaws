# Working preferences — Jesse / this project

Observed over this project's sessions, kept here so a new session doesn't have to re-learn them the hard way.

## What Jesse wants from Claude on this project

- **Fix the root cause in the app, not around it.** When the rental-return invoicing broke, the instinct was to just create manual "generic" invoices to route around the bug — the right move was pointing out the real fix would get him the *correct* amount (including the late fee he'd have otherwise missed) and was just as fast.
- **Treat his bug reports as live production incidents, not tickets.** He's often reporting something *while a real customer transaction is in front of him* (a rental actively being returned, a deal to close right now). Diagnose against the actual database rows, not just the code, and say exactly what to click next.
- **Don't assume a shipped fix is live.** This bit us once: a fix was pushed to the working branch and reported as done, but Vercel only deploys `main` to production, so the bug recurred on the very next transaction. Now: always call out explicitly when something is fixed-in-code-but-not-deployed, and ask whether to open the PR rather than assuming.
- **Be precise about money.** When correcting a bugged invoice/rental total, show the actual math (what's owed and why), not just a corrected number.
- **Plain, step-by-step UI instructions.** He's not going to read a diff — "go to `/rentals` → Active Rentals → click Return → ..." is what's useful.
- Communicates partly via screenshots (of the app, of PDFs, of marketing graphics) and short, sometimes-fragmentary messages (e.g. correcting himself mid-thought: "I forgot we need to add in meet JESSE..."). Read the recent conversation context generously rather than taking a short message too literally out of context.

## Process conventions established on this project

- One long-lived feature branch (`claude/customer-login-redirect-fix-n1q020`), not a new branch per task — push commits there, open a PR into `main` when a round of work is ready, merge, keep going on the same branch.
- Never open a PR without Jesse explicitly saying so — flag that a fix is ready/waiting, ask, don't act unilaterally.
- Verify before declaring something fixed: `npx tsc --noEmit`, `npx eslint <changed files>`, and `npx next build` (expect the build's static-prerender step to fail in sandboxes without real Supabase env vars configured — that's an environment gap, not a code defect, as long as compile + typecheck both pass).
- When diagnosing a reported bug, query the actual Supabase tables for the real row(s) in question before proposing a fix — this project has caught real, specific, surprising bugs this way (e.g. `paid_at` actually being null when the code assumed it wouldn't be).
- Code style already in place, worth matching: comments explain *why* something non-obvious is the way it is (often citing the specific prior bug or constraint that shaped it), not *what* the code does; no comments otherwise. No TODO/FIXME markers anywhere in the codebase — if something's unfinished, it's either genuinely absent or called out in a comment with the actual reasoning, not a stub marker.
