// Review module: human review gate — display ranked jobs for approval

import { readFileSync, writeFileSync } from "fs";
import type { MatchedJob } from "../match/index.js";

export interface ReviewOptions {
  matchedPath: string;
  outputPath: string;
  top?: number;
}

export async function review(opts: ReviewOptions): Promise<MatchedJob[]> {
  const jobs: MatchedJob[] = JSON.parse(readFileSync(opts.matchedPath, "utf-8"));
  const top = opts.top ?? 20;
  const display = jobs.slice(0, top);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  JOB REVIEW — Top ${display.length} of ${jobs.length} matches`);
  console.log(`${"═".repeat(60)}\n`);

  for (let i = 0; i < display.length; i++) {
    const j = display[i];
    const salary = j.parsed?.salary ? `$${j.parsed.salary.min/1000}k-${j.parsed.salary.max/1000}k` : "";
    const yoe = j.parsed?.yoe ? `${j.parsed.yoe.min}${j.parsed.yoe.max ? `-${j.parsed.yoe.max}` : "+"}yr` : "";
    const visa = j.parsed?.visa_sponsorship === true ? "✓ visa" : j.parsed?.visa_sponsorship === false ? "✗ no visa" : "";
    const meta = [salary, yoe, visa].filter(Boolean).join(" · ");

    console.log(`  #${i + 1}  ${j.title}`);
    console.log(`      ${j.company} · ${j.location}`);
    console.log(`      Score: ${j.keyword_score} | ${j.match_reasons.join(", ")}`);
    if (meta) console.log(`      ${meta}`);
    console.log(`      → ${j.url}`);
    console.log();
  }

  console.log(`${"─".repeat(60)}`);
  console.log(`  To apply: open URLs above, or use 'job-agent apply --approved <file>'`);
  console.log(`  Auto-apply is NOT supported — manual confirmation required.\n`);

  writeFileSync(opts.outputPath, JSON.stringify(display, null, 2));
  return display;
}
