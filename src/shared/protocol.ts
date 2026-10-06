// Wire protocol between browser and server. Every WebSocket frame is one JSON object.
//
// Each part of the office keeps its state types and its messages in ./protocol/<domain>.ts; this
// file puts them back together, so everything is still imported from here, and makes the two
// unions every frame is one of.

import type { AccountsClientMsg, AccountsServerMsg, SignInsClientMsg, TeamClientMsg } from './protocol/accounts.js';
import type { ChangesClientMsg, ChangesServerMsg } from './protocol/changes.js';
import type { FloorClientMsg, FloorServerMsg, PlanClientMsg } from './protocol/floors.js';
import type { GitHubClientMsg, GitHubServerMsg } from './protocol/github.js';
import type { GoatClientMsg, GoatServerMsg } from './protocol/goat.js';
import type { HeliClientMsg, HeliServerMsg } from './protocol/heli.js';
import type { HoopClientMsg, HoopServerMsg } from './protocol/hoop.js';
import type { MeetingClientMsg, MeetingServerMsg } from './protocol/meetings.js';
import type { PuttClientMsg, PuttServerMsg } from './protocol/minigolf.js';
import type { PresenceClientMsg, PresenceServerMsg } from './protocol/presence.js';
import type { QueueClientMsg, QueueServerMsg } from './protocol/queue.js';
import type { RooftopClientMsg, RooftopServerMsg } from './protocol/rooftop.js';
import type { SettingsClientMsg, SettingsServerMsg } from './protocol/settings.js';
import type { StreetClientMsg, StreetServerMsg } from './protocol/street.js';
import type { StudioClientMsg, StudioServerMsg } from './protocol/studio.js';
import type { BallClientMsg, CabinetClientMsg, CarClientMsg, DecorClientMsg, DogClientMsg, JukeboxClientMsg, ToysServerMsg, WhiteboardClientMsg } from './protocol/toys.js';
import type { UsageClientMsg, UsageServerMsg } from './protocol/usage.js';
import type { FridayProxyClientMsg, FridayProxyServerMsg } from './protocol/friday-proxy.js';
import type { VrClientMsg, VrServerMsg } from './protocol/vr.js';
import type { WatchServerMsg } from './protocol/watch.js';
import type { WebcamClientMsg } from './protocol/webcam.js';
import type { WhiskyClientMsg, WhiskyServerMsg } from './protocol/whisky.js';
import type { WorkerClientMsg, WorkerServerMsg } from './protocol/workers.js';

export * from './protocol/accounts.js';
export * from './protocol/agents.js';
export * from './protocol/changes.js';
export * from './protocol/floors.js';
export * from './protocol/github.js';
export * from './protocol/goat.js';
export * from './protocol/heli.js';
export * from './protocol/hoop.js';
export * from './protocol/meetings.js';
export * from './protocol/minigolf.js';
export * from './protocol/presence.js';
export * from './protocol/queue.js';
export * from './protocol/rooftop.js';
export * from './protocol/settings.js';
export * from './protocol/street.js';
export * from './protocol/studio.js';
export * from './protocol/toys.js';
export * from './protocol/usage.js';
export * from './protocol/friday-proxy.js';
export * from './protocol/vr.js';
export * from './protocol/watch.js';
export * from './protocol/webcam.js';
export * from './protocol/whisky.js';
export * from './protocol/workers.js';

export type ClientMsg =
  | PresenceClientMsg
  | RooftopClientMsg
  | WorkerClientMsg
  | GitHubClientMsg
  | QueueClientMsg
  | MeetingClientMsg
  | FloorClientMsg
  | PlanClientMsg
  | ChangesClientMsg
  | TeamClientMsg
  | AccountsClientMsg
  | SignInsClientMsg
  | SettingsClientMsg
  | UsageClientMsg
  | FridayProxyClientMsg
  | VrClientMsg
  | DecorClientMsg
  | JukeboxClientMsg
  | CabinetClientMsg
  | WhiteboardClientMsg
  | BallClientMsg
  | CarClientMsg
  | DogClientMsg
  | GoatClientMsg
  | StreetClientMsg
  | PuttClientMsg
  | HeliClientMsg
  | StudioClientMsg
  | HoopClientMsg
  | WhiskyClientMsg
  | WebcamClientMsg;

export type ServerMsg =
  | PresenceServerMsg
  | RooftopServerMsg
  | WorkerServerMsg
  | GitHubServerMsg
  | QueueServerMsg
  | MeetingServerMsg
  | FloorServerMsg
  | ChangesServerMsg
  | AccountsServerMsg
  | SettingsServerMsg
  | UsageServerMsg
  | FridayProxyServerMsg
  | VrServerMsg
  | ToysServerMsg
  | GoatServerMsg
  | StreetServerMsg
  | PuttServerMsg
  | HeliServerMsg
  | StudioServerMsg
  | WatchServerMsg
  | HoopServerMsg
  | WhiskyServerMsg;
