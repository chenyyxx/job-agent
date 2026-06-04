# job-agent Design Document

> Created: 2026-06-03 · Last updated: 2026-06-04
> Status: Working end-to-end pipeline. Workday adapter live (41 companies).
> Two modes: **Pipeline CLI** (deterministic, run weekly) + **Agent Chat** (interactive, LLM-driven).

## Overview

job-agent is a dual-mode job search system:

1. **Pipeline CLI** (`job-agent run`) — deterministic, sequential, free (no LLM unless `--skip-llm` omitted).
   Chains Discover→Enrich→Search→Match→Review. Predictable, fast, good for scheduled runs.

2. **Agent Chat** (`job-agent chat`) — interactive LLM loop with tools. User says "find me
   distributed systems roles at PERM filers paying >$200k" and the agent decides which tools
   to call, adjusts filters dynamically, and presents results conversationally.

Both modes share the same underlying modules as tools.

## Architecture

```
job-agent
├── CLI (src/index.ts)
│   ├── run          — deterministic pipeline (stages 1-5 sequentially)
│   ├── discover     — standalone stage
│   ├── search       — standalone stage (GH + Lever + Ashby + Workday)
│   ├── match        — standalone stage
│   ├── review       — standalone stage
│   └── chat         — interactive agent mode (TODO)
│
├── Modules (shared by both CLI and agent)
│   ├── discovery/   — company list from SimplifyJobs
│   ├── enrich/      — PERM immigration + layoff data
│   ├── search/      — ATS adapters (greenhouse, lever, ashby, workday)
│   ├── match/       — keyword scoring + LLM deep match
│   ├── review/      — human review gate
│   └── apply/       — display-only stub
│
└── Agent (src/agent/ — TODO)
    ├── tools.ts     — expose modules as callable tools
    ├── loop.ts      — Bedrock Converse tool-use loop
    └── prompts.ts   — system prompt with job-search expertise
```

### Agent Mode (TODO)

The agent wraps modules as tools with a Bedrock Converse tool-use loop:

```typescript
// Tools the agent can call:
tools = [
  { name: "search_jobs", description: "Search ATS boards", params: { query, locations, ats, perm_only } },
  { name: "filter_results", description: "Filter current results", params: { min_salary, max_yoe, locations, require_perm } },
  { name: "match_jobs", description: "Score jobs against CV", params: { skip_llm, max_yoe } },
  { name: "show_results", description: "Present top N matches to user", params: { top, sort_by } },
  { name: "get_job_details", description: "Fetch full description for a job", params: { job_id } },
  { name: "adjust_search", description: "Broaden or narrow current search", params: { add_locations, remove_companies, new_query } },
]
```

Example interaction:
```
User: "Find me remote distributed systems roles that sponsor, paying over 180k"
Agent: [calls search_jobs(query="distributed systems", locations=["Remote"], perm_only=true)]
Agent: [calls match_jobs(skip_llm=false)]
Agent: [calls filter_results(min_salary=180000)]
Agent: "Found 12 matches. Top 3: Temporal (5 roles, $176-253k, strong PERM)..."
User: "Exclude defense contractors"
Agent: [calls filter_results(exclude_companies=["RTX","Boeing","Northrop Grumman",...])]
Agent: "Refined to 8 matches..."
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

## Known Limitations (updated 2026-06-04)

0. ~~**ATS discovery coverage (Workday) — biggest gap.**~~ **FIXED** — Workday CXS adapter
   implemented with 41 confirmed companies (NVIDIA, Intel, Cisco, Capital One, Boeing, etc.).
   3,064 SWE jobs from Workday alone. Total coverage: 974 (GH/Lever/Ashby) + 41 (Workday) = 1,015.
   Still missing: Microsoft (custom careers.microsoft.com), Apple (jobs.apple.com), TikTok (Feishu).

1. **Agent mode not yet built.** Current CLI is deterministic pipeline only. Interactive
   agent with tool-use loop is designed (see Architecture) but not implemented.

2. ~~Search covers only an alphabetical slice.~~ **FIXED** — `--limit` is now a test-only
   knob that *randomly samples* N companies; real runs pass no limit and search all.

3. **Workday pagination capped at 200.** Each company returns max 200 results per query
   (10 pages × 20). Companies like Cisco (472 total) and Capital One (841 total) are
   under-fetched. Fixable by raising cap or using search text refinement.

4. **Enrich PERM matching — BUILT.** Normalized matching lifts rate 5→157/974. Optional
   `--resolve-perm` adds grounded LLM step → 178/974, cached. Workday companies not yet
   cross-referenced with PERM data (separate enrichment path needed).

5. **No profile.json yet.** User preferences (target level, locations, salary floor) are
   passed as CLI flags each run. Should be a persistent config.

6. **resume.txt is a stub.** LLM match quality limited without real resume content.
