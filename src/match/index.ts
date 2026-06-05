// Match module: two-pass job scoring
// Pass 1: keyword overlap (free, fast)
// Pass 2: LLM deep match (optional, pluggable)

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import type { Job } from "../search/index.js";
import type { Profile } from "../resume/index.js";

export interface MatchedJob extends Job {
  keyword_score: number;
  match_reasons: string[];
  llm_match?: {
    score: number;
    recommendation: string;
    skill_gaps: string[];
    strengths: string[];
    reasoning: string;
  };
}

export interface MatchOptions {
  jobsPath: string;
  outputPath: string;
  cvPath: string;
  minScore?: number;
  maxYoe?: number;
}

// --- Keyword extraction (simplified from job-pro) ---

function extractTerms(text: string): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9+#.\-]{1,20}/g) ?? [];
  const stop = new Set(["the", "and", "for", "with", "via", "from", "able", "this", "that", "have", "are", "you", "our", "will", "can", "about", "your", "team", "work", "join"]);
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const tok of tokens) {
    const norm = tok.toLowerCase();
    if (norm.length < 3 || stop.has(norm) || seen.has(norm)) continue;
    seen.add(norm);
    terms.push(norm);
    if (terms.length >= 30) break;
  }
  return terms;
}

function scoreJob(job: Job, cvTerms: string[]): { score: number; reasons: string[] } {
  const titleBlob = `${job.title} ${job.location} ${job.department}`.toLowerCase();
  const descBlob = (job.description ?? "").toLowerCase();
  let score = 0;
  const reasons: string[] = [];

  for (const term of cvTerms) {
    const t = term.toLowerCase();
    const inTitle = titleBlob.includes(t);
    const inDesc = descBlob.includes(t);
    if (inTitle || inDesc) {
      // Title/dept matches weighted higher than description-body matches.
      score += inTitle ? (term.length > 4 ? 3 : 1) : 1;
      if (reasons.length < 5) reasons.push(term);
    }
  }
  return { score, reasons };
}

export async function match(opts: MatchOptions): Promise<MatchedJob[]> {
  const jobs: Job[] = JSON.parse(readFileSync(opts.jobsPath, "utf-8"));
  const cvText = readFileSync(opts.cvPath, "utf-8");

  // Use profile.json skills if available (richer than raw text extraction)
  const profilePath = resolve(dirname(opts.jobsPath), "profile.json");
  let cvTerms: string[];
  if (existsSync(profilePath)) {
    const profile: Profile = JSON.parse(readFileSync(profilePath, "utf-8"));
    cvTerms = profile.skills.length > 0 ? profile.skills : extractTerms(cvText);
    console.log(`Matching ${jobs.length} jobs using profile (${cvTerms.length} skills)...`);
  } else {
    cvTerms = extractTerms(cvText);
    console.log(`Matching ${jobs.length} jobs against CV (${cvTerms.length} terms extracted)...`);
  }
  const minScore = opts.minScore ?? 1;
  console.log(`  Top terms: ${cvTerms.slice(0, 10).join(", ")}`);
  const matched: MatchedJob[] = jobs
    .map((job) => {
      const { score, reasons } = scoreJob(job, cvTerms);
      return { ...job, keyword_score: score, match_reasons: reasons };
    })
    .filter(j => j.keyword_score >= minScore)
    .filter(j => opts.maxYoe == null || j.parsed?.yoe?.min == null || j.parsed.yoe.min <= opts.maxYoe)
    .sort((a, b) => b.keyword_score - a.keyword_score);

  writeFileSync(opts.outputPath, JSON.stringify(matched, null, 2));
  console.log(`  ${matched.length} jobs above threshold (score >= ${minScore})`);
  if (matched.length > 0) {
    console.log(`  Top 5:`);
    for (const j of matched.slice(0, 5)) {
      console.log(`    [${j.keyword_score}] ${j.title} @ ${j.company} — ${j.url}`);
    }
  }
  console.log(`  Written to ${opts.outputPath}`);
  return matched;
}
