/**
 * Parsing of the JSON event stream printed by `opencode run --format json`
 * (one JSON object per line) into a compact report of what the junior did.
 */

export interface ToolCall {
  tool: string;
  status: string;
  /** Short human-readable description of the call (file path, pattern, skill name...). */
  target: string;
  error?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning: number;
}

export interface RunReport {
  sessionId: string | undefined;
  /** Final text the junior wrote (its summary for the senior). */
  text: string;
  skillsLoaded: string[];
  filesChanged: string[];
  toolCalls: ToolCall[];
  errors: string[];
  tokens: TokenUsage;
  /** Reason of the last step (`stop` when the junior finished on its own). */
  finishReason: string | undefined;
}

const FILE_TOOLS = new Set(["write", "edit", "patch", "multiedit"]);
const MAX_ERROR_LENGTH = 300;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function describeTarget(input: Json): string {
  const keys = ["filePath", "path", "name", "pattern", "command", "url"];
  for (const key of keys) {
    const value = str(input[key]);
    if (value) return value;
  }
  return "";
}

export function emptyReport(): RunReport {
  return {
    sessionId: undefined,
    text: "",
    skillsLoaded: [],
    filesChanged: [],
    toolCalls: [],
    errors: [],
    tokens: { input: 0, output: 0, reasoning: 0 },
    finishReason: undefined,
  };
}

/** Folds one event into the report. Unknown events are ignored. */
export function applyEvent(report: RunReport, event: unknown): void {
  if (!isObject(event)) return;
  report.sessionId ??= str(event.sessionID);
  const part = isObject(event.part) ? event.part : {};

  switch (event.type) {
    case "text": {
      const text = str(part.text);
      if (text) report.text = report.text ? `${report.text}\n${text}` : text;
      break;
    }
    case "tool_use": {
      const tool = str(part.tool) ?? "unknown";
      const state = isObject(part.state) ? part.state : {};
      const input = isObject(state.input) ? state.input : {};
      const status = str(state.status) ?? "unknown";
      const target = describeTarget(input);
      const call: ToolCall = { tool, status, target };
      if (status === "error") {
        call.error = truncate(str(state.error) ?? "unknown error", MAX_ERROR_LENGTH);
        report.errors.push(`${tool} ${target}: ${call.error}`.trim());
      } else if (status === "completed") {
        if (tool === "skill" && target && !report.skillsLoaded.includes(target)) {
          report.skillsLoaded.push(target);
        }
        if (FILE_TOOLS.has(tool) && target && !report.filesChanged.includes(target)) {
          report.filesChanged.push(target);
        }
      }
      report.toolCalls.push(call);
      break;
    }
    case "step_finish": {
      const tokens = isObject(part.tokens) ? part.tokens : {};
      report.tokens.input += num(tokens.input);
      report.tokens.output += num(tokens.output);
      report.tokens.reasoning += num(tokens.reasoning);
      report.finishReason = str(part.reason) ?? report.finishReason;
      break;
    }
    case "error": {
      const error = isObject(event.error) ? event.error : {};
      const data = isObject(error.data) ? error.data : {};
      report.errors.push(str(data.message) ?? str(error.name) ?? JSON.stringify(event.error));
      break;
    }
  }
}

/** Parses a full JSONL output. Lines that are not JSON are kept as errors. */
export function parseEvents(output: string): RunReport {
  const report = emptyReport();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      report.errors.push(trimmed);
      continue;
    }
    applyEvent(report, event);
  }
  return report;
}
