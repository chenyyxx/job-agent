# Test Results — job-agent

> Module tests: 2026-06-03 11:25 · Full e2e: 2026-06-03 19:25 UTC (commit 6002504)

## Discovery Module ✅

```
$ job-agent discover
Fetching SimplifyJobs listings...
  17397 total listings
  Discovered 974 companies:
    greenhouse: 531
    ashby: 227
    lever: 216
  Written to data/companies.json
```

## Search Module ✅

### Greenhouse (10 companies, query: "software engineer")
```
Searching 10 companies for "software engineer"...
  10a Labs (greenhouse): 1 matches
  2K (greenhouse): 4 matches
  2U (greenhouse): 2 matches
  84.51 Degrees (greenhouse): 2 matches
  Ivanti (greenhouse): 6 matches
Total: 15 jobs found.
```

### Lever (5 companies, query: "engineer")
```
Searching 5 companies for "engineer"...
  3PillarGlobal (lever): 29 matches
  Aera Technology (lever): 6 matches
  Agile Defense (lever): 33 matches
  Agtonomy (lever): 2 matches
Total: 70 jobs found.
```

### Ashby (5 companies, query: "engineer")
```
Searching 5 companies for "engineer"...
  1Password (ashby): 16 matches
  42dot (ashby): 97 matches
  8VC (ashby): 4 matches
  Abby Care (ashby): 4 matches
  Abridge (ashby): 20 matches
Total: 141 jobs found.
```

## Match Module ✅

### Keyword scoring (96 jobs from 20 greenhouse companies)
```
Matching 96 jobs against CV (26 terms extracted)...
  Top CV terms: senior, software, engineer, years, experience, distributed, systems, skills, typescript, python
  96 jobs above threshold (score >= 1)
  Top 5:
    [19] Senior Software Engineer, Observability - Python, AWS, Kubernetes, Terraform @ Ivanti
    [16] Senior Software Engineer - Customer Developer Observability @ Adyen
    [15] Senior Software Engineer - React, Redux, Node.js @ Ivanti
    [13] Software Engineer, Backend @ 10a Labs
    [13] Senior Software Engineer - Financial Products @ Adyen
```

## Now Implemented (commit 6002504)

- [x] Enrich — `perm-import` (DOL PERM → `perm-cache.json`, ~30k employers) + `layoff-scraper`
- [x] LLM match adapter (Pass 2) — pluggable bedrock/openai/ollama/anthropic; wired into `run`
- [x] Review — human review gate formatting (top-N with URLs, scores)
- [x] Apply — display-only stub (opens URLs, never submits)
- [x] Full pipeline orchestrator (`job-agent run`)
- [x] Description parsing module (`parse-description.ts`)

## Full Pipeline E2E ✅ (2026-06-03 19:25)

```
$ job-agent run "software engineer" --skip-llm --limit=20
  Stage 1 Discover  → 974 companies
  Stage 2 Enrich    → companies-enriched.json (schema stamped)
  Stage 3 Search    → 65 jobs from 14 live companies
  Stage 4 Match     → 65 ranked (top keyword score 9–13)
  Stage 5 Review    → top-20 printed with direct URLs
  Exit: 0
```

`tsc --noEmit`: clean. All 9 CLI commands wired
(`discover enrich search match review apply run perm-import layoff-scrape`).

## Gaps Found During E2E — status

| Gap | Status |
|-----|--------|
| Search = alphabetical slice | ✅ FIXED — `--limit` now random-samples (test-only); no limit = search all 974 |
| Description parse 0% effective | ✅ FIXED — GH `?content=true`, Ashby/Lever `descriptionPlain`; 152/152 jobs now have text |
| Enrich PERM match 0.5% | ⏸ DEFERRED — needs alias map / brand→entity lookup; fuzzy won't help |
| LLM Pass 2 untested | ✅ FIXED — bedrock haiku-4.5 working; see run below |

### Description-fetch verification (2026-06-03 evening)
```
$ job-agent run "software engineer" --skip-llm --limit=20
  Search → 152 jobs from 9 (randomly sampled) companies
  Parsed: 3 salary, 41 YOE, 53 visa signals   (was 0/0/0)
```

### LLM Pass 2 verification (2026-06-03 evening)
```
$ job-agent match --cv=resume.txt          # bedrock us.anthropic.claude-haiku-4-5
  LLM Match: evaluating 50 jobs (3 concurrent)
  LLM results: 12 STRONG, 27 MATCH, 11 other     (50/50 scored)
  Top: Anthropic Cloud Inference 82 STRONG_MATCH (reasoning flags H-1B blocker)
```
Three bugs fixed to get here:
1. Adapter omitted `--cli-binary-format raw-in-base64-out` (AWS CLI v2 rejects inline body).
2. `/dev/stdout` output concatenated the CLI's `{"contentType":...}` metadata → `JSON.parse` failed. Now writes to a temp file.
3. Configured model `claude-3-haiku-20240307` is Legacy/blocked → switched to `us.anthropic.claude-haiku-4-5-20251001-v1:0` (inference profile; on-demand bare IDs no longer available).

## #5 Filters + Personalized Run ✅ (2026-06-03 evening)

Location/title filters in search, YOE ceiling in match. Profile: L5 SDE, ~5 YOE, mid-level.
```
$ job-agent run "software engineer" --limit=60 \
    --locations="San Francisco,Remote,Seattle" \
    --skip-titles="intern,new grad,staff,principal,director,vp" --max-yoe=8
  Search → 258 jobs → title filter 230 → location filter 32
  Parsed: 15 salary, 11 YOE, 11 visa
  LLM: 16 STRONG, 11 MATCH, 5 other
  Top: Amplitude Senior SWE — 92 STRONG, $165k-247k, 5+ YOE, NO visa sponsorship
```
The visa-sponsorship signal now surfaces in results (key for the candidate's situation).

## Review reframe + visa-parse fix ✅ (2026-06-03 evening)

Review reorganized around the candidate's real goal — **a company that can file PERM /
sponsor a green card** — not a numeric score:
- Each entry leads with a VISA/PERM verdict: ✅ files PERM (from DOL enrichment) / ✅ sponsors
  (from JD) / ❌ does NOT sponsor (with the JD evidence sentence) / ❓ not stated.
- Results sorted by sponsorship outlook (no-sponsor ranked LAST); numeric score replaced by
  LLM fit label + reasoning.
- `parse-description` visa detection rewritten: old `without.*sponsor` / `no.*visa.*sponsor`
  used unbounded `.*` and matched across the whole JD (e.g. "without hidden fees … sponsorship"),
  causing false negatives on companies that DO sponsor. Now a 45-char proximity scan.

Verified breakdown after fix: **4 sponsor · 48 unknown · 2 will NOT sponsor** (prior buggy
run mislabeled 17 as no-sponsor). Positive evidence example captured:
`"Visa sponsorship: We provide visa sponsorship support … case-by-case"`.

> ⚠️ Limitation: the "✅ files PERM" verdict from DOL enrichment is still ~0 because the
> company→legal-entity name match (deferred #3) isn't done. Today's sponsorship signal comes
> from JD text (H-1B-level), which is NOT the same as green-card/PERM filing history. To truly
> serve "find a company that files PERM", #3 is now the priority feature, not a nice-to-have.
