#!/usr/bin/env node
// job-agent CLI entry point

import { resolve } from "path";
import { discover } from "./discovery/index.js";
import { enrich } from "./enrich/index.js";
import { permImport } from "./enrich/perm-import.js";
import { scrapeLayoffs } from "./enrich/layoff-scraper.js";
import { search } from "./search/index.js";
import { parseDescriptions } from "./search/parse-description.js";
import { match } from "./match/index.js";
import { loadLLMConfig, llmMatch } from "./match/llm-match.js";
import { review } from "./review/index.js";
import { apply } from "./apply/index.js";
import { readFileSync, writeFileSync } from "fs";
import type { Job } from "./search/index.js";

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

    case "perm-import": {
      const files = process.argv.slice(3).filter(a => !a.startsWith("--"));
      if (files.length === 0) {
        console.log("Usage: job-agent perm-import <file.csv> [<file2.csv> ...]");
        console.log("Download from: https://www.dol.gov/agencies/eta/foreign-labor/performance");
        break;
      }
      await permImport(files, resolve(DATA_DIR, "perm-cache.json"));
      break;
    }

    case "layoff-scrape": {
      const inputFile = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : undefined;
      await scrapeLayoffs(resolve(DATA_DIR, "layoff-cache.json"), inputFile);
      break;
    }

    case "search": {
      const query = process.argv.slice(3).find(a => !a.startsWith("--")) ?? "software engineer";
      const atsFlag = getArg("--ats=");
      const limit = parseInt(getArg("--limit=") ?? "10");
      const jobs = await search({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "jobs.json"),
        query,
        atsFilter: atsFlag ? atsFlag.split(",") : undefined,
        limit,
      });
      // Auto-parse descriptions if any have description text
      if (jobs.some(j => j.description)) {
        const { jobs: parsed, stats } = parseDescriptions(jobs);
        writeFileSync(resolve(DATA_DIR, "jobs.json"), JSON.stringify(parsed, null, 2));
        console.log(`  Parsed: ${stats.salary} salary, ${stats.yoe} YOE, ${stats.visa} visa signals`);
      }
      break;
    }

    case "match": {
      const cvPath = getArg("--cv=") ?? "./resume.txt";
      const skipLlm = hasFlag("--skip-llm");
      const matched = await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath: resolve(cvPath),
      });
      // LLM Pass 2 if configured
      if (!skipLlm) {
        const llmConfig = loadLLMConfig(DATA_DIR);
        if (llmConfig) {
          const top = matched.slice(0, 50); // Only LLM-match top 50
          const cvText = readFileSync(resolve(cvPath), "utf-8");
          const results = await llmMatch(top, cvText, llmConfig);
          for (const j of matched) {
            const r = results.get(j.id);
            if (r) j.llm_match = r;
          }
          // Re-sort by LLM score where available
          matched.sort((a, b) => (b.llm_match?.score ?? b.keyword_score) - (a.llm_match?.score ?? a.keyword_score));
          writeFileSync(resolve(DATA_DIR, "matched.json"), JSON.stringify(matched, null, 2));
          console.log("  Re-ranked with LLM scores");
        }
      }
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
      const skipLlm = hasFlag("--skip-llm");
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
      const jobs = await search({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "jobs.json"),
        query,
        limit,
      });
      if (jobs.some(j => j.description)) {
        const { jobs: parsed, stats } = parseDescriptions(jobs);
        writeFileSync(resolve(DATA_DIR, "jobs.json"), JSON.stringify(parsed, null, 2));
        console.log(`  Parsed: ${stats.salary} salary, ${stats.yoe} YOE, ${stats.visa} visa`);
      }

      console.log("\n▸ Stage 4: Match");
      const matched = await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath: resolve("./resume.txt"),
      });

      if (!skipLlm) {
        const llmConfig = loadLLMConfig(DATA_DIR);
        if (llmConfig) {
          const cvText = readFileSync(resolve("./resume.txt"), "utf-8");
          const results = await llmMatch(matched.slice(0, 50), cvText, llmConfig);
          for (const j of matched) {
            const r = results.get(j.id);
            if (r) j.llm_match = r;
          }
          matched.sort((a, b) => (b.llm_match?.score ?? b.keyword_score) - (a.llm_match?.score ?? a.keyword_score));
          writeFileSync(resolve(DATA_DIR, "matched.json"), JSON.stringify(matched, null, 2));
        }
      }

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
  discover       Refresh company list from SimplifyJobs
  enrich         Stamp immigration + layoff data
  perm-import    Import DOL PERM CSV files → perm-cache.json
  layoff-scrape  Fetch layoffs.fyi data → layoff-cache.json
  search         Query ATS boards (--ats=greenhouse, --limit=10)
  match          Score + rank jobs (--cv=resume.txt, --skip-llm)
  review         Display top matches (--top=20)
  apply          Open approved job URLs (--approved=file.json)
  run            Full pipeline (--skip-enrich, --skip-llm, --limit=20)
`);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
