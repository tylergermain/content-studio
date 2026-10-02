# Spotify jukebox

Admins can connect one Spotify account for the office and control its Spotify Connect devices from the jukebox. Spotify audio plays on the chosen device, rather than being broadcast to other office browsers. Premium is required for playback controls.

Create a Spotify developer app with Web API enabled. Register the exact callback URL shown by the jukebox, for example `http://127.0.0.1:14600/api/spotify/callback` for the Mac Studio tunnel. Spotify requires explicit loopback IP addresses for HTTP callbacks. Enter the app Client ID in the jukebox, then connect Spotify and approve playback access. No Client Secret is required because authorization uses PKCE.

Open Spotify on the device where you want music. Refresh the jukebox, choose the device, and use Resume, Pause, Previous, Next, or paste a Spotify playlist, album, or track link. The original office tunes and stream controls remain available.

OAuth scopes allow reading playback state and account profile, plus controlling playback. Tokens stay in `spotify.json` in the server data directory with owner-only permissions and are never returned to the browser or committed. Disconnect removes saved tokens; revoke the app from your Spotify account to withdraw Spotify authorization completely. Only office admins can connect, inspect, or control this account.
