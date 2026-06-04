// Agent tools: expose job-agent modules as callable tool definitions
import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { search } from "../search/index.js";
import { match } from "../match/index.js";
import { loadLLMConfig, llmMatch } from "../match/llm-match.js";
import { review } from "../review/index.js";
import { loadResume } from "../resume/index.js";
import type { Job } from "../search/index.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../../data");

export interface ToolDef {
  name: string;
  description: string;
  input_schema: { type: "object"; properties: Record<string, any>; required?: string[] };
}

export const TOOL_DEFINITIONS: ToolDef[] = [
  {
    name: "search_jobs",
    description: "Search ATS boards (Greenhouse, Lever, Ashby, Workday) for job postings matching a query. Returns number of jobs found.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Job search query e.g. 'software engineer'" },
        locations: { type: "string", description: "Comma-separated locations e.g. 'Remote,Seattle'" },
        perm_only: { type: "boolean", description: "Only search companies with DOL PERM filings" },
        skip_titles: { type: "string", description: "Comma-separated title keywords to exclude e.g. 'intern,staff'" },
        limit: { type: "number", description: "Limit companies searched (testing only)" },
      },
      required: ["query"],
    },
  },
  {
    name: "match_jobs",
    description: "Score and rank current jobs against the loaded resume/profile. Uses keyword matching + optional LLM deep scoring.",
    input_schema: {
      type: "object",
      properties: {
        skip_llm: { type: "boolean", description: "Skip LLM Pass 2 (keyword-only, free)" },
        max_yoe: { type: "number", description: "Filter out jobs requiring more than N years experience" },
      },
    },
  },
  {
    name: "show_results",
    description: "Show top matched jobs to the user with scores, companies, and links.",
    input_schema: {
      type: "object",
      properties: {
        top: { type: "number", description: "Number of results to show (default 10)" },
        require_perm: { type: "boolean", description: "Only show companies with PERM filings" },
        require_h1b: { type: "boolean", description: "Only show jobs mentioning H-1B sponsorship" },
        min_perm_filings: { type: "number", description: "Minimum quarterly PERM filings" },
      },
    },
  },
  {
    name: "load_resume",
    description: "Load a resume from a text file or cv-pro handle. Creates a structured profile for matching.",
    input_schema: {
      type: "object",
      properties: {
        source: { type: "string", description: "Path to resume file, or @cv-pro-handle" },
      },
      required: ["source"],
    },
  },
];

export async function executeTool(name: string, input: Record<string, any>): Promise<string> {
  switch (name) {
    case "search_jobs": {
      const jobs = await search({
        companiesPath: resolve(DATA_DIR, "companies.json"),
        outputPath: resolve(DATA_DIR, "jobs.json"),
        query: input.query ?? "software engineer",
        locations: input.locations?.split(","),
        skipTitles: input.skip_titles?.split(","),
        permOnly: input.perm_only ?? false,
        limit: input.limit,
      });
      return `Found ${jobs.length} jobs. Saved to data/jobs.json.`;
    }

    case "match_jobs": {
      const cvPath = resolve(DATA_DIR, "../resume.txt");
      const matched = await match({
        jobsPath: resolve(DATA_DIR, "jobs.json"),
        outputPath: resolve(DATA_DIR, "matched.json"),
        cvPath,
        maxYoe: input.max_yoe,
      });
      if (!input.skip_llm) {
        const llmConfig = loadLLMConfig(DATA_DIR);
        if (llmConfig) {
          const cvText = readFileSync(cvPath, "utf-8");
          const results = await llmMatch(matched.slice(0, 50), cvText, llmConfig);
          for (const j of matched) {
            const r = results.get(j.id);
            if (r) j.llm_match = r;
          }
          matched.sort((a, b) => (b.llm_match?.score ?? b.keyword_score) - (a.llm_match?.score ?? a.keyword_score));
          writeFileSync(resolve(DATA_DIR, "matched.json"), JSON.stringify(matched, null, 2));
        }
      }
      return `Matched ${matched.length} jobs. Top 5:\n${matched.slice(0, 5).map(j => `  [${j.llm_match?.score ?? j.keyword_score}] ${j.title} @ ${j.company}`).join("\n")}`;
    }

    case "show_results": {
      const output = await review({
        matchedPath: resolve(DATA_DIR, "matched.json"),
        outputPath: resolve(DATA_DIR, "review-output.json"),
        top: input.top ?? 10,
        requireH1b: input.require_h1b ?? false,
        excludeNoH1b: false,
        requirePerm: input.require_perm ?? false,
        minPermFilings: input.min_perm_filings,
      });
      return "Results displayed above.";
    }

    case "load_resume": {
      const profile = await loadResume({
        source: input.source,
        outputPath: resolve(DATA_DIR, "profile.json"),
      });
      return `Profile loaded: ${profile.skills.length} skills, ${profile.yoe} YOE, level=${profile.level}. Source: ${profile.source}`;
    }

    default:
      return `Unknown tool: ${name}`;
  }
}
