// Resume/Profile module
// Supports: local PDF, local text, cv-pro handle (remote)
// Outputs: structured Profile for matching + raw text for LLM

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve } from "path";

export interface Profile {
  skills: string[];
  yoe: number;
  level: string;              // "junior" | "mid" | "senior" | "staff"
  locations: string[];
  salary_floor?: number;
  visa_needs: "h1b" | "perm" | "citizen" | "none";
  excluded_industries?: string[];
  excluded_companies?: string[];
  raw_resume: string;         // full text for LLM match
  source: "pdf" | "text" | "cv-pro" | "interview";
}

// --- CV-Pro integration (remote) ---

async function loadFromCvPro(handle: string): Promise<{ raw: string; structured: any }> {
  const url = `https://cv.ha7ch.com/${handle}.json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cv-pro: could not fetch ${handle} (HTTP ${res.status})`);
  const data = await res.json() as any;

  // Flatten cv-pro JSON to raw text for LLM
  const parts: string[] = [];
  if (data.header?.name) parts.push(data.header.name);
  if (data.header?.title) parts.push(data.header.title);
  if (data.personalInfo?.summary) parts.push(data.personalInfo.summary);
  for (const exp of data.experience ?? []) {
    parts.push(`${exp.title ?? ""} at ${exp.company ?? ""} (${exp.startDate ?? ""} - ${exp.endDate ?? "present"})`);
    for (const b of exp.bullets ?? []) parts.push(`  - ${b}`);
  }
  for (const edu of data.education ?? []) {
    parts.push(`${edu.degree ?? ""} ${edu.school ?? ""}`);
  }
  if (data.skills?.length) parts.push(`Skills: ${data.skills.join(", ")}`);

  return { raw: parts.join("\n"), structured: data };
}

// --- Local PDF (placeholder — needs pdf-parse or similar) ---

async function loadFromPdf(pdfPath: string): Promise<string> {
  // For now, try to read as text. Real PDF parsing needs a dependency.
  console.log("  ⚠ PDF parsing not yet implemented — treating as text file");
  return readFileSync(resolve(pdfPath), "utf-8");
}

// --- LLM profile extraction ---

async function extractProfile(rawText: string, llmExtract?: (prompt: string) => Promise<string>): Promise<Partial<Profile>> {
  if (!llmExtract) {
    return heuristicExtract(rawText);
  }

  try {
    const prompt = `Extract a structured profile from this resume. Return JSON only:
{"skills": ["skill1", "skill2", ...], "yoe": <number>, "level": "junior|mid|senior|staff", "locations": ["preferred locations"], "visa_needs": "h1b|perm|citizen|none"}

Only include what you can determine from the text. If uncertain, omit the field.

RESUME:
${rawText.slice(0, 4000)}`;

    const result = await llmExtract(prompt);
    const cleaned = result.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    return JSON.parse(cleaned);
  } catch {
    console.log("  ⚠ LLM extraction failed, using heuristic fallback");
    return heuristicExtract(rawText);
  }
}

function heuristicExtract(text: string): Partial<Profile> {
  const lower = text.toLowerCase();
  const skills: string[] = [];

  const techTerms = ["typescript", "javascript", "python", "java", "go", "rust", "react", "node.js",
    "aws", "kubernetes", "docker", "distributed systems", "machine learning", "sql", "graphql",
    "c++", "scala", "ruby", "terraform", "ci/cd", "microservices", "rest api"];
  for (const t of techTerms) {
    if (lower.includes(t)) skills.push(t);
  }

  // YOE heuristic: look for "N years" or "N+ years"
  const yoeMatch = text.match(/(\d+)\+?\s*years?\s*(?:of\s*)?(?:experience|professional)/i);
  const yoe = yoeMatch ? parseInt(yoeMatch[1]) : undefined;

  return { skills, ...(yoe != null ? { yoe } : {}) };
}

// --- Main entry ---

export interface LoadResumeOptions {
  source: string;  // path to PDF/text file, OR cv-pro handle (e.g. "@myhandle")
  outputPath: string;
  llmExtract?: (prompt: string) => Promise<string>;
}

export async function loadResume(opts: LoadResumeOptions): Promise<Profile> {
  let rawText: string;
  let sourceType: Profile["source"];
  let structuredData: any = null;

  if (opts.source.startsWith("@")) {
    // cv-pro handle
    const handle = opts.source.slice(1);
    console.log(`Loading resume from cv-pro: ${handle}...`);
    const result = await loadFromCvPro(handle);
    rawText = result.raw;
    structuredData = result.structured;
    sourceType = "cv-pro";
  } else if (opts.source.endsWith(".pdf")) {
    console.log(`Parsing PDF: ${opts.source}...`);
    rawText = await loadFromPdf(resolve(opts.source));
    sourceType = "pdf";
  } else {
    console.log(`Reading text resume: ${opts.source}...`);
    rawText = readFileSync(resolve(opts.source), "utf-8");
    sourceType = "text";
  }

  console.log(`  ${rawText.length} chars extracted`);

  // Extract structured profile
  const extracted = await extractProfile(rawText, opts.llmExtract);

  // If cv-pro, enrich with structured data
  if (structuredData?.skills?.length) {
    extracted.skills = structuredData.skills;
  }

  const profile: Profile = {
    skills: extracted.skills ?? [],
    yoe: extracted.yoe ?? 0,
    level: extracted.level ?? "mid",
    locations: extracted.locations ?? [],
    salary_floor: extracted.salary_floor,
    visa_needs: extracted.visa_needs ?? "none",
    excluded_industries: extracted.excluded_industries,
    excluded_companies: extracted.excluded_companies,
    raw_resume: rawText,
    source: sourceType,
  };

  writeFileSync(opts.outputPath, JSON.stringify(profile, null, 2));
  console.log(`  Profile saved: ${profile.skills.length} skills, ${profile.yoe} YOE, level=${profile.level}`);
  console.log(`  Written to ${opts.outputPath}`);
  return profile;
}
