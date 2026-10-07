import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { buildArgs, runJunior } from "../src/opencode/runner.js";

const fakeOpencode = fileURLToPath(new URL("./fixtures/fake-opencode.mjs", import.meta.url));
const cwd = fileURLToPath(new URL(".", import.meta.url));

function config(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({}), opencodeBin: fakeOpencode, ...overrides };
}

describe("buildArgs", () => {
  it("builds the opencode run command", () => {
    expect(buildArgs(loadConfig({}), { prompt: "do it", cwd: "/p" })).toEqual([
      "run",
      "--format",
      "json",
      "--agent",
      "junior",
      "--dir",
      "/p",
      "--",
      "do it",
    ]);
  });

  it("adds session and attach url when given", () => {
    const args = buildArgs(config({ attachUrl: "http://localhost:4096" }), {
      prompt: "x",
      cwd: "/p",
      sessionId: "ses_1",
    });
    expect(args).toContain("--session");
    expect(args).toContain("ses_1");
    expect(args).toContain("--attach");
    expect(args.slice(-2)).toEqual(["--", "x"]);
  });

  it("passes the configured default model", () => {
    const args = buildArgs(loadConfig({ JUNIOR_MODEL: "litellm/gpt-oss-120b" }), {
      prompt: "x",
      cwd: "/p",
    });
    expect(args[args.indexOf("--model") + 1]).toBe("litellm/gpt-oss-120b");
  });

  it("uses the per-task model over the configured one", () => {
    const args = buildArgs(loadConfig({ JUNIOR_MODEL: "litellm/gpt-oss-120b" }), {
      prompt: "x",
      cwd: "/p",
      model: "litellm/qwen3-coder-next",
    });
    expect(args[args.indexOf("--model") + 1]).toBe("litellm/qwen3-coder-next");
  });
});

describe("runJunior", () => {
  it("runs opencode and parses its output", async () => {
    const result = await runJunior(config(), { prompt: "-starts with a dash", cwd });
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.sessionId).toBe("ses_fake");
    expect(result.model).toBe("(opencode default)");
    expect(result.skillsLoaded).toEqual(["rutas-y-alcance"]);
    expect(result.filesChanged).toEqual(["/p/a.js"]);
    expect(result.text).toContain('"-starts with a dash"');
  });

  it("stops the process when the timeout is reached", async () => {
    process.env.FAKE_OPENCODE_MODE = "hang";
    try {
      const result = await runJunior(config(), { prompt: "x", cwd, timeoutSeconds: 1 });
      expect(result.timedOut).toBe(true);
    } finally {
      delete process.env.FAKE_OPENCODE_MODE;
    }
  });

  it("rejects when opencode cannot be started", async () => {
    await expect(
      runJunior(config({ opencodeBin: "/nonexistent/opencode" }), { prompt: "x", cwd }),
    ).rejects.toThrow(/Could not start opencode/);
  });
});
