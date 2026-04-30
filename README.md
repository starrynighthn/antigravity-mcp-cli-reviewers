# Antigravity MCP CLI Reviewers

This project provides a Model Context Protocol (MCP) server that connects Antigravity (and other AI assistants) with external CLI-based AI reviewers (`gemini`, `codex`, `claude`). 

It allows Antigravity to act as an orchestrator, delegating code review and plan validation tasks to multiple AI agents simultaneously for diverse perspectives, automated iterative refinement, and higher quality output.

## Features
- **3 CLI Tools Integrated:** Support for Gemini CLI, Codex CLI, and Claude Code.
- **Async Execution & Timeout:** Safely executes CLIs via background processes with a configurable timeout (default 10 minutes) without blocking the MCP event loop.
- **Smart Stderr Filtering:** Filters out noise/warnings from CLI outputs (e.g., color warnings, ripgrep fallback, etc.) to give clean context back to the AI.
- **Health Check System:** Periodic background pinging to verify CLI tools are authenticated and available.
- **Auto-Retry Mechanism:** Automatically handles `429 Rate limit exceeded` errors for Gemini with a 5-second backoff.

---

## 1. Installation

### Quick Install (Using the Zip File)
For convenience, a packaged release `cli-reviewer-mcp.zip` is included.

1. Unzip the package into your desired location (e.g., `~/.gemini/cli-reviewer-mcp`).
   ```bash
   unzip cli-reviewer-mcp.zip -d ~/.gemini/cli-reviewer-mcp
   ```
2. Navigate to the directory and install Node dependencies.
   ```bash
   cd ~/.gemini/cli-reviewer-mcp
   npm install
   ```

### Register MCP in Antigravity
Open your Antigravity configuration file (usually located at `~/.gemini/antigravity/mcp_config.json`) and add this server:

```json
{
  "mcpServers": {
    "cli-reviewer-mcp": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/.gemini/cli-reviewer-mcp/index.js"]
    }
  }
}
```

*Restart Antigravity after editing this file.*

---

## 2. Installing & Authenticating CLI Tools

This MCP relies on the underlying CLIs being installed and authenticated globally on your machine.

### Gemini CLI
- **Install:** `npm install -g @google/gemini-cli`
- **Auth:** Run `gemini auth login` in your terminal and follow the browser prompts.

### Claude Code
- **Install:** `npm install -g @anthropic/claude-code`
- **Auth:** Run `claude /login` in your terminal.

### Codex CLI
- **Install:** (Requires local setup or appropriate package manager for Codex CLI).
- **Auth:** Export your API key in your terminal profile (`~/.zshrc` or `~/.bashrc`):
  ```bash
  export OPENAI_API_KEY="your-api-key"
  ```

> **Note:** The MCP script assumes these CLIs are located at `/opt/homebrew/bin/`. If you are using a different OS or package manager, edit `index.js` to update the paths in `CLI_TOOLS`.

---

## 3. Setting Up the Review Workflow (AGENTS.md)

To make Antigravity automatically use this workflow, copy the `REVIEW_RULE.md` file included in this project and embed its contents into your project's `AGENTS.md` (or `GEMINI.md`).

This gives Antigravity the exact instructions on how to orchestrate the CLI reviewers iteratively.

**Example addition to `AGENTS.md`:**
```markdown
# AI Review & CLI Tooling Workflow

- **Without specific CLI:** If the user requests a review but does **not** name a specific CLI tool (Gemini, Claude, Codex), the current model evaluates the target directly.
- **With specific CLI(s):** When the user explicitly requests review via CLI tools (Gemini, Claude, Codex):
  1. **Artifact Preparation:** Ensure all artifacts/plans have a corresponding `.md` file in the workspace directory.
  2. **Review Loop:** Send the `.md` files or workspace changes to the specified CLI reviewers using the MCP tools.
  3. **Apply & Re-evaluate:** Analyze the review results, update the code, and send back to the CLI reviewer. Repeat until no findings remain.
  4. **Final Report:** Provide the user with a summary of the issues and applied solutions.
```

---

## 4. Usage & Prompts

Once installed and configured, you can ask Antigravity to utilize the reviewers.

**Example Prompts:**

- *"Tạo một kế hoạch tối ưu hoá state management bằng GetX. Sau đó, dùng Claude CLI và Gemini CLI để review kế hoạch này dựa trên best practices."*
  *(Create a state management optimization plan using GetX. Then use Claude CLI and Gemini CLI to review this plan based on best practices.)*

- *"Dùng codex review lại các file uncommitted trong workspace hiện tại xem có vi phạm architectural rules nào không."*
  *(Use codex to review the uncommitted files in the current workspace to see if they violate any architectural rules.)*

- *"Kiểm tra health check của các CLI tools."*
  *(Check the health of the CLI tools.)*

### How it works under the hood
- Antigravity will write the plan to a physical markdown file (e.g., `state_plan.md`).
- It will then invoke the `claude_cli` and `gemini_cli` MCP tools, passing the prompt and the file path.
- The MCP server uses `spawn()` to execute the CLIs safely, parses the output, strips away terminal UI noise, and returns the pure review text back to Antigravity.
- Antigravity reads the feedback, fixes the plan/code, and repeats if necessary.
