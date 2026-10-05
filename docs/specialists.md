# Specialist agents

At an empty desk, choose **Hire**, then select **Video Editor**, **Researcher**, **Designer**, or a saved custom specialist. Choose Claude Code, Codex, or Pi (local) independently of the role. An optional task starts the session immediately. General workers remain available to admins. Human employee accounts can hire only roles allowed by the org chart.

An admin can expand **Manage specialists** to edit the selected role or create a new one with a name, folder ID, instructions, and an [interface](#interfaces). Saving creates these files under the floor's project:

```
agents/video-editor/
  AGENTS.md
  CLAUDE.md
  profile.json
  mcp.local.json
```

The agent starts in its role folder. `AGENTS.md` describes the role, and `CLAUDE.md` points Claude Code to those instructions. The floor's parent instructions still apply. Production paths are relative to the floor root, two levels above the specialist folder. Shared floor content remains visible in the worker's content previews, and so do the files it links in folders an admin shares with the floor, such as a render folder outside the project (see [sharing a folder with the floor](worker-chat.md#sharing-a-folder-with-the-floor)). Worker sessions and role choices survive office restarts.

A specialist hired at a desk in a [project room](office-builder.md#project-rooms) still starts in its role folder, and its first request tells it the room's project folder and app, so it does the task's work there.

These are persistent local processes with shared floor access. A role folder does not enforce filesystem, tool, network, or desktop isolation. The existing bypass permission defaults still apply. Specialists currently use the main floor folder rather than a separate git worktree, meeting seat, or board station. Coordinate edits to shared files. A future container or VM runner would provide actual computer isolation.

## Interfaces

Each tab is an **app**, and an admin turns a floor's apps on and off with a checkmark under **☰ › 🧩 Apps**: the Design canvas, the Image board, the Screening room, Reports, and Files, which is always on. Nothing is installed. A worker's window shows the floor's apps that are on: its role's own first (the interface below), then any other with something to show, Files last. A role whose own app a floor turned off opens on the next one that's on. The choice is kept in the floor's setup (`studio.json`, as `apps.off`); saving the floor setup keeps it as it is.

Each role opens with an interface made for what it hands back. Press **E** at the worker's desk: the chat window opens with the conversation on the left and the role's workspace beside it. The desk hint says which one you'll get.

| Interface | Role | What it is for |
| --- | --- | --- |
| **Screening room** | Video Editor | Watch each cut, leave notes at timestamps, send them back as a revision request, and approve the final version. |
| **Design board** | Designer | Watch designs take shape live on the [Canvas](design-canvas.md) and pin notes to their elements; compare images side by side and at YouTube size, pick one, or ask for variations. |
| **Reports** | Researcher | Read reports with their sources listed beside them, ask about them, and approve them. |
| **Files** | Any other role, and general agents | The conversation with the files the worker links or makes, as before. |

In the **Screening room**, the newest render the worker linked plays in a large 2D player that streams it from the Mac in byte ranges, so a 4K60 cut starts at once and seeks anywhere without loading whole. Its versions are listed together (v01, v02…, with each one's folder, size and time), from the links in the worker's messages and the files beside them. **Add note** pauses the cut and takes the time it stopped at; notes stay in time order, and clicking one jumps to just before it. **Send notes** asks the worker for a new version saved as a new file next to the old one, with the times and the file's full path. **Approve this cut** asks you to confirm first. A `chapters.txt` beside the render becomes chapters to jump to. If the browser can't play a file (ProRes, often HEVC or 10-bit), the window says so and offers to ask the worker for an H.264 review copy. Keys, while the workspace has focus: Space or K to play and pause, J and L to skip 5 seconds, N for a note, and F for Theater, which hides the conversation. Esc always closes the window.

The **Design board** shows the linked images as a grid; choose one to see it large, or two to four side by side. **At YouTube size** shows each the size a viewer meets it, on light and dark pages. **Pick this one** approves one image; **Ask for variations** sends one to four back with what to try. **Reports** renders a Markdown report with its pictures, opens links to other reports in place, and keeps web links external; its numbered **Sources** list has **Copy sources**. PDF and HTML stay in a sandboxed frame.

What you send from an interface is one message to the worker, written by the office with each file's full path, and it follows the same rule as typing in the chat: admins, or the worker's owner within their org-chart roles. Anyone else sees the interface read-only, with the reason under the conversation. An approval changes nothing: it tells the worker the file is final and not to publish, upload or send it anywhere without your explicit go-ahead, and the office never moves, renames or tags a file. What was sent shows on the file afterwards (**Approved**, **Picked**, **Notes sent · 3**). See [the workspace and reviews](worker-chat.md#the-workspace).

Admins choose a role's interface under **Interface** in **Manage specialists**; it is saved as `workspace` in the role's `profile.json`. The starter roles default to theirs, and a custom role without one opens Files. The desk hint knows only the starter roles, so it reads **Open chat** for a custom role even when its window opens another interface. Every role is told to link each deliverable as a Markdown link to its full path and to save each new version as a new file rather than overwrite one it already shared. A role saved before this keeps its old `AGENTS.md` until an admin saves it again; a review's message repeats the instruction meanwhile.

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
