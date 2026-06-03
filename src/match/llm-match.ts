// LLM Match: Pass 2 deep matching via pluggable LLM providers
// Evaluates full job description vs CV for detailed fit analysis

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import type { Job } from "../search/index.js";

export interface LLMMatchResult {
  score: number;
  recommendation: "STRONG_MATCH" | "MATCH" | "WEAK" | "SKIP";
  skill_gaps: string[];
  strengths: string[];
  reasoning: string;
}

export interface LLMConfig {
  enabled: boolean;
  provider: "bedrock" | "openai" | "ollama" | "anthropic";
  model: string;
  max_concurrent: number;
  max_cost_per_run: number;
  api_key?: string;
  region?: string;
}

interface LLMAdapter {
  evaluate(cv: string, job: Job): Promise<LLMMatchResult>;
}

const SYSTEM_PROMPT = `You are a job-candidate matching expert. Evaluate how well this candidate's resume fits the job posting.
Return JSON only (no markdown, no extra text):
{"score": 0-100, "recommendation": "STRONG_MATCH|MATCH|WEAK|SKIP", "skill_gaps": ["..."], "strengths": ["..."], "reasoning": "1-2 sentences"}`;

function buildPrompt(cv: string, job: Job): string {
  const desc = job.description?.slice(0, 3000) ?? `${job.title} at ${job.company}, ${job.location}. ${job.department}`;
  return `RESUME:\n${cv.slice(0, 2000)}\n\nJOB POSTING:\nTitle: ${job.title}\nCompany: ${job.company}\nLocation: ${job.location}\n\n${desc}`;
}

// --- Bedrock adapter (AWS SDK v3 via CLI) ---
function createBedrockAdapter(config: LLMConfig): LLMAdapter {
  return {
    async evaluate(cv: string, job: Job): Promise<LLMMatchResult> {
      const { execSync } = await import("child_process");
      const { tmpdir } = await import("os");
      const { writeFileSync, readFileSync, unlinkSync } = await import("fs");
      const { join } = await import("path");
      const body = JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildPrompt(cv, job) }],
      });

      // Body via temp file (avoids shell-escaping huge JD text); output via temp file
      // (avoids the CLI appending its {"contentType":...} metadata to stdout).
      const bodyFile = join(tmpdir(), `bedrock-in-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      const outFile = join(tmpdir(), `bedrock-out-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
      writeFileSync(bodyFile, body);
      try {
        const cmd = `aws bedrock-runtime invoke-model --model-id ${config.model} --content-type application/json --cli-binary-format raw-in-base64-out --body fileb://${bodyFile}${config.region ? ` --region ${config.region}` : ""} ${outFile}`;
        execSync(cmd, { timeout: 30000, stdio: ["ignore", "ignore", "ignore"] });
        const parsed = JSON.parse(readFileSync(outFile, "utf-8"));
        let text = parsed.content?.[0]?.text ?? parsed.completion ?? "";
        text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
        return JSON.parse(text);
      } finally {
        try { unlinkSync(bodyFile); } catch {}
        try { unlinkSync(outFile); } catch {}
      }
    },
  };
}

// --- OpenAI/Anthropic adapter (direct HTTP) ---
function createHttpAdapter(config: LLMConfig): LLMAdapter {
  const baseUrl = config.provider === "ollama" ? "http://localhost:11434/v1"
    : config.provider === "openai" ? "https://api.openai.com/v1"
    : "https://api.anthropic.com/v1";

  return {
    async evaluate(cv: string, job: Job): Promise<LLMMatchResult> {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(config.api_key ? { Authorization: `Bearer ${config.api_key}` } : {}),
        },
        body: JSON.stringify({
          model: config.model,
          max_tokens: 500,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildPrompt(cv, job) },
          ],
        }),
      });
      if (!res.ok) throw new Error(`LLM API ${res.status}: ${await res.text()}`);
      const data = await res.json() as any;
      const text = data.choices?.[0]?.message?.content ?? "";
      return JSON.parse(text);
    },
  };
}

function createAdapter(config: LLMConfig): LLMAdapter {
  if (config.provider === "bedrock") return createBedrockAdapter(config);
  return createHttpAdapter(config);
}

export function loadLLMConfig(dataDir: string): LLMConfig | null {
  const configPath = resolve(dataDir, "../config.json");
  if (!existsSync(configPath)) return null;
  const cfg = JSON.parse(readFileSync(configPath, "utf-8"));
  const llm = cfg.llm_match ?? cfg.match?.llm_match;
  if (!llm?.enabled) return null;
  return llm as LLMConfig;
}

export async function llmMatch(
  jobs: Job[],
  cvText: string,
  config: LLMConfig,
): Promise<Map<string, LLMMatchResult>> {
  const adapter = createAdapter(config);
  const results = new Map<string, LLMMatchResult>();
  const concurrency = config.max_concurrent || 3;

  console.log(`  LLM Match: evaluating ${jobs.length} jobs (${config.provider}/${config.model}, ${concurrency} concurrent)...`);

  for (let i = 0; i < jobs.length; i += concurrency) {
    const batch = jobs.slice(i, i + concurrency);
    const settled = await Promise.allSettled(
      batch.map(async (job) => {
        const result = await adapter.evaluate(cvText, job);
        return { id: job.id, result };
      })
    );
    for (const s of settled) {
      if (s.status === "fulfilled") {
        results.set(s.value.id, s.value.result);
      }
    }
  }

  const strong = [...results.values()].filter(r => r.recommendation === "STRONG_MATCH").length;
  const match = [...results.values()].filter(r => r.recommendation === "MATCH").length;
  console.log(`  LLM results: ${strong} STRONG, ${match} MATCH, ${results.size - strong - match} other`);
  return results;
}
