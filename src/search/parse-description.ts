// Description parser: extract salary, YOE, clearance, visa from job description text
// Uses regex heuristics — ~80% coverage (CA/CO/NY law requires salary disclosure)

import type { Job } from "../search/index.js";

interface ParsedFields {
  salary?: { min: number; max: number; currency: string };
  yoe?: { min: number; max?: number };
  clearance_required?: boolean;
  citizenship_required?: boolean;
  visa_sponsorship?: boolean;
  visa_evidence?: string;
}

// Salary patterns: "$120,000 - $180,000", "$120K-$180K", "$120k to $180k per year"
const SALARY_PATTERNS = [
  /\$\s*([\d,]+)\s*[k]?\s*[-–to]+\s*\$?\s*([\d,]+)\s*[k]?/gi,
  /(?:salary|compensation|pay|range)[:\s]*\$?\s*([\d,]+)\s*[k]?\s*[-–to]+\s*\$?\s*([\d,]+)\s*[k]?/gi,
  /\$([\d,]+)\s*-\s*\$([\d,]+)\s*(?:per year|annually|\/yr|\/year)?/gi,
];

function parseSalary(text: string): ParsedFields["salary"] | undefined {
  for (const re of SALARY_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (!m) continue;
    let min = parseFloat(m[1].replace(/,/g, ""));
    let max = parseFloat(m[2].replace(/,/g, ""));
    // Handle "120K" format
    if (min < 1000 && text.slice(m.index!, m.index! + m[0].length + 5).toLowerCase().includes("k")) {
      min *= 1000;
      max *= 1000;
    }
    if (min > 10000 && max > 10000 && max > min) {
      return { min, max, currency: "USD" };
    }
  }
  return undefined;
}

// YOE patterns: "5+ years", "3-5 years of experience", "minimum 7 years"
const YOE_PATTERNS = [
  /(\d+)\s*\+?\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/gi,
  /(?:minimum|at least|min)\s*(\d+)\s*(?:years?|yrs?)/gi,
  /(\d+)\s*[-–to]+\s*(\d+)\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/gi,
];

function parseYoe(text: string): ParsedFields["yoe"] | undefined {
  // Try range first
  const rangeRe = /(\d+)\s*[-–to]+\s*(\d+)\s*(?:years?|yrs?)\s*(?:of\s+)?(?:experience|exp)/gi;
  const rm = rangeRe.exec(text);
  if (rm) {
    const min = parseInt(rm[1]);
    const max = parseInt(rm[2]);
    if (min >= 0 && min <= 20 && max > min) return { min, max };
  }
  // Then single value
  for (const re of YOE_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) {
      const val = parseInt(m[1]);
      if (val >= 0 && val <= 25) return { min: val };
    }
  }
  return undefined;
}

// Clearance/citizenship patterns
const CLEARANCE_PATTERNS = /(?:security clearance|ts\/sci|top secret|secret clearance|dod clearance)/i;
const CITIZENSHIP_PATTERNS = /(?:us citizen(?:ship)?|united states citizen|permanent resident required|must be a? ?u\.?s\.? (?:citizen|person))/i;

// Visa sponsorship: scan a SMALL window before each "sponsor" mention. Unbounded `.*`
// patterns produce false negatives (e.g. "without hidden fees ... sponsorship").
const NEG_NEAR = /\b(?:not|unable|cannot|can'?t|won'?t|will not|do(?:es)? not|don'?t|without|no)\b/;
const POS_NEAR = /\b(?:able to|eligible|offer|offers|provide|provides|will|can|do)\b/;

function snippet(text: string, idx: number, match: string): string {
  const start = Math.max(0, idx - 60);
  const end = Math.min(text.length, idx + match.length + 60);
  return (start > 0 ? "…" : "") + text.slice(start, end).replace(/\s+/g, " ").trim() + (end < text.length ? "…" : "");
}

function parseVisaClearance(text: string): Pick<ParsedFields, "clearance_required" | "citizenship_required" | "visa_sponsorship" | "visa_evidence"> {
  const result: Pick<ParsedFields, "clearance_required" | "citizenship_required" | "visa_sponsorship" | "visa_evidence"> = {};
  if (CLEARANCE_PATTERNS.test(text)) result.clearance_required = true;
  if (CITIZENSHIP_PATTERNS.test(text)) result.citizenship_required = true;

  const lc = text.toLowerCase();
  const re = /sponsor/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(lc))) {
    const start = Math.max(0, m.index - 45);
    const win = lc.slice(start, m.index + 12);
    if (NEG_NEAR.test(win) && !/able to (?:offer|provide)/.test(win)) {
      result.visa_sponsorship = false;          // explicit negation wins
      result.visa_evidence = snippet(text, m.index, "sponsor");
      return result;
    }
    if (result.visa_sponsorship === undefined && (POS_NEAR.test(win) || /visa\s*$/.test(win.slice(0, win.length - 7)))) {
      result.visa_sponsorship = true;
      result.visa_evidence = snippet(text, m.index, "sponsor");
    }
  }
  return result;
}

export function parseDescription(job: Job): Job {
  const text = job.description ?? "";
  if (!text) return job;

  const salary = parseSalary(text);
  const yoe = parseYoe(text);
  const { clearance_required, citizenship_required, visa_sponsorship, visa_evidence } = parseVisaClearance(text);

  const parsed: ParsedFields = {
    ...(salary && { salary }),
    ...(yoe && { yoe }),
    ...(clearance_required !== undefined && { clearance_required }),
    ...(citizenship_required !== undefined && { citizenship_required }),
    ...(visa_sponsorship !== undefined && { visa_sponsorship }),
    ...(visa_evidence && { visa_evidence }),
  };

  if (Object.keys(parsed).length === 0) return job;
  return { ...job, parsed: { ...job.parsed, ...parsed } };
}

// Batch parse all jobs
export function parseDescriptions(jobs: Job[]): { jobs: Job[]; stats: { salary: number; yoe: number; visa: number } } {
  let salary = 0, yoe = 0, visa = 0;
  const result = jobs.map(j => {
    const parsed = parseDescription(j);
    if (parsed.parsed?.salary) salary++;
    if (parsed.parsed?.yoe) yoe++;
    if (parsed.parsed?.visa_sponsorship !== undefined) visa++;
    return parsed;
  });
  return { jobs: result, stats: { salary, yoe, visa } };
}
