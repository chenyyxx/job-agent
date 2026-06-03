#!/usr/bin/env node
// job-agent CLI entry point

import { resolve } from "path";
import { discover } from "./discovery/index.js";
import { enrich } from "./enrich/index.js";
import { search } from "./search/index.js";
import { match } from "./match/index.js";
import { review } from "./review/index.js";
import { apply } from "./apply/index.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data");

const command = process.argv[2];
const getArg = (prefix: string) => process.argv.find(a => a.startsWith(prefix))?.split("=")[1];
const hasFlag = (flag: string) => process.argv.includes(flag);

async function main() {
  switch (command) {
    case "discover":
      await discover(resolve(DATA_DIR, "companies.json"));
      break;

    case "enrich":
      await enrich({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "companies-enriched.json"),
        dataDir: DATA_DIR,
      });
      break;

    case "search": {
      const query = process.argv.slice(3).find(a => !a.startsWith("--")) ?? "software engineer";
      const atsFlag = getArg("--ats=");
      const limit = parseInt(getArg("--limit=") ?? "10");
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
      const cvPath = getArg("--cv=") ?? "./resume.txt";
      await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath: resolve(cvPath),
      });
      break;
    }

    case "review": {
      const top = parseInt(getArg("--top=") ?? "20");
      await review({
        matchedPath: resolve(DATA_DIR, "matched.json"),
        outputPath: resolve(DATA_DIR, "review-output.json"),
        top,
      });
      break;
    }

    case "apply": {
      const approved = getArg("--approved=") ?? resolve(DATA_DIR, "review-output.json");
      await apply({ approvedPath: resolve(approved) });
      break;
    }

    case "run": {
      const query = process.argv.slice(3).find(a => !a.startsWith("--")) ?? "software engineer";
      const skipEnrich = hasFlag("--skip-enrich");
      const limit = parseInt(getArg("--limit=") ?? "20");

      console.log("═══ job-agent pipeline ═══\n");

      console.log("▸ Stage 1: Discover");
      await discover(resolve(DATA_DIR, "companies.json"));

      if (!skipEnrich) {
        console.log("\n▸ Stage 2: Enrich");
        await enrich({
          companiesPath: resolve(DATA_DIR, "companies.json"),
          outputPath: resolve(DATA_DIR, "companies-enriched.json"),
          dataDir: DATA_DIR,
        });
      }

      console.log("\n▸ Stage 3: Search");
      await search({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "jobs.json"),
        query,
        limit,
      });

      console.log("\n▸ Stage 4: Match");
      await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath: resolve("./resume.txt"),
      });

      console.log("\n▸ Stage 5: Review");
      await review({
        matchedPath: resolve(DATA_DIR, "matched.json"),
        outputPath: resolve(DATA_DIR, "review-output.json"),
      });

      console.log("\n═══ Pipeline complete. Review jobs above, then run: job-agent apply ═══");
      break;
    }

    default:
      console.log(`job-agent — Job search orchestrator

Commands:
  discover   Refresh company list from SimplifyJobs
  enrich     Stamp immigration + layoff data
  search     Query ATS boards (--query, --ats=greenhouse, --limit=10)
  match      Score + rank jobs against CV (--cv=resume.txt)
  review     Display top matches for human review (--top=20)
  apply      Open approved job URLs (--approved=file.json)
  run        Full pipeline (--skip-enrich, --limit=20)
`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
