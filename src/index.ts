#!/usr/bin/env node
// job-agent CLI entry point

import { resolve } from "path";
import { discover } from "./discovery/index.js";
import { search } from "./search/index.js";
import { match } from "./match/index.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data");

const command = process.argv[2];

async function main() {
  switch (command) {
    case "discover":
      await discover(resolve(DATA_DIR, "companies.json"));
      break;
    case "search": {
      const query = process.argv.slice(3).find(a => !a.startsWith("--")) ?? "software engineer";
      const atsFlag = process.argv.find(a => a.startsWith("--ats="))?.split("=")[1];
      const limit = parseInt(process.argv.find(a => a.startsWith("--limit="))?.split("=")[1] ?? "10");
      await search({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "jobs.json"),
        query,
        atsFilter: atsFlag ? atsFlag.split(",") : undefined,
        limit,
      });
      break;
    }
    case "match": {
      const cvPath = process.argv.find(a => a.startsWith("--cv="))?.split("=")[1] ?? "./resume.txt";
      await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath: resolve(cvPath),
      });
      break;
    }
    default:
      console.log(`job-agent — Job search orchestrator

Commands:
  discover   Refresh company list from SimplifyJobs
  search     Query ATS boards (--query, --ats=greenhouse, --limit=10)
  enrich     Stamp immigration + layoff data (TODO)
  match      Score + rank jobs against CV (TODO)
  review     Human review gate (TODO)
  run        Full pipeline (TODO)
`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
