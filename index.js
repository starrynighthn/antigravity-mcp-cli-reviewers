const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const { spawn } = require("child_process");
const fs = require("fs");

const DEFAULT_TIMEOUT = 600000; // 10 minutes
const HEALTH_CHECK_INTERVAL = 30000; // 30 seconds

const server = new McpServer({
  name: "CLI Reviewer MCP",
  version: "1.2.1"
});

// ── Core Helpers ─────────────────────────────────────────────────────────────

/**
 * Run a CLI command using spawn (no shell) to avoid escaping issues.
 * stdin is closed immediately to prevent CLIs from waiting for input.
 * Returns { stdout, stderr }.
 */
function runCommand(bin, args, opts = {}) {
  const timeoutMs = opts.timeout || DEFAULT_TIMEOUT;
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      cwd: opts.cwd || process.cwd(),
      env: opts.env || process.env,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => { stdout += data.toString(); });
    proc.stderr.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code, signal) => {
      if (signal === "SIGTERM" || code === 143) {
        if (stdout.trim()) {
          resolve({ stdout: stdout + "\n[⚠️ Timed out after " + (timeoutMs / 1000) + "s — partial output]", stderr });
        } else {
          reject(new Error(`Process timed out after ${timeoutMs / 1000}s with no output.\n${stderr}`));
        }
      } else if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Process exited with code ${code}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });

    proc.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Filter known non-actionable warnings from stderr.
 */
function filterStderr(stderr, patterns) {
  return (stderr || "").split("\n").filter(line =>
    patterns.every(p => !line.includes(p)) && line.trim() !== ""
  ).join("\n");
}

// ── Health Check System ──────────────────────────────────────────────────────

const CLI_TOOLS = {
  gemini: { bin: "/opt/homebrew/bin/gemini", versionArgs: ["--version"] },
  codex:  { bin: "/opt/homebrew/bin/codex",  versionArgs: ["--version"] },
  claude: { bin: "/opt/homebrew/bin/claude", versionArgs: ["--version"] }
};

// Cached health status for each CLI
const healthStatus = {
  gemini: { available: false, version: null, lastCheck: null, error: null },
  codex:  { available: false, version: null, lastCheck: null, error: null },
  claude: { available: false, version: null, lastCheck: null, error: null }
};

/**
 * Check if a CLI tool is available and get its version (Async).
 */
async function checkCli(name) {
  const tool = CLI_TOOLS[name];
  const status = { available: false, version: null, lastCheck: new Date().toISOString(), error: null };

  try {
    if (!fs.existsSync(tool.bin)) {
      status.error = `Binary not found: ${tool.bin}`;
      return status;
    }

    const { stdout, stderr } = await runCommand(tool.bin, tool.versionArgs, { timeout: 10000 });
    
    // Some CLIs output version to stdout, some to stderr
    const output = stdout.trim() || stderr.trim();
    const ver = output.split("\n")[0].trim();
    
    if (ver && !ver.toLowerCase().includes("error")) {
      status.available = true;
      status.version = ver;
    } else {
      status.error = output || "Unknown error";
    }
  } catch (err) {
    status.error = err.message;
  }

  return status;
}

/**
 * Run health check for all CLI tools and update cached status (Async).
 */
async function runHealthCheck() {
  const checks = Object.keys(CLI_TOOLS).map(async (name) => {
    healthStatus[name] = await checkCli(name);
  });
  await Promise.all(checks);

  // Report status to Antigravity
  const statusLine = Object.keys(CLI_TOOLS).map(name => {
    return healthStatus[name].available ? `✅ ${name}` : `❌ ${name}`;
  }).join(" | ");
  
  const msg = `[Health Check] ${statusLine}`;
  console.error(msg); // Output to stderr so Antigravity logs it
  
  try {
    if (server.server && typeof server.server.sendLoggingMessage === "function") {
      server.server.sendLoggingMessage({ level: "info", data: msg });
    }
  } catch (e) {
    // Ignore if not supported
  }
}

// Initialize health checks asynchronously without blocking main thread
runHealthCheck().catch(console.error);
const healthInterval = setInterval(() => {
  runHealthCheck().catch(console.error);
}, HEALTH_CHECK_INTERVAL);
healthInterval.unref();

function formatHealth(name) {
  const s = healthStatus[name];
  const icon = s.available ? "✅" : "❌";
  const ver = s.version ? ` (${s.version})` : "";
  const err = s.error ? ` — ${s.error}` : "";
  const time = s.lastCheck ? ` [checked: ${s.lastCheck}]` : " [not checked]";
  return `${icon} ${name}${ver}${err}${time}`;
}

// ── Health Check Tool ────────────────────────────────────────────────────────

server.tool(
  "check_health",
  {
    refresh: z.boolean().optional().describe("Force a fresh health check instead of using cached results. Defaults to false.")
  },
  async ({ refresh }) => {
    if (refresh) {
      await runHealthCheck();
    }

    const lines = [
      "# CLI Health Status",
      "",
      `Check interval: ${HEALTH_CHECK_INTERVAL / 1000}s | Timeout: ${DEFAULT_TIMEOUT / 1000}s`,
      "",
      formatHealth("gemini"),
      formatHealth("codex"),
      formatHealth("claude"),
      "",
      `_Use \`refresh: true\` to force a fresh check._`
    ];

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }
);

// ── Gemini CLI Tool ──────────────────────────────────────────────────────────

server.tool(
  "gemini_cli",
  {
    prompt: z.string().describe("The prompt to send to the Gemini CLI."),
    cwd: z.string().optional().describe("Working directory for the command execution.")
  },
  async ({ prompt, cwd }) => {
    if (!healthStatus.gemini.available) {
      return {
        content: [{ type: "text", text: `❌ Gemini CLI is not available: ${healthStatus.gemini.error || "binary not found at " + CLI_TOOLS.gemini.bin}` }],
        isError: true
      };
    }
    try {
      const env = { ...process.env, TERM: "xterm-256color", PATH: `/opt/homebrew/bin:${process.env.PATH}` };
      let stdout, stderr;
      let retries = 2;

      while (true) {
        try {
          const result = await runCommand(CLI_TOOLS.gemini.bin, [prompt], { cwd, env });
          stdout = result.stdout;
          stderr = result.stderr;
          break;
        } catch (err) {
          if (retries > 0 && (err.message.includes("429") || err.message.toLowerCase().includes("rate limit"))) {
            retries--;
            await new Promise(r => setTimeout(r, 5000));
          } else {
            throw err;
          }
        }
      }

      const filtered = filterStderr(stderr, [
        "256-color support", "True color", "Ripgrep is not available",
        "Falling back to GrepTool"
      ]);
      return {
        content: [{ type: "text", text: stdout + (filtered ? "\nstderr:\n" + filtered : "") }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing gemini: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── Codex Review Tool ────────────────────────────────────────────────────────

server.tool(
  "codex_review",
  {
    target_type: z.enum(["workspace_uncommitted", "file", "artifact"]).describe("What to review: 'workspace_uncommitted' for git diffs, 'file'/'artifact' for specific files."),
    target_path: z.string().optional().describe("The path to the file or artifact. Required if target_type is 'file' or 'artifact'."),
    prompt: z.string().optional().describe("Optional custom instructions for the review."),
    cwd: z.string().optional().describe("Working directory for the command execution.")
  },
  async ({ target_type, target_path, prompt, cwd }) => {
    if (!healthStatus.codex.available) {
      return {
        content: [{ type: "text", text: `❌ Codex CLI is not available: ${healthStatus.codex.error || "binary not found at " + CLI_TOOLS.codex.bin}` }],
        isError: true
      };
    }
    try {
      let result;
      const opts = { cwd };

      if (target_type === "workspace_uncommitted") {
        const args = ["review", "--uncommitted"];
        if (prompt) args.push(prompt);
        result = await runCommand(CLI_TOOLS.codex.bin, args, opts);
      } else {
        if (!target_path) {
          throw new Error("target_path is required when target_type is file or artifact");
        }
        const instruction = `Please review the following file: ${target_path}.${prompt ? " " + prompt : ""}`;
        result = await runCommand(CLI_TOOLS.codex.bin, ["exec", instruction], opts);
      }

      const filtered = filterStderr(result.stderr, [
        "codex_core::session", "OpenAI Codex", "--------",
        "workdir:", "model:", "provider:", "approval:",
        "sandbox:", "reasoning", "session id:",
        "Reading additional input", "tokens used"
      ]);
      return {
        content: [{ type: "text", text: result.stdout + (filtered ? "\nstderr:\n" + filtered : "") }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing codex: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── Claude CLI Tool ──────────────────────────────────────────────────────────

server.tool(
  "claude_cli",
  {
    prompt: z.string().describe("The prompt to send to the Claude CLI."),
    cwd: z.string().optional().describe("Working directory for the command execution.")
  },
  async ({ prompt, cwd }) => {
    if (!healthStatus.claude.available) {
      return {
        content: [{ type: "text", text: `❌ Claude CLI is not available: ${healthStatus.claude.error || "binary not found at " + CLI_TOOLS.claude.bin}` }],
        isError: true
      };
    }
    try {
      const { stdout, stderr } = await runCommand(CLI_TOOLS.claude.bin, ["-p", prompt], { cwd });
      const filtered = filterStderr(stderr, [
        "no stdin data received", "proceeding without it"
      ]);
      return {
        content: [{ type: "text", text: stdout + (filtered ? "\nstderr:\n" + filtered : "") }]
      };
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error executing claude: ${error.message}` }],
        isError: true
      };
    }
  }
);

// ── Start server ─────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
