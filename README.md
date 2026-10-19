# QA Desk

QA for post-training data. It answers three questions: which batches pass QA, where the bottleneck is, and what leadership needs to know this week.

Built by Jake Makking-Robinson as proof of work for the Metis operations role. A working draft, not a Metis product and not affiliated with Metis. All data is synthetic.

**One static page. No API, no server, no keys.** Everything runs in the browser, and nothing pasted into it leaves the page.

## The headline

Three numbers above the tabs: this week's pass rate, cost per accepted task, and the batch most at risk of missing its customer deadline.

## QA a batch

1. **Input:** a task spec (the labelling or eval guidelines) and a batch of task outputs as CSV (`task_id, batch, labeller, labelled_on, output`), pasted or loaded from a file. Column names are matched loosely; only `output` is required. Each output is a trajectory with one line per turn: `USER:`, `AGENT:`, `TOOL name(arg=value) -> result` and `SUMMARY:`.
2. **Rubric:** four fixed axes with 1/3/5 anchors: correctness, guideline adherence, completeness and format. Hard rules come from the spec's own lines (up to four). Lines about tone feed guideline adherence, lines about format feed format, and reference lines are listed as such.
3. **Score:** every axis scores 1–5 and quotes the output line it rests on, copied verbatim. Correctness checks every amount, date and order status the agent states against the tool results, the customer's messages and the spec. A hard rule the task never triggers (no refund, say) shows n/a and stays out of the mean.
4. **Recommendation:** a fixed rule. Two broken hard rules or a mean under 2.5 rejects. One broken rule, any axis under 3, or a mean under 3.75 sends it to rework. Everything else is accepted.
5. **Batch view:** pass, rework and reject counts, a per-labeller table with each labeller's top issue, and the task list. Click a task to open its scorecard.
6. **Reviewer playbook:** for a new labeller on this spec. It covers what each axis looks for, each hard rule with a passing and a failing line quoted from the batch, where this batch went wrong, a pre-submit checklist and a first-week calibration plan. Copies as plain text.
7. **Send results to tracker** writes the QA sample into that batch's record.

The demo is a spec for customer-support agent trajectories (order lookups, cancellations, refunds, address changes) and a ten-task QA sample from batch B-07. It has four synthetic labellers, each with a different error profile. Labeller A is clean. B states dates and amounts no tool returned. C skips identity checks and the refund cap. D breaks the format and misses requests.

## Batch tracker

- **Stages:** Queued → Labelling → QA → Rework → Delivered, with SLAs of 1, 4, 1 and 2 days. Each batch has a stage picker.
- **Four metrics, per batch and per labeller:**
  - Throughput: tasks labelled per day.
  - Quality: pass rate and rework rate.
  - Cost: tasks × rate, with reworked tasks paid again. Cost per accepted task is the cost of reviewed tasks divided by the accepted ones.
  - Timeliness: whether a delivered batch was on time against the customer deadline. An active batch is projected from its current pace plus one final QA pass.
- **Bottlenecks:** every batch over its stage SLA or projected to miss its deadline, worst first, each with a next action. For example: "needs 8.7 tasks a day and is doing 6.8; move two labellers across or agree a split delivery".
- **Weekly note:** a plain-text update ready to paste into Slack or email. It covers throughput, quality, cost and timeliness, then the worst bottleneck with its next action and the other flags.
- **Copy as CSV**, add a batch by hand, or clear the demo. Data is saved in the viewer's browser only (localStorage).

The demo has six synthetic batches across three clients (Client A to C). B-07 is close to its deadline and over its labelling SLA, B-06 is stuck in QA, and B-05 was delivered a day late. B-07's QA counts match the sample on the first tab.

## Files

- `public/index.html`: the whole app. The QA engine is `<script id="engine">`, tracker logic is `<script id="tracker-core">`, and demo inputs are in `<script id="demo">`.
- `tests/engine.test.mjs`: runs the engine and tracker under Node (`npm test`, no dependencies). It checks the demo range, that every quote is verbatim, each hard rule, the four metrics, the bottleneck flag, the weekly note and the playbook.
- `.github/workflows/deploy.yml`: on every push to `main`, runs the tests and publishes `public/` to GitHub Pages.

## Run locally

Open `public/index.html` in a browser.
