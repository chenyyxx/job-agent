# Test Results — job-agent

> Run: 2026-06-03 11:25 UTC

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

## Not Yet Implemented

- [ ] Enrich (PERM XLSX parsing + layoff data)
- [ ] LLM match adapter (Pass 2)
- [ ] Review (human review gate formatting)
- [ ] Apply (form fill)
- [ ] Full pipeline orchestrator (`job-agent run`)
- [ ] Description parsing (salary/YOE/clearance extraction)
