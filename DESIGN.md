# job-agent Design Document

> Created: 2026-06-03 · Status: Implementation in progress

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
job-agent run [--skip-llm] [--dry-run]

  1. Discover  → data/companies.json
  2. Enrich    → data/companies-enriched.json
  3. Search    → data/jobs.json
  4. Match     → data/matched.json
  5. Review    → human approves/skips (BLOCKING)
  6. Apply     → submit approved applications
```

Each stage reads previous stage's output. Each is also a standalone command:
```bash
job-agent discover                          # refresh company list
job-agent enrich                            # stamp immigration + layoff
job-agent search --query "senior SWE"       # search ATS boards
job-agent match --cv resume.txt             # score + rank
job-agent review                            # pretty print for human review
job-agent apply --approved approved.json    # submit (with confirmation)
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

Provider-pluggable. User configures in config.json:
```json
{
  "llm_match": {
    "enabled": false,
    "provider": "bedrock",
    "model": "claude-haiku",
    "max_concurrent": 5,
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

## Open Questions & Tradeoffs

- [ ] **PERM XLSX parsing**: Node xlsx lib vs exceljs (streaming) — file is ~50MB/quarter
- [ ] **Layoff data source**: WARN Act (government, clean) vs layoffs.fyi Airtable (hacky but richer)
- [ ] **Lever/Ashby rate limits**: Unknown — may need request throttling
- [ ] **Companies that change ATS**: SimplifyJobs refresh catches this; old slug becomes stale (0 jobs)
- [ ] **companies.json git-tracked?**: Yes (seed data), but `companies-enriched.json` gitignored (generated)
- [ ] **Description parsing accuracy**: Regex for salary/YOE/clearance is ~80% — good enough for filtering, not for decisions
- [ ] **sponsor-check as separate repo vs built-in module**: Start built-in, extract later if it grows
- [ ] **Search concurrency**: Too many parallel ATS requests = rate limiting. Default: 5 concurrent.
