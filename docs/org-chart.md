# Org chart and employee hiring

Open **Org chart** in the office menu. Admins can add team positions, give them names, choose who they report to, and attach a saved specialist role to a position. Each specialist role occupies one position. Create new specialist profiles in the hire dialog before placing them in the chart.

Assign each human employee's member account to their position, then place the specialist agents they may hire underneath it. Save the chart to apply changes immediately. For example:

```
Studio Owner
  Content Producer (Alex's member account)
    Video Editor
      Researcher
  Designer
```

Alex can hire Video Editor and Researcher, including the indirect report. Alex cannot hire Designer, a general worker, or a shell. A person cannot hire a specialist at their own position, their manager's position, or another branch. Unassigned member accounts cannot hire agents. Admin accounts remain unrestricted and control chart editing.

The restriction is for human employees. AI agents do not have independent hierarchy-based hiring permissions. Delegation through `office-workers` or the native office MCP server inherits the human account that hired the requesting agent. An employee's AI agent can hire any specialist below that human's position, even if it is not below the requesting AI role itself. The CLI supports `office-workers hire --specialist researcher --prompt "Research this topic"`; specialist hires use their main-floor folder rather than a git worktree.

Employees can send messages, resume, upload to, and control only permitted specialists hired on their own account. This prevents an employee from asking an administrator's unrestricted agent to hire on their behalf. They can still view the shared floor. Files a worker links in a folder an admin shared with the floor are narrower: admins can open them, the worker's owner can within their roles, and for a worker hired on no account (through the shared password or automation), so can employees allowed to hire its role. Everyone else sees those links as plain text. See [sharing a folder with the floor](worker-chat.md#sharing-a-folder-with-the-floor). General-agent task queue creation, board agents, and meetings are admin-only. The central worker start policy also blocks automatic general-agent hires owned by member accounts, including previously queued tasks. An old employee session outside the current chart cannot be resumed, but saving a chart does not automatically kill already-running workers.

The chart lives in the floor's private `.agent-office/org-chart.json`, with atomic saves and file mode 600. It survives office restarts. Invalid or cyclic charts are rejected, unknown roles cannot be granted, and damaged configuration blocks employee hiring until an admin repairs it. Each floor has its own chart.

## Employee accounts and the computer boundary

Which floors a member works on comes first: on a floor they're read-only on (see [Add users](../README.md#add-users), *Which floors they work on*), they direct no worker, hire nobody and change nothing, whatever the org chart allows them; they can still read a worker's chat, files and review there when the org chart lets them. On the floors they work on, the rules below apply as ever.

Create **member** accounts under **Accounts**, then assign those accounts in the org chart. Employee restrictions require individual accounts. The shared office password grants administrator access, so do not give it to employees. After an owner has a working named admin account, disable shared-password access under Accounts. Existing owner access is not changed automatically.

This policy governs managed Content Studio workers, its API, and its agent delegation tools. Current workers still run on the shared Mac with bypass permissions. These controls do not prevent a process from launching raw CLI agents or editing host files outside the app. Enforcing a computer-level restriction requires isolated worker users, containers, or VMs in the sandbox phase.
