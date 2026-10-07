import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectChecks, formatCheckReport, relevantOutput, runCheck } from "../src/check.js";

describe("detectChecks", () => {
  it("uses the typecheck, lint and test scripts that exist, in that order", async () => {
    const dir = mkdtempSync(join(tmpdir(), "junior-check-"));
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "x", lint: "y" } }));
    expect(await detectChecks(dir)).toEqual(["npm run lint", "npm run test"]);
  });

  it("returns nothing without package.json", async () => {
    expect(await detectChecks(mkdtempSync(join(tmpdir(), "junior-check-")))).toEqual([]);
  });
});

describe("relevantOutput", () => {
  it("keeps error lines only and says how many were left out", () => {
    const out = relevantOutput("\x1b[32m✓ ok 1\x1b[0m\n✓ ok 2\nFAIL a.test.ts\nError: boom\n", 30);
    expect(out).toBe("FAIL a.test.ts\nError: boom\n… (2 other lines omitted)");
  });

  it("falls back to the last lines when nothing looks like an error", () => {
    expect(relevantOutput("a\nb\nc\n", 2)).toBe("b\nc\n… (1 other lines omitted)");
  });
});

describe("runCheck + formatCheckReport", () => {
  it("reports OK briefly and failures with their error lines", async () => {
    const cwd = tmpdir();
    const ok = await runCheck("echo fine", cwd, 5000);
    const bad = await runCheck("echo noise; echo 'Error: broken' >&2; exit 2", cwd, 5000);
    const report = formatCheckReport([ok, bad], 30);
    expect(report).toContain("## Checks: 1/2 passed");
    expect(report).toContain("- OK `echo fine`");
    expect(report).toContain("FAILED (exit 2)");
    expect(report).toContain("Error: broken");
    expect(report).not.toContain("fine\n");
  });

  it("stops commands that run past the timeout", async () => {
    const result = await runCheck("sleep 5", tmpdir(), 200);
    expect(result.timedOut).toBe(true);
  });
});
