// Main Street's businesses (see shared/mainstreet.ts): who has claimed which plot, and what stands on
// it while they have no floors yet, a building site or the shell of their tower. The office keeps them
// in its data folder's street.json, whose shape (StreetFile) is final: a plot claimed now becomes that
// business's own building later, with nothing to move. Street admins claim, change and release plots;
// everyone is sent each business's public card (BusinessCard), and nothing else of it.

import type { Claimable } from '../mainstreet.js';

/** What a business's building is clad in: presets for the toon look, rather than a free color. */
export type BusinessSkin = 'glass' | 'brick' | 'graphite' | 'timber';
export const BUSINESS_SKINS: readonly BusinessSkin[] = ['glass', 'brick', 'graphite', 'timber'];

/** What stands on a claimed plot while the business has no floors: a building site (a hoarding and a tower crane), or the shell of its tower. */
export type BusinessStage = 'site' | 'shell';
export const BUSINESS_STAGES: readonly BusinessStage[] = ['site', 'shell'];

/** Where a business's office runs: on this office's machine, or an office of its own elsewhere (later rounds). */
export type BusinessHome = 'hosted' | 'linked';

/** A business's id: lowercase letters, digits and dashes, never the host's. Its floors will be `<id>.<floor>`. */
export const BUSINESS_ID = /^[a-z0-9-]{2,20}$/;
/** The host business: Friday Labs, which owns Friday Tower, the park, Putt Street and the street. Never a BusinessDef. */
export const HOST_BUSINESS = 'friday-labs';
/** The limits on a business, and what it gets unless a street admin says otherwise. */
export const BUSINESS_LIMITS = { name: 32, storeys: 8, floors: 8, defaultFloors: 4, defaultWorkers: 3 } as const;

/** One storey of a business's building as everyone sees it from outside: its name and color. */
export interface StoreyCard {
  name: string;
  /** '#rrggbb'. */
  accent: string;
}

/** A business on Main Street, as street.json keeps it. */
export interface BusinessDef {
  /** See BUSINESS_ID. */
  id: string;
  /** Up to BUSINESS_LIMITS.name characters. */
  name: string;
  plot: Claimable;
  /** Its color: '#rrggbb'. */
  accent: string;
  skin: BusinessSkin;
  /** Shown while it has no floors. */
  stage: BusinessStage;
  /** How many storeys its shell stands, 1..BUSINESS_LIMITS.storeys. */
  planned: number;
  home: BusinessHome;
  /** A linked business's office (https), once there are linked businesses. */
  url?: string;
  /** A linked business's public card, as its office last said. */
  card?: { storeys: StoreyCard[] };
  /** Who said its AI workers may run on this machine, and when (ms since 1970). None: they may not. */
  trusted?: { by: string; at: number };
  /** How many floors it may have (default BUSINESS_LIMITS.defaultFloors, at most BUSINESS_LIMITS.floors). */
  maxFloors: number;
  /** How many AI workers it may have at once (default BUSINESS_LIMITS.defaultWorkers). */
  maxWorkers: number;
  /** Most it may spend a day on AI, in USD. */
  budget?: number;
  /** The street admin who claimed the plot (their name), and when (ms since 1970). */
  by: string;
  at: number;
}

/** street.json. A missing file is no businesses; one that won't read is logged and treated as none too. */
export interface StreetFile {
  version: 1;
  businesses: BusinessDef[];
}

/**
 * A business as everyone sees it from the street: no quotas, trust or addresses. A shell's storeys
 * are its planned count, each in its accent; a site has none built yet but says how many are planned.
 */
export interface BusinessCard {
  id: string;
  name: string;
  plot: Claimable;
  accent: string;
  skin: BusinessSkin;
  stage: BusinessStage;
  home: BusinessHome;
  storeys: StoreyCard[];
}

/** Main Street as everyone is sent it: the businesses on it (a plot with no card is for lease). */
export interface StreetView {
  cards: BusinessCard[];
}

/** What a street admin sets when claiming a plot or changing what stands on it. */
export interface PlotLook {
  name: string;
  accent: string;
  skin: BusinessSkin;
  stage: BusinessStage;
  /** Storeys, 1..BUSINESS_LIMITS.storeys. */
  planned: number;
}

export type StreetClientMsg =
  /**
   * Claim a plot that's for lease for a business (street admins only): it shows as a building site or
   * a shell straight away, for everyone. The office makes the business's id from its name. Refused
   * over the parked helicopter, or while anyone stands where its walls would go.
   */
  | ({ t: 'street.claim'; plot: Claimable } & PlotLook)
  /**
   * Change a claimed plot's business: its name, colors, site or shell, storeys (street admins only).
   * `id`, when it's given, is the business the window was showing: refused if the plot has changed
   * hands since, so a window left open can't change the business that came after.
   */
  | ({ t: 'street.edit'; plot: Claimable; id?: string } & Partial<PlotLook>)
  /** Give a claimed plot back: it's for lease again (street admins only). `id`, as for an edit. */
  | { t: 'street.release'; plot: Claimable; id?: string };

export type StreetServerMsg =
  /** Main Street changed: to everyone, on every floor and the roof. */
  { t: 'street'; street: StreetView };
