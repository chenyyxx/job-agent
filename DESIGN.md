# job-agent Design Document

> Created: 2026-06-03 · Last updated: 2026-06-03 (evening)
> Status: Working end-to-end. Discover→Enrich(+PERM resolve)→Search(+filters)→Match(+LLM)→Review→Apply.
> CLI flags: search `--perm-only --locations --skip-titles --limit`; enrich `--resolve-perm`;
> match `--max-yoe --skip-llm`; review `--require-h1b --exclude-no-h1b --min-perm-filings=N`.
> Apply is a display-only stub. Biggest gap: Workday ATS coverage (see Known Limitations).

## Overview

job-agent is an orchestrator for automated job searching. It coordinates pluggable tools
(job-pro, cv-pro, sponsor-check) and built-in modules (discovery, match, review) into a
pipeline that goes from company discovery to application submission with human review.

## Architecture

```
job-agent (this repo — orchestrator + new features)
  ├── discover   (built-in: companies.json from SimplifyJobs + future sources)
  ├── enrich     (built-in: PERM immigration + layoff data)
  ├── search     (wraps job-pro or built-in ATS clients)
  ├── match      (keyword scoring + optional LLM deep match)
  ├── review     (human review gate — shows links, scores, visa risk)
  └── apply      (form fill + submit — NEVER auto-applies)

External tools (standalone CLIs, minimal changes):
  ├── job-pro    (forked, config-driven ATS search)
  └── cv-pro     (forked, resume structuring + tailoring)
```

## Pipeline

```
job-agent run [query] [--skip-enrich] [--skip-llm] [--limit=N] [--locations=..] [--skip-titles=..] [--max-yoe=N]

  1. Discover  → data/companies.json              (974 companies)
  2. Enrich    → data/companies-enriched.json      (PERM + layoff, skippable)
  3. Search    → data/jobs.json                    (live ATS, then parse-description)
  4. Match     → data/matched.json                 (keyword + optional LLM Pass 2)
  5. Review    → data/review-output.json           (human gate, prints top N)
  6. Apply     → display-only stub (opens URLs; NEVER submits)
```

> Note: `--limit=N` currently caps the **number of companies searched** (alphabetical
> slice), not the number of jobs returned. See TEST-RESULTS.md known gaps.

Each stage reads previous stage's output. Each is also a standalone command:
```bash
job-agent discover                          # refresh company list
job-agent enrich                            # stamp immigration + layoff
job-agent search --query "senior SWE"       # search ATS boards (--locations, --skip-titles)
job-agent match --cv resume.txt             # score + rank (--max-yoe ceiling)
job-agent review                            # pretty print for human review
job-agent apply --approved approved.json    # open approved URLs (no auto-submit)
job-agent perm-import <xlsx|csv>            # build data/perm-cache.json from DOL PERM
job-agent layoff-scrape                     # build data/layoff-cache.json
```

## Data Contracts

### Company (discovery output)
```typescript
interface Company {
  name: string;        // "Anthropic"
  ats: string;         // "greenhouse" | "lever" | "ashby"
  slug: string;        // "anthropic"
  source: string;      // "simplifyjobs" | "manual" | "linkedin"
}
```

### CompanyEnriched (enrich output)
```typescript
interface CompanyEnriched extends Company {
  immigration: {
    h1b: boolean | null;
    perm: boolean | null;
    filings_quarterly: number;
    trend: "growing" | "stable" | "declining" | "frozen";
    top_roles: string[];
    avg_wage: number | null;
  };
  layoff: {
    recent: boolean;
    date: string | null;
    count: number | null;
    percent: number | null;
  };
}
```

### Job (search output)
```typescript
interface Job {
  id: string;
  company: string;
  title: string;
  location: string;
  url: string;            // direct link to ATS posting
  department: string;
  posted_at: string;
  description?: string;   // full text (for LLM match)
  parsed?: {
    salary?: { min: number; max: number; currency: string };
    yoe?: { min: number; max?: number };
    clearance_required?: boolean;
    citizenship_required?: boolean;
    visa_sponsorship?: boolean;  // true = will sponsor
  };
}
```

### MatchedJob (match output)
```typescript
interface MatchedJob extends Job {
  keyword_score: number;
  llm_match?: {
    score: number;          // 0-100
    recommendation: "STRONG_MATCH" | "MATCH" | "WEAK" | "SKIP";
    skill_gaps: string[];
    strengths: string[];
    reasoning: string;
  };
}
```

## LLM Match Adapter

Provider-pluggable (bedrock | openai | ollama | anthropic). Actual config.json:
```json
{
  "llm_match": {
    "enabled": true,
    "provider": "bedrock",
    "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "region": "us-west-2",
    "max_concurrent": 3,
    "max_cost_per_run": 2.00
  }
}
```

Adapter interface:
```typescript
interface LLMMatchAdapter {
  evaluate(cv: string, job: Job): Promise<LLMMatchResult>;
}
```

No key configured = no LLM match = keyword scoring only.

## Human Review Gate

The review stage outputs results formatted for human decision:
- Every result shows direct job link (clickable)
- Score, salary range, YOE requirement, visa risk
- User actions: View (opens link) | Approve | Skip | Edit CV first
- Apply only runs on explicitly approved jobs
- Even after approval, one more "Send? (y/n)" confirmation

## Config (config.json)
```json
{
  "search": {
    "query": "senior software engineer",
    "locations": ["San Francisco", "Remote"],
    "ats_filter": ["greenhouse", "lever", "ashby"]
  },
  "match": {
    "min_keyword_score": 5,
    "llm_match": { "enabled": false }
  },
  "cv_path": "./resume.txt",
  "data_dir": "./data"
}
```

## Known Limitations (updated 2026-06-03 evening)

0. **ATS discovery coverage (Workday) — biggest gap.** `companies.json` is seeded only from
   SimplifyJobs (Greenhouse/Lever/Ashby). The largest PERM filers / best green-card targets —
   Microsoft (~1861/qtr), Apple (629), NVIDIA (595), Amazon, Google, Meta, TikTok (137) — use
   Workday (or Feishu for TikTok) and are absent from the search universe. We have their DOL PERM
   data but can't reach their postings. A Workday adapter is the highest-value next step.

1. ~~Search covers only an alphabetical slice.~~ **FIXED** — `--limit` is now a test-only
   knob that *randomly samples* N companies; real runs pass no limit and search all 974.
2. ~~Description parsing is 0% effective.~~ **FIXED** — search now maps descriptions
   (Greenhouse `?content=true` decoded to text, Ashby/Lever `descriptionPlain`). Verified
   run: 152/152 jobs have descriptions → 41 YOE, 53 visa, 3 salary signals.
3. **Enrich PERM matching — BUILT.** Normalized matching (strip legal suffixes:
   `Stripe`↔`Stripe, Inc.`) lifts match rate 5→157/974. Optional `--resolve-perm` adds a
   grounded LLM step: guess the DOL legal entity for unmatched brands (`Notion`→`Notion Labs Inc`),
   then VERIFY against the real DOL index (hallucinated names just don't match) → 178/974, cached
   in `perm-resolve-cache.json`. `--min-perm-filings N` filters to companies filing ≥N PERM
   cases/qtr — doubles as a "no startups" filter (startups don't appear in DOL data).

Review is organized around the green-card/PERM outlook: each job shows a VISA/PERM verdict
(files PERM / sponsors / does-not / unknown) with evidence, sorted so no-sponsor ranks last;
numeric score replaced by LLM fit label + reasoning.

LLM Pass 2 verified working on Bedrock `us.anthropic.claude-haiku-4-5-20251001-v1:0`
(us-west-2): 50/50 jobs scored (12 STRONG / 27 MATCH). Note: current Anthropic models
require an inference-profile ID; adapter writes body+output via temp files and passes
`--cli-binary-format raw-in-base64-out`.

## Resolved / Open Questions

- [x] **PERM XLSX parsing** — implemented (`perm-import` builds `data/perm-cache.json`, ~30k employers).
- [x] **Layoff data source** — `layoff-scraper` implemented; match rate still 0 (see limitation #3).
- [x] **companies.json git-tracked** — yes (seed); enriched + caches are generated.
- [ ] **Enrich name normalization** — map company display name → DOL legal entity (alias table / fuzzy match).
- [ ] **Per-job description fetch** — required for salary/YOE/visa to work.
- [ ] **Search semantics** — `--limit` should cap results, not companies; add ordering/"search all".
- [ ] **Lever/Ashby rate limits** — default 5 concurrent; unverified at scale.
- [ ] **sponsor-check as separate repo vs built-in** — currently built-in (enrich module).
