#!/usr/bin/env node
// Stand-in for the opencode CLI in tests: prints a fixed event stream.
// FAKE_OPENCODE_MODE=hang never exits, to exercise the timeout.
const args = process.argv.slice(2);
if (process.env.FAKE_OPENCODE_MODE === "hang") {
  setInterval(() => {}, 1000);
} else {
  const session = "ses_fake";
  const events = [
    { type: "step_start", sessionID: session, part: { type: "step-start" } },
    {
      type: "tool_use",
      sessionID: session,
      part: { tool: "skill", state: { status: "completed", input: { name: "rutas-y-alcance" } } },
    },
    {
      type: "tool_use",
      sessionID: session,
      part: { tool: "write", state: { status: "completed", input: { filePath: "/p/a.js" } } },
    },
    { type: "text", sessionID: session, part: { text: `args=${JSON.stringify(args)}` } },
    {
      type: "step_finish",
      sessionID: session,
      part: { reason: "stop", tokens: { input: 10, output: 5, reasoning: 1 } },
    },
  ];
  for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
}
