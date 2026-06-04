// Agent loop: multi-turn Bedrock Converse with tool use
import { execSync } from "child_process";
import { tmpdir } from "os";
import { writeFileSync, readFileSync, unlinkSync } from "fs";
import { join } from "path";
import { TOOL_DEFINITIONS, executeTool } from "./tools.js";
import { SYSTEM_PROMPT } from "./prompts.js";

interface Message {
  role: "user" | "assistant";
  content: any;
}

interface ConverseResponse {
  output: { message: { role: string; content: any[] } };
  stopReason: string;
}

const MODEL_ID = "us.anthropic.claude-haiku-4-5-20251001-v1:0";
const REGION = "us-west-2";
const MAX_TURNS = 10;

function callConverse(messages: Message[], system: string): ConverseResponse {
  const body = {
    modelId: MODEL_ID,
    system: [{ text: system }],
    messages,
    toolConfig: {
      tools: TOOL_DEFINITIONS.map(t => ({
        toolSpec: { name: t.name, description: t.description, inputSchema: { json: t.input_schema } },
      })),
    },
    inferenceConfig: { maxTokens: 2048 },
  };

  const inFile = join(tmpdir(), `converse-in-${Date.now()}.json`);
  const outFile = join(tmpdir(), `converse-out-${Date.now()}.json`);
  writeFileSync(inFile, JSON.stringify(body));

  try {
    execSync(
      `aws bedrock-runtime converse --cli-input-json file://${inFile} --region ${REGION} > ${outFile}`,
      { timeout: 60000, stdio: ["ignore", "ignore", "pipe"] }
    );
    return JSON.parse(readFileSync(outFile, "utf-8"));
  } finally {
    try { unlinkSync(inFile); } catch {}
    try { unlinkSync(outFile); } catch {}
  }
}

export async function agentLoop(readline: AsyncIterable<string>): Promise<void> {
  const messages: Message[] = [];
  console.log("job-agent chat (type 'exit' to quit)\n");

  for await (const line of readline) {
    const input = line.trim();
    if (!input) continue;
    if (input === "exit" || input === "quit") break;

    messages.push({ role: "user", content: [{ text: input }] });

    let turns = 0;
    while (turns < MAX_TURNS) {
      turns++;
      let response: ConverseResponse;
      try {
        response = callConverse(messages, SYSTEM_PROMPT);
      } catch (e: any) {
        console.error(`\n❌ API error: ${e.message}`);
        messages.pop(); // remove failed user message
        break;
      }

      const assistantContent = response.output.message.content;
      messages.push({ role: "assistant", content: assistantContent });

      // Check if there are tool uses
      const toolUses = assistantContent.filter((c: any) => c.toolUse);
      if (toolUses.length === 0) {
        // Text response — print and wait for next input
        const text = assistantContent.find((c: any) => c.text)?.text ?? "";
        console.log(`\n${text}\n`);
        break;
      }

      // Execute tools
      const toolResults: any[] = [];
      for (const block of toolUses) {
        const { toolUseId, name, input: toolInput } = block.toolUse;
        console.log(`  ⚡ ${name}(${JSON.stringify(toolInput)})`);
        const result = await executeTool(name, toolInput);
        toolResults.push({ toolResult: { toolUseId, content: [{ text: result }] } });
      }

      // Send tool results back
      messages.push({ role: "user", content: toolResults });
    }

    if (turns >= MAX_TURNS) {
      console.log("\n⚠ Max tool turns reached. Stopping.\n");
    }
  }
}
