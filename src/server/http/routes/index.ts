import { spotifyRoutes } from './spotify.js';
// Every HTTP route the office answers, in the order they're tried: a new route goes where it has to
// come in that order (see http/router.ts). The public ones are tried first, then the sign-in check,
// then the rest; the last one answers every path left with the client bundle, or a 404.
import { orgChartRoute } from './org-chart.js';
import { specialistRoute } from './specialists.js';
import { workerChatRoutes } from './worker-chat.js';
import { sharesRoute } from './shares.js';
import type { Route } from '../router.js';
import { agentRoutes } from './agents.js';
import { authRoutes } from './auth.js';
import { fileRoutes } from './files.js';
import { githubRoutes } from './github.js';
import { pageRoutes } from './pages.js';
import { searchRoutes } from './search.js';
import { serviceRoutes } from './services.js';

export const routes: readonly Route[] = [
  // Anyone.
  spotifyRoutes.callback,
  authRoutes.login,
  authRoutes.loginOptions,
  authRoutes.join,
  authRoutes.claimable,
  authRoutes.claim,
  authRoutes.link,
  authRoutes.logout,
  pageRoutes.health,
  pageRoutes.assets,
  pageRoutes.login,
  pageRoutes.claim,
  pageRoutes.join,
  pageRoutes.favicon,
  // Signed in.
  spotifyRoutes.account,
  authRoutes.whoami,
  agentRoutes.models,
  workerChatRoutes.chat,
  sharesRoute,
  specialistRoute,
  orgChartRoute,
  fileRoutes.image,
  fileRoutes.media,
  fileRoutes.whiteboardFile,
  fileRoutes.termDrop,
  fileRoutes.changedFile,
  fileRoutes.docs,
  searchRoutes.search,
  serviceRoutes.forwards,
  githubRoutes.github,
  pageRoutes.office,
  pageRoutes.lite,
  pageRoutes.bundle,
];
