# AI Review & CLI Tooling Workflow

This rule applies exclusively to Antigravity sessions.

- **Without specific CLI:** If the user requests a review but does **not** name a specific CLI tool (Gemini, Claude, Codex), the current model evaluates the target directly and presents findings to the user. No MCP review loop is triggered.
- **With specific CLI(s):** When the user explicitly requests review via CLI tools (Gemini, Claude, Codex) through the CLI Reviewer MCP, follow the iterative workflow below:
  1. **Artifact Preparation:** Ensure all artifacts/plans have a corresponding `.md` file **in the workspace directory** so CLI tools can read them. If an artifact only exists internally (e.g., in Antigravity's app data), create a `.md` copy in the workspace root or a relevant subdirectory. Name the `.md` file descriptively to match the task (e.g., `performance_tracking_plan.md`, not `plan.md`). For code reviews, target the changed files in the workspace.
  2. **Review Loop:** Send the `.md` files or workspace changes to the specified CLI reviewers for evaluation.
  3. **Apply & Re-evaluate:** Analyze the review results, update the corresponding documentation/code, and send back to the CLI reviewer. Repeat this loop until there are no remaining findings or bugs.
  4. **Final Report:** Provide the user with a statistical summary of the issues discovered by the reviewers and a brief summary of the applied solutions.
  5. **Plan reviews — no auto-execution:** When reviewing a plan/proposal (not code), do **not** automatically proceed to execute code after the review loop completes. Present the fully reviewed plan together with the final consolidated review summary and **wait for explicit user approval** before starting implementation.
