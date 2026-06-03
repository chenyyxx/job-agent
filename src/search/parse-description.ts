// Description parser: extract salary, YOE, clearance, visa from job description text
// Uses regex heuristics — ~80% coverage (CA/CO/NY law requires salary disclosure)

import type { Job } from "../search/index.js";

interface ParsedFields {
  salary?: { min: number; max: number; currency: string };
  yoe?: { min: number; max?: number };
  clearance_required?: boolean;
  citizenship_required?: boolean;
  visa_sponsorship?: boolean;
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

// Clearance/citizenship/visa patterns
const CLEARANCE_PATTERNS = /(?:security clearance|ts\/sci|top secret|secret clearance|dod clearance)/i;
const CITIZENSHIP_PATTERNS = /(?:us citizen(?:ship)?|united states citizen|permanent resident required|must be a? ?u\.?s\.? (?:citizen|person))/i;
const VISA_POSITIVE = /(?:visa sponsor(?:ship)?|will sponsor|immigration sponsor|h-?1b sponsor)/i;
const VISA_NEGATIVE = /(?:not? (?:sponsor|provide)|unable to sponsor|cannot sponsor|without.*sponsor|no.*visa.*sponsor)/i;

function parseVisaClearance(text: string): Pick<ParsedFields, "clearance_required" | "citizenship_required" | "visa_sponsorship"> {
  const result: Pick<ParsedFields, "clearance_required" | "citizenship_required" | "visa_sponsorship"> = {};

  if (CLEARANCE_PATTERNS.test(text)) result.clearance_required = true;
  if (CITIZENSHIP_PATTERNS.test(text)) result.citizenship_required = true;
  if (VISA_NEGATIVE.test(text)) result.visa_sponsorship = false;
  else if (VISA_POSITIVE.test(text)) result.visa_sponsorship = true;

  return result;
}

export function parseDescription(job: Job): Job {
  const text = job.description ?? "";
  if (!text) return job;

  const salary = parseSalary(text);
  const yoe = parseYoe(text);
  const { clearance_required, citizenship_required, visa_sponsorship } = parseVisaClearance(text);

  const parsed: ParsedFields = {
    ...(salary && { salary }),
    ...(yoe && { yoe }),
    ...(clearance_required !== undefined && { clearance_required }),
    ...(citizenship_required !== undefined && { citizenship_required }),
    ...(visa_sponsorship !== undefined && { visa_sponsorship }),
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
