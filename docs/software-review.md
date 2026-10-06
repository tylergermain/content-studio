# Software review

Back to the [README](../README.md).

Software review is where you try what a developer or a website designer built, and tell them what to change, the way a reviewer does in Frame.io. Every worker's window has a **Review** tab. Click it and the **review room** opens full screen: the app the worker is running, live and usable, on a dark stage at a desktop, laptop, tablet or phone size, with every comment down the right. Press **C** and a click on the app pins a comment to the element under it instead of using it. Send the comments to the worker as one round, mark each one done once it's fixed, and **Approve** the app when it's right.

It's one of the apps a floor turns on in **☰ › 🧩 Apps** (🧪 Software review).

## The review room

- **The top bar.** ✕ (or Esc) closes it. Then come the app's name and the worker's, the page you're on, which follows you as you click about and takes a path to go to (← and ⟳ go back and reload), and the sizes: Desktop (1440×900), Laptop (1280×800), Tablet (820×1180), Phone (390×844) and Fit (all the room there is), on keys **1** to **5**. On the right: where the review stands (**Needs review**, **Changes requested** or **Approved**), **Approve**, and ↗ to open the app in a tab of its own. The menu by the name picks the app when the worker runs more than one.
- **Use app / Comment.** Under the app. In **Use app** it's the app, as it is. In **Comment** (**C**, from anywhere, the app included) the element under the pointer is outlined, and a click pins the next comment to it rather than using it.
- **Writing a comment.** The box at the bottom right. It says what the comment is pinned to (✕ unpins it, for a comment about the page as a whole, which is what it's about with nothing clicked). **Enter** adds it and **Shift+Enter** starts a new line. A comment added isn't sent yet: it's numbered, pinned in the app in outline, and listed under **Not sent yet**, kept in this browser until it's sent, so closing the room loses nothing.
- **Sending.** **Send N comments to ‹worker›** sends the ones on this app as one round. The request names the app, the size you saw it at, and for each comment its number, page, element (a button and what it says, a heading, a picture) and a CSS selector that finds it:

  ```text
  Review comments on the running app at http://localhost:5173 (seen at Phone, 390x844):

  1. On /pricing, the button “Buy” (`#buy`): Make it our brand yellow
  2. On /, the page as a whole: Too cramped on a phone
  ```

  The worker fixes them with its server still running, so the changes show up in the room as the app reloads, and answers by the same numbers.
- **The comments.** Down the right, the ones not sent yet first, then each round, newest first, with who wrote each one and when. **Open**, **Done** and **All** choose which show, in the list and as pins in the app. Hover over one to outline its element, and click it to go to its page and scroll to it. The ○ marks one done once it's fixed (✓), and again to reopen it.
- **Approve.** Tells the worker the app is good as it is, and the review shows **Approved** until the next round is sent. Click it again to take it back. It waits while there are comments not sent yet.

The rounds, the comments and the approval are kept on the floor (`.agent-office/software-review/<worker>.json`), so everyone who can direct the worker sees the same review, and it's there next time. The Review tab itself says where the review stands and how many comments are open, with **Open review** to go back in. With nothing running yet it says so, with **Ask ‹worker› to run it**, which puts that request in the message box for you to send. A site the worker published somewhere else (a `chatgpt.site` link, a Vercel preview) doesn't show here: it needs the app running on the office's machine.

## Where it works

The app comes through the office's relay to the worker's server, which adds a small script to its pages while they're framed by the room (and nothing else). That's what turns a click into a pin. So pinning works when the office is open:

- **on its tailnet address** (`https://<office>.ts.net`): the app is at `https://<office>.ts.net:<port>`, which the office has Tailscale Serve point at itself, behind the office's sign-in, or
- **on its own machine** (`http://localhost:4600`): the app is at `http://p<port>.localhost:4600`, the office's own port. A browser on the machine itself reaches it there with no sign-in, as it reaches `localhost:<port>` straight. A request that came through any proxy (Tailscale Serve included) still signs in.

Anywhere else (an office on a domain of its own, with [service tunnels](tunnel.md)) the room still shows the app at every size, as it is, and comments are about each page as a whole. So does a project room's app deployed somewhere else.

The script only answers the office that framed it (its tailnet name or the machine itself) and only messages from it.

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
