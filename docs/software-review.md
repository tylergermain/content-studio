# Software review

Back to the [README](../README.md).

The **Review** tab is where you try what a developer or a website designer built, the way a reviewer does in Frame.io. Every worker's window has it, and the app shows in it as soon as the worker is running a web server on the office's machine (or its project room has an app): live and usable, at a desktop, laptop, tablet or phone size. Click **💬 Comment** (or press **C**) and a click on the page pins a comment to the element under it instead of using it. Write what should change, add as many as you like across its pages, and **Send** them to the worker as one request.

It's one of the apps a floor turns on in **Menu → Apps** (🧪 Software review).

## Using it

- **Nothing running yet.** The tab says so, with **Ask … to run it**, which puts a request in the message box for you to send. A site the worker published somewhere else (a `chatgpt.site` link, a Vercel preview) doesn't show here: it needs the app running on this machine.
- **The app.** The menu at the left picks which of the worker's servers to review, when it runs more than one. The address bar follows the page as you click about, and takes a path to go to. ← and ⟳ go back and reload. ↗ opens it in a tab of its own.
- **Sizes.** Desktop (1440×900), Laptop (1280×800), Tablet (820×1180) and Phone (390×844) show the app at that size, scaled down to fit. **Fit** gives it all the room there is.
- **Comments.** In comment mode the element under the pointer is outlined, and a click opens a box for the comment. Each one is pinned with its number on the page, and listed under the app. Click a comment's number to go back to its page; ✕ takes it out.
- **Sending.** The request names the app, the size you saw it at, and for each comment its page, the element (a button and what it says, a heading, a picture) and a CSS selector that finds it:

  ```text
  Review comments on the running app at http://localhost:5173 (seen at Phone, 390x844):

  1. On /pricing, the button “Buy” (`#buy`): Make it our brand yellow
  2. On /, the heading “Acme Dashboard” (`body > main > h1`): Too tight on a phone
  ```

  The worker fixes them with its server still running, so the changes show up in the same tab as the app reloads.

## Where it works

The app comes through the office's relay to the worker's server, which adds a small script to its pages while they're framed here (and nothing else). That's what turns a click into a pin. So comments work when the office is open:

- **on its tailnet address** (`https://<office>.ts.net`): the app is at `https://<office>.ts.net:<port>`, which the office has Tailscale Serve point at itself, or
- **on its own machine** (`http://localhost:4600`): the app is at `http://p<port>.localhost:4600`, the office's own port, so nothing else needs to be open.

Anywhere else (an office on a domain of its own, with [service tunnels](tunnel.md)) the Review tab still shows the app at every size, as it is, without comments. A project room's app that's deployed somewhere else shows as it is too.

The app is only reached by someone signed in to the office, as with any worker's server. The script only answers the office it was started from (its tailnet name or the machine itself) and only messages from it.

## On a Mac on your tailnet

`deploy/provision.sh --tailscale` sets up the `agent-office-serve` helper on Linux. On a Mac with the Tailscale app, `deploy/agent-office-serve-macos.sh` does the same job without root:

```bash
cp deploy/agent-office-serve-macos.sh ~/.local/bin/agent-office-serve
```

Then give the office these two (in its LaunchAgent's `EnvironmentVariables`, or the shell it runs in):

```bash
export AGENT_OFFICE_TAILSCALE_HOST=your-mac.your-tailnet.ts.net
export AGENT_OFFICE_SERVE_HELPER="$HOME/.local/bin/agent-office-serve"
```

It only ever adds and removes the ports it added itself (kept in `~/.agent-office-serve-ports`), and never takes over a port Tailscale Serve already serves, so whatever else the Mac serves on the tailnet stays as it is. `AGENT_OFFICE_URL` is where it points them (`http://127.0.0.1:4600` by default).
