// Apply module: submit applications for approved jobs
// STUB — auto-apply NOT implemented. Opens URLs for manual submission.

import { readFileSync } from "fs";
import type { MatchedJob } from "../match/index.js";

export interface ApplyOptions {
  approvedPath: string;
}

export async function apply(opts: ApplyOptions): Promise<void> {
  const jobs: MatchedJob[] = JSON.parse(readFileSync(opts.approvedPath, "utf-8"));

  console.log(`\n  ${jobs.length} approved jobs to apply:\n`);
  for (const j of jobs) {
    console.log(`  • ${j.title} @ ${j.company}`);
    console.log(`    ${j.url}\n`);
  }

  console.log(`  ⚠ AUTO-APPLY NOT IMPLEMENTED`);
  console.log(`  Open the URLs above and apply manually.`);
  console.log(`  Future: form-fill with cv-pro tailored resume + explicit per-job confirmation.\n`);
}
