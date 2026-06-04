# job-agent

Job search orchestrator with pluggable ATS adapters, DOL PERM immigration data, and optional LLM matching.

## Setup

```bash
cd /local/home/chenyyxx/.meshclaw/workspace/job-agent
npm install

# For LLM matching (optional):
ada credentials update --account 756090160824 --role IibsAdminAccess-DO-NOT-DELETE --provider conduit
```

## Quick Start (Full Pipeline)

```bash
npx tsx src/index.ts run "software engineer" \
  --locations=Remote,"San Francisco",Seattle \
  --skip-titles=intern,staff,principal \
  --max-yoe=8 \
  --perm-only \
  --resolve-perm
```

This chains all 5 stages: Discover → Enrich → Search → Match → Review.

## Modules

### 1. Discover

Loads the company list from `data/companies.json` (974 companies with ATS slugs from SimplifyJobs).

```bash
npx tsx src/index.ts discover
```

Output: `data/companies.json`

### 2. Enrich

Stamps each company with immigration (PERM filings/qtr, trend, avg wage) and layoff signals.

```bash
npx tsx src/index.ts enrich
npx tsx src/index.ts enrich --resolve-perm   # Use LLM to resolve brand→DOL legal entity names
```

**Prerequisites:** Import PERM data first (see below).

Output: `data/companies-enriched.json`

### 3. Search

Queries live ATS boards (Greenhouse, Lever, Ashby) for open positions.

```bash
npx tsx src/index.ts search "software engineer"
npx tsx src/index.ts search "backend engineer" --locations=Remote,Seattle --skip-titles=intern,principal
npx tsx src/index.ts search "software engineer" --perm-only          # Only search 157 known PERM filers
npx tsx src/index.ts search "software engineer" --ats=greenhouse     # Single ATS
npx tsx src/index.ts search "software engineer" --limit=5            # Limit companies (for testing)
```

Automatically parses descriptions for salary, YOE, and visa signals.

Output: `data/jobs.json`

### 4. Match

Scores and ranks jobs against your resume using keyword overlap + optional LLM deep match.

```bash
npx tsx src/index.ts match
npx tsx src/index.ts match --cv=./resume.txt --max-yoe=8
npx tsx src/index.ts match --skip-llm                     # Keyword-only (free, instant)
```

LLM match requires `config.json` with `llm_match.enabled: true` and valid AWS credentials.

Output: `data/matched.json`

### 5. Review

Pretty-prints top matches grouped by company with H-1B (from JD text) and PERM (from DOL filings) verdicts.

```bash
npx tsx src/index.ts review
npx tsx src/index.ts review --top=30
npx tsx src/index.ts review --require-perm --min-perm-filings=5   # Only show strong green-card filers
npx tsx src/index.ts review --require-h1b                          # Only show jobs mentioning visa sponsorship
```

Output: `data/review-output.json`

### 6. Apply (stub)

Opens approved job URLs in browser. No auto-submit — display-only.

```bash
npx tsx src/index.ts apply
```

## Data Import Tools

### PERM Import

Download DOL PERM disclosure data and import:

```bash
# Download from https://www.dol.gov/agencies/eta/foreign-labor/performance
npx tsx src/index.ts perm-import data/perm_fy2025_q4.csv data/perm_fy2026_q2.csv
```

Output: `data/perm-cache.json` (49,456 employers with filings/quarter, avg wage, top roles)

### Layoff Scraper

Import layoffs.fyi data from exported CSV:

```bash
# Export CSV from layoffs.fyi in browser, then:
npx tsx src/index.ts layoff-scrape data/layoffs_export.csv
```

Output: `data/layoff-cache.json`

## Configuration

Edit `config.json`:

```json
{
  "search": {
    "query": "software engineer",
    "locations": ["San Francisco", "Remote"],
    "ats_filter": ["greenhouse", "lever", "ashby"]
  },
  "match": { "min_keyword_score": 5 },
  "llm_match": {
    "enabled": true,
    "provider": "bedrock",
    "model": "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    "region": "us-west-2",
    "max_concurrent": 3,
    "max_cost_per_run": 2.00
  },
  "cv_path": "./resume.txt",
  "data_dir": "./data"
}
```

## Key Flags

| Flag | Stage | Description |
|------|-------|-------------|
| `--perm-only` | search/run | Only search companies with DOL PERM filings (974→157) |
| `--resolve-perm` | enrich/run | LLM resolves brand names to DOL legal entities |
| `--locations=X,Y` | search/run | Filter by location (e.g. Remote, Seattle) |
| `--skip-titles=X,Y` | search/run | Skip titles containing these words |
| `--max-yoe=N` | match/run | Filter out jobs requiring > N years experience |
| `--limit=N` | search/run | Limit companies searched (for testing) |
| `--skip-llm` | match/run | Skip LLM Pass 2 (keyword-only scoring) |
| `--skip-enrich` | run | Skip enrich stage in pipeline |
| `--require-h1b` | review/run | Only show jobs with H-1B mention in JD |
| `--require-perm` | review/run | Only show companies with DOL PERM filings |
| `--min-perm-filings=N` | review/run | Minimum quarterly PERM filings |
| `--top=N` | review | Number of results to show (default 20) |
| `--cv=path` | match | Path to resume file (default ./resume.txt) |

## Coverage

- **974** companies total (531 Greenhouse + 216 Lever + 227 Ashby)
- **157** confirmed PERM filers (searchable with `--perm-only`)
- **Missing:** Workday (Microsoft, Apple, NVIDIA, Amazon, Google) and Feishu (TikTok) — these are the top DOL filers but use unsupported ATS platforms
