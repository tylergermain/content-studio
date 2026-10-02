# Worker chat and live voice

Open an agent worker to see its conversation, current activity, and recent workspace files. Send messages with the button or Command/Ctrl+Enter. They enter the same Codex, Claude Code, or local Pi session. Opening an offline worker does not restart it; sending a message resumes its session. Interrupt work sends the provider’s Escape key. The Terminal button opens the underlying CLI for login, menus, and advanced controls. Shell workers and terminal search results retain the terminal view.

The panel reads public user and assistant messages from the worker’s own session log. It omits private reasoning and tool arguments. Session logs are provider-specific and can change format, so an unreadable or not-yet-created log leaves the panel waiting while activity and submitted messages remain available. Context history is bounded to the most recent messages.

The preview area lists recent supported files in the worker’s workspace, including images, video, audio, Markdown, text, PDF, and HTML. Video supports range requests. HTML is sandboxed with scripts and external network access disabled. Files outside the workspace, hidden configuration, authentication files, and escaping symlinks cannot be previewed. Directory scans are bounded. Relative Markdown images can use the same authenticated preview endpoint.

## GPT-Live 1

Click Talk live to start a full duplex GPT-Live 1 conversation. An admin can enter an OpenAI project API key in the panel’s setup form. The server stores it as `.agent-office/gpt-live.json` with permissions 0600, or uses OPENAI_API_KEY from its environment. The key is never returned to browsers or committed to Git. The OpenAI project must have GPT-Live access and API billing enabled. Voice uses OpenAI even when the worker itself is local Pi; backend CLI authentication stays unchanged.

GPT-Live uses client delegation. The browser retains voice transcripts and submits a delegated instruction to the selected worker’s existing session. Worker status, recent conversation, and public replies are fed back to the voice session as context; new replies are communicated back during the call. It does not access hidden reasoning or automatically capture the computer screen. An explicit short spoken stop/pause request sends an interrupt. Other corrections are sent as follow-up messages, and their scheduling is controlled by the underlying CLI. The application does not treat a delivered instruction as completed work.

Microphone access requires HTTPS or localhost. The existing localhost SSH tunnel works. Use End live voice or close the panel to stop the microphone and close the voice session. Voice is billed by session duration; CLI or local model usage remains separate. Closing voice does not kill the worker. Changing floors closes the panel and voice connection.

## Verification limits

Automated tests cover session parsing, private-content exclusion, workspace boundaries, key storage, same-origin checks, duplicate submissions, and the GPT-Live session request schema using a mocked API. A real microphone and GPT-Live project key are required to verify the end-to-end voice call. API access errors appear in the panel instead of silently selecting another model.

If voice stays at the microphone permission step, allow microphone access in the browser. After 20 seconds, an unresolved permission request shows a clear error and stops the connection attempt. If the in-app browser cannot show the permission prompt, open the same Content Studio URL in Chrome.
