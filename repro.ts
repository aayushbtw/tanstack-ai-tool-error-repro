import { chat, modelMessagesToUIMessages, toolDefinition } from "@tanstack/ai";
import type { ModelMessage, StreamChunk, TextOptions } from "@tanstack/ai";
import { BaseTextAdapter } from "@tanstack/ai/adapters";
import * as z from "zod";

// A model that makes one tool call, then answers once it has the result.
class ScriptedAdapter extends BaseTextAdapter<"scripted", {}, readonly ["text"], never> {
  readonly name = "scripted";
  readonly toolName: string;
  readonly args: string;

  constructor(toolName: string, args: string) {
    super(undefined, "scripted");
    this.toolName = toolName;
    this.args = args;
  }

  async *chatStream(options: TextOptions<{}>): AsyncIterable<StreamChunk> {
    const base = { model: "scripted", timestamp: Date.now() };
    yield { ...base, type: "RUN_STARTED", runId: "r", threadId: "t" } as StreamChunk;
    if (!options.messages.some((message) => message.role === "tool")) {
      yield { ...base, type: "TOOL_CALL_START", toolCallId: "call_1", toolCallName: this.toolName } as StreamChunk;
      yield { ...base, type: "TOOL_CALL_ARGS", toolCallId: "call_1", delta: this.args } as StreamChunk;
      yield { ...base, type: "TOOL_CALL_END", toolCallId: "call_1" } as StreamChunk;
      yield { ...base, type: "RUN_FINISHED", runId: "r", threadId: "t", finishReason: "tool_calls" } as StreamChunk;
      return;
    }
    yield { ...base, type: "TEXT_MESSAGE_START", messageId: "m", role: "assistant" } as StreamChunk;
    yield { ...base, type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Sorry, that failed." } as StreamChunk;
    yield { ...base, type: "TEXT_MESSAGE_END", messageId: "m" } as StreamChunk;
    yield { ...base, type: "RUN_FINISHED", runId: "r", threadId: "t", finishReason: "stop" } as StreamChunk;
  }

  async structuredOutput(): Promise<never> {
    throw new Error("not used");
  }
}

const lookup = (handler: () => string) =>
  toolDefinition({
    name: "lookup",
    description: "Look something up.",
    inputSchema: z.object({ query: z.string() }),
  }).server(handler);

const cases = [
  { name: "input fails the schema", tool: "lookup", args: '{"query":1}', handler: () => "found" },
  {
    name: "handler throws",
    tool: "lookup",
    args: '{"query":"acme"}',
    handler: (): string => {
      throw new Error("lookup is down");
    },
  },
  { name: "unknown tool", tool: "missing", args: "{}", handler: () => "found" },
];

for (const { name, tool, args, handler } of cases) {
  let streamedMetadata: unknown;
  let finalMessages: ModelMessage[] = [];

  for await (const chunk of chat({
    adapter: new ScriptedAdapter(tool, args),
    messages: [{ role: "user", content: "Look up Acme" }],
    tools: [lookup(handler)],
    // The same list @tanstack/ai-persistence saves at the end of a run.
    middleware: [{ onFinish: (ctx) => { finalMessages = [...ctx.messages]; } }],
  })) {
    if (chunk.type === "TOOL_CALL_RESULT") {
      streamedMetadata = chunk.metadata;
    }
  }

  const toolMessage = finalMessages.find((message) => message.role === "tool");
  const rebuilt = modelMessagesToUIMessages(finalMessages)
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool-result");

  console.log(`\n## ${name}`);
  console.log("1. streamed TOOL_CALL_RESULT metadata:", streamedMetadata);
  console.log("2. saved tool message:", toolMessage);
  console.log("3. rebuilt tool-result part:", { state: rebuilt?.state, error: rebuilt?.error });
}
