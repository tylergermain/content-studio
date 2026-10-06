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

Each tab is an **app**, and an admin turns a floor's apps on and off with a checkmark under **☰ › 🧩 Apps**: the Design canvas, Software review, the Image board, the Screening room, Reports, and Files, which is always on. Nothing is installed. A worker's window shows every app the floor has on as a tab: its role's own first (the interface below), then the others, Files last. A tab with nothing in it yet is dimmed, and says how it fills. Software review opens full screen as its tab is clicked (see [Software review](software-review.md)). A role whose own app a floor turned off opens on the next one that's on. The choice is kept in the floor's setup (`studio.json`, as `apps.off`); saving the floor setup keeps it as it is.

Each role opens with an interface made for what it hands back. Press **E** at the worker's desk: the chat window opens with the conversation on the left and the role's workspace beside it. The desk hint says which one you'll get.

| Interface | Role | What it is for |
| --- | --- | --- |
| **Screening room** | Video Editor | Watch each cut full screen, leave notes at their moments, send them back as a revision request, check each off once it's fixed, and approve the final version. |
| **Design board** | Designer | Watch designs take shape live on the [Canvas](design-canvas.md) and pin notes to their elements; compare images side by side and at YouTube size, pick one, or ask for variations. |
| **Reports** | Researcher | Read reports with their sources listed beside them, ask about them, and approve them. |
| **Files** | Any other role, and general agents | The conversation with the files the worker links or makes, as before. |

The **Screening room** opens full screen when its **Watch** tab is clicked, or a render is opened from a link in the chat, the way Frame.io reviews a cut: the cut on a dark stage, the notes down the right, and along the top which version it is, where its review stands (**Needs review**, **Changes requested**, **Approved**) and **Approve**. The tab itself lists every cut, with **Open screening room**.

- **The player** streams the render from the Mac in byte ranges, so a 4K60 cut starts at once and seeks anywhere without loading whole. Under it, the timeline marks the notes (yours not sent yet, sent, done) and chapters; drag along it to scrub, and click a mark to go to its note. Then play, 5 seconds back or on, a frame back or on, the time to a tenth, the speed (0.5× to 2×) and the sound.
- **Versions.** The menu by the name holds every cut (v01, v02…, the worker's first, then the floor's), and **v03 is newer · Watch it** says when there's a newer one in the series.
- **Notes.** **N** (or clicking the box) takes the moment the cut is at and holds the cut while you write; **Enter** adds the note, and the cut plays on if it was playing. The ⏱ chip turns the note into one about the whole cut. Notes not sent yet stay in this browser for that worker and cut. **Send N notes** asks the worker for a new version saved as a new file next to the old one, with the times and the file's full path.
- **What was sent** is listed under the notes, on this cut and on the versions before it (watching v02 shows what was asked of v01, with **check them in v02**). Click a card to go to its moment, or its time to play from just before it. The ○ marks a note done once it's fixed, for everyone on the floor (`.agent-office/review-marks/<worker>.json`); **Open**, **Done** and **All** choose which show. A `chapters.txt` beside the render, or in the folder above, fills the **Chapters** tab.
- **Approve** asks for a second click, then tells the worker the cut is final.
- **Keys.** Space or K plays and pauses, J and L skip 5 seconds, ← and → step a frame (with Shift, a second), N writes a note, M mutes, F hides the notes, and Esc steps back out: the note being written, then the room.

If the browser can't play a file (ProRes, often HEVC or 10-bit), the room says so and offers to ask the worker for an H.264 review copy.

The **Board**, **Read**, **Canvas** and **Files** tabs open full screen too, like the screening room, with the comments down the right (Open / Done / All, a check to mark one done, the ones not sent yet first) and the review's status and **Approve** along the top:

- **The image board** shows the image as big as the room allows (click it for its actual pixels), every image along a filmstrip under it (← and → step through them), two to four side by side (⌘-click them in the strip, lettered A to D), or each at the size YouTube shows it (**Y**), on its light and dark pages. **C** turns on comment mode: a click on the image pins the next comment to that point, sent as “On the point 30% across and 40% down: …”. **Approve** picks it; **Ask for variations** sends the image, or the ones side by side, back with what to try.
- **Reports** shows the page as a sheet of paper on the dark stage, with its contents and numbered **Sources** (**Copy sources**) beside it. Select any passage and **Comment** pins the next comment to it, sent as “On the passage “…”: …”, and the passages commented on are marked on the page. **Question** over the box asks the worker about the report instead. It opens links to other reports in place and keeps web links external; PDF and HTML stay in a sandboxed frame.

- **The design canvas** shows the design on the dark stage, live as the designer saves, with its own bar (zoom, **Export PNGs**, **Import from Paper**). A click on any element pins the next comment to it, as a numbered pin on the design; **Approve** tells the designer it's final. See [Design canvas](design-canvas.md).
- **Files** shows everything the worker made or linked as a grid, its own first and then the floor's, with **Video**, **Images**, **Docs**, **Designs** and **Other** along the top and a search (/). The one chosen previews down the right; double-click it, press Enter, or **Open in …** to take it to its own room (a cut to the screening room, a picture to the image board, a document to Reports, a design to the canvas), and Esc comes back to the grid.

Comments not sent yet stay in this browser for that worker and file; a comment with nothing picked is about the whole image, document or design.

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
