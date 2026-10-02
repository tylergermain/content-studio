# Specialist agents

At an empty desk, choose **Hire**, then select **Video Editor**, **Researcher**, **Designer**, or a saved custom specialist. Choose Claude Code, Codex, or Pi (local) independently of the role. An optional task starts the session immediately. General workers keep their existing behavior.

An admin can expand **Manage specialists** to edit the selected role or create a new one with a name, folder ID, and instructions. Saving creates these files under the floor's project:

```
agents/video-editor/
  AGENTS.md
  CLAUDE.md
  profile.json
  mcp.local.json
```

The agent starts in its role folder. `AGENTS.md` describes the role, and `CLAUDE.md` points Claude Code to those instructions. The floor's parent instructions still apply. Production paths are relative to the floor root, two levels above the specialist folder. Shared floor content remains visible in the worker's content previews. Worker sessions and role choices survive office restarts.

These are persistent local processes with shared floor access. A role folder does not enforce filesystem, tool, network, or desktop isolation. The existing bypass permission defaults still apply. Specialists currently use the main floor folder rather than a separate git worktree, meeting seat, or board station. Coordinate edits to shared files. A future container or VM runner would provide actual computer isolation.

## Additional MCP tools

Edit the role's `mcp.local.json` on the host, then hire or resume the specialist to apply it. The initial file has an empty `mcpServers` object. For example:

```json
{
  "mcpServers": {
    "editing": {
      "command": "node",
      "args": ["/absolute/path/to/editor-mcp.js"],
      "env": { "EDITOR_API_TOKEN": "your-private-token" }
    }
  }
}
```

Claude Code merges this with the office's native MCP configuration. Codex receives native MCP command, args, cwd, url, env_vars, bearer_token_env_var, and env_http_headers overrides. Values in `env` are passed through the worker environment rather than printed in command arguments. For authenticated HTTP tools in Codex, use environment variable references, not inline `http_headers`. Provider-global tools and authentication remain available; a role's additional tools are not an allowlist or an isolation boundary.

The local configuration is excluded by `/agents/*/mcp.local.json` in the floor's `.gitignore` and is restricted to mode 600 when launched. Keep credentials in that file, never in AGENTS.md or profile.json. The browser only receives tool names, never configuration credentials. Do not force-add the private file to Git.

Pi reads the role instructions and uses its installed tools and extensions. Pi has no built-in MCP client, so a role with additional MCP servers is rejected for Pi until an adapter is implemented. This version does not automatically install adapters.

The Video Editor role supplies editing instructions, not a new video editing engine. It uses installed skills, editing applications, CLI tools and configured MCP services. It preserves original production assets and needs the relevant tools available on the Studio.

## Employee hiring

Human member accounts see only specialists below their assigned org-chart position. Admins manage reporting relationships under **Org chart** in the office menu. See [employee permissions and delegation](org-chart.md). General workers remain available to admins, while employees need an assigned position with specialist roles underneath it.
