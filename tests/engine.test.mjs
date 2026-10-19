// Runs the in-page engine and tracker under Node. No dependencies: npm test or node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const script = (id) => html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`))[1];
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(script("engine") + script("demo") + script("tracker-core"), ctx);
const { QA: Q, DEMO, Tracker: T } = ctx.window;

const rubric = Q.buildRubric(DEMO.spec);
const batch = Q.qaBatch(rubric, Q.parseCSV(DEMO.csv));
const task = (id) => batch.tasks.find((t) => t.task_id === id).result;
const score = (id, axis) => task(id).scores.find((s) => s.axis_id === axis).score;

test("spec: four fixed axes, four hard rules, style and format lines feed the fixed axes", () => {
  assert.equal(rubric.axes.map((a) => a.id).join(","), "correctness,adherence,completeness,format,verify,lookup,confirm,refund_cap");
  assert.equal(rubric.axes.find((a) => a.id === "refund_cap").cap, 100);
  assert.equal(rubric.params.wordLimit, 60);
  assert.equal(rubric.params.summaryPrefix, "SUMMARY:");
  assert.deepEqual([...rubric.params.banned], ["probably", "should be", "i think"]);
  assert.ok(rubric.skipped.some((s) => /3-5 business days/.test(s.text) && /reference/.test(s.why)));
});

test("the demo CSV round-trips: ten tasks, multi-line outputs with quoted JSON intact", () => {
  const rows = Q.parseCSV(DEMO.csv);
  assert.equal(rows.length, 10);
  assert.equal(rows[1].output, DEMO.tasks[1].output);
  assert.ok(rows[1].output.includes('{"verified": true}'));
});

test("every quote is copied verbatim from the task output", () => {
  for (const t of batch.tasks) for (const s of t.result.scores) for (const e of s.evidence) assert.ok(t.output.includes(e.text), `${t.task_id}: ${e.text}`);
});

test("every scored axis quotes at least one line; untriggered rules have no score", () => {
  for (const t of batch.tasks) for (const s of t.result.scores) {
    if (s.score == null) assert.match(s.reasoning, /^Not triggered/);
    else assert.ok(s.evidence.length > 0, `${t.task_id} ${s.axis_id}`);
  }
});

test("demo range: 4 accepted, 4 rework, 2 rejected", () => {
  const d = Object.fromEntries(batch.tasks.map((t) => [t.task_id, t.result.recommendation.decision]));
  assert.deepEqual(d, { "T-0701": "accept", "T-0702": "accept", "T-0703": "accept", "T-0704": "rework", "T-0705": "reject", "T-0706": "accept", "T-0707": "rework", "T-0708": "reject", "T-0709": "rework", "T-0710": "rework" });
  assert.equal(batch.passRate, 0.4);
});

test("each synthetic labeller has a different error profile", () => {
  const top = Object.fromEntries(batch.labellers.map((l) => [l.name, l.topIssue && l.topIssue.axis_id]));
  assert.deepEqual(top, { "Labeller A": null, "Labeller B": "correctness", "Labeller C": "verify", "Labeller D": "format" });
});

test("correctness catches a date no tool returned and a wrong amount", () => {
  assert.equal(score("T-0704", "correctness"), 1);
  assert.match(task("T-0704").scores[0].reasoning, /Oct 24/);
  assert.equal(score("T-0705", "correctness"), 2);
  assert.match(task("T-0705").scores[0].reasoning, /\$18\.00/);
  assert.equal(score("T-0702", "correctness"), 5); // "3-5 business days" and "$42.50" are grounded
});

test("hard rules: verify, lookup order, confirmation and the refund cap", () => {
  assert.equal(score("T-0702", "verify"), 5);
  assert.equal(score("T-0707", "verify"), 1);
  assert.equal(score("T-0705", "lookup"), 1);
  assert.equal(score("T-0705", "confirm"), 1); // asking for an email is not asking to refund
  assert.equal(score("T-0703", "refund_cap"), 5); // $148 went to escalate
  assert.equal(score("T-0708", "refund_cap"), 1); // $180 through issue_refund
  assert.equal(score("T-0701", "verify"), null);
});

test("format and completeness catch Labeller D's misses", () => {
  assert.equal(score("T-0709", "format"), 1);
  assert.equal(score("T-0709", "completeness"), 2); // gift note never answered
  assert.equal(score("T-0710", "completeness"), 3); // ends on an unanswered question
});

test("the recommendation rule", () => {
  const s = (pairs) => pairs.map(([axis_id, score]) => ({ axis_id, score }));
  assert.equal(Q.recommend(s([["a", 5], ["m", 2], ["n", 1]]), ["m", "n"]).decision, "reject");
  assert.equal(Q.recommend(s([["a", 5], ["m", 2]]), ["m"]).decision, "rework");
  assert.equal(Q.recommend(s([["a", 2], ["m", 5]]), ["m"]).decision, "rework");
  assert.equal(Q.recommend(s([["a", 4], ["m", null]]), ["m"]).decision, "accept");
});

test("a pasted spec with an unknown rule still produces a hard rule", () => {
  const r = Q.buildRubric(`Eval: summary grading\n\nRules\n- Always cite the source document id in the summary`);
  assert.equal(r.axes.filter((a) => a.kind === "must_have").length, 1);
});

test("playbook quotes a passing and a failing line for each broken rule", () => {
  const pb = Q.playbook(rubric, batch);
  const rules = pb.sections.find((s) => s.title === "Hard rules from the spec").items;
  assert.equal(rules.length, 4);
  for (const r of rules) assert.ok(r.pass && r.fail, r.text);
  assert.ok(pb.text.includes("Each agent reply is under 60 words."));
});

// ---------- Tracker ----------
const NOW = Date.parse("2026-10-19T12:00:00Z");
const items = T.demo(NOW);

test("demo labeller rows add up to each batch's totals", () => {
  for (const b of items) for (const k of ["tasks", "reviewed", "accepted", "rework", "rejected"]) {
    if (!b.labellers.length) continue;
    const key = k === "tasks" ? "labelled" : k;
    assert.equal(b.labellers.reduce((s, l) => s + l[k], 0), b[key], `${b.id} ${k}`);
  }
});

test("B-07 in the tracker matches the QA sample on the first tab", () => {
  const b = items.find((x) => x.id === "B-07");
  assert.deepEqual([b.reviewed, b.accepted, b.rework, b.rejected], [batch.tasks.length, batch.accepted, batch.rework, batch.rejected]);
  for (const l of batch.labellers) {
    const t = b.labellers.find((x) => x.name === l.name);
    assert.deepEqual([t.reviewed, t.accepted, t.rework, t.rejected], [l.tasks, l.accepted, l.rework, l.rejected], l.name);
  }
});

test("B-07 is the batch at risk; B-06 is over its QA SLA", () => {
  const w = T.week(items, NOW);
  assert.equal(w.atRisk[0].b.id, "B-07");
  assert.ok(w.atRisk[0].m.slack < 0 && w.atRisk[0].m.slack > -1.5);
  const od = T.overdue(items, NOW).map((o) => o.b.id);
  assert.ok(od.includes("B-06") && od.includes("B-07"));
  assert.ok(!od.includes("B-08"));
  assert.equal(T.bottlenecks(items, NOW)[0].b.id, "B-07");
});

test("four metrics: throughput, quality, cost, timeliness", () => {
  const m = T.metrics(items.find((x) => x.id === "B-04"), NOW);
  assert.equal(m.throughput.toFixed(1), "8.9"); // 80 tasks over 9 days
  assert.equal(m.passRate, 66 / 80);
  assert.equal(m.cost, (80 + 12) * 24); // rework is paid again
  assert.equal(m.perAccepted.toFixed(2), ((92 * 24) / 66).toFixed(2));
  assert.equal(m.status, "on_time");
  assert.equal(T.metrics(items.find((x) => x.id === "B-05"), NOW).status, "late");
});

test("weekly note covers all four metrics and names the worst bottleneck with an action", () => {
  const n = T.note(items, NOW);
  for (const k of ["Throughput:", "Quality:", "Cost:", "Timeliness:", "Worst bottleneck", "B-07 Order support"]) assert.ok(n.includes(k), k);
  assert.match(n, /Move \d labellers? across/);
  assert.ok(!/undefined|NaN/.test(n));
});

test("moving to Delivered stamps the date; moving back clears it", () => {
  const b = items.find((x) => x.id === "B-06");
  const d = T.move(b, "Delivered", NOW);
  assert.equal(d.delivered, new Date(NOW).toISOString());
  assert.equal(T.move(d, "Rework", NOW).delivered, undefined);
});

test("CSV has a header row and escapes quotes", () => {
  const out = T.csv([{ ...items[0], name: 'Refunds "v2"' }], NOW);
  assert.ok(out.startsWith('"Batch","Name"'));
  assert.ok(out.includes('"Refunds ""v2"""'));
});

test("no real company or customer names in the demo", () => {
  const text = DEMO.spec + DEMO.csv + JSON.stringify(items);
  assert.ok(!/metis|sela|amazon|shopify|zendesk/i.test(text));
});
