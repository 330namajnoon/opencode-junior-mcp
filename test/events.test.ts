import { describe, expect, it } from "vitest";
import { parseEvents } from "../src/opencode/events.js";

// Events captured from a real `opencode run --format json` (trimmed).
const realRun = [
  '{"type":"step_start","sessionID":"ses_1","part":{"type":"step-start"}}',
  '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"skill","state":{"status":"completed","input":{"name":"rutas-y-alcance"},"output":"..."}}}',
  '{"type":"step_finish","sessionID":"ses_1","part":{"reason":"tool-calls","tokens":{"total":10659,"input":10256,"output":17,"reasoning":386}}}',
  '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"write","state":{"status":"completed","input":{"content":"x","filePath":"/proj/div.js"}}}}',
  '{"type":"tool_use","sessionID":"ses_1","part":{"type":"tool","tool":"bash","state":{"status":"error","input":{"command":"node -v"},"error":"The user has specified a rule which prevents you from using this specific tool call."}}}',
  '{"type":"text","sessionID":"ses_1","part":{"type":"text","text":"**Resumen** creado div.js"}}',
  '{"type":"step_finish","sessionID":"ses_1","part":{"reason":"stop","tokens":{"input":11012,"output":145,"reasoning":0}}}',
].join("\n");

describe("parseEvents", () => {
  it("builds a report from a real event stream", () => {
    const report = parseEvents(realRun);
    expect(report.sessionId).toBe("ses_1");
    expect(report.text).toBe("**Resumen** creado div.js");
    expect(report.skillsLoaded).toEqual(["rutas-y-alcance"]);
    expect(report.filesChanged).toEqual(["/proj/div.js"]);
    expect(report.toolCalls.map((c) => c.tool)).toEqual(["skill", "write", "bash"]);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0]).toMatch(/^bash node -v: The user has specified a rule/);
    expect(report.tokens).toEqual({ input: 21268, output: 162, reasoning: 386 });
    expect(report.finishReason).toBe("stop");
  });

  it("reports top-level error events", () => {
    const report = parseEvents(
      '{"type":"error","sessionID":"ses_2","error":{"name":"UnknownError","data":{"message":"Unexpected server error."}}}',
    );
    expect(report.errors).toEqual(["Unexpected server error."]);
  });

  it("keeps non-JSON lines as errors and ignores blank lines", () => {
    const report = parseEvents("\nnot json\n\n");
    expect(report.errors).toEqual(["not json"]);
  });

  it("truncates very long tool errors", () => {
    const longError = "x".repeat(1000);
    const event = {
      type: "tool_use",
      part: { tool: "read", state: { status: "error", input: {}, error: longError } },
    };
    const report = parseEvents(JSON.stringify(event));
    expect(report.toolCalls[0]!.error!.length).toBeLessThan(400);
  });
});
