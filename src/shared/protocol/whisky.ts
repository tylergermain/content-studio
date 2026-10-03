// The whisky cabinet (see shared/whisky.ts): pouring a dram, holding it, and clinking glasses. Who's
// holding one on a floor is the office's, so whoever arrives sees the glasses in people's hands
// (FloorView.whisky); how full each glass is, is only its holder's.

export type WhiskyClientMsg =
  /** You poured yourself a dram at the cabinet that's piece `piece` of your floor (or topped yours up): you're in reach of it. */
  | { t: 'whisky.pour'; piece: string }
  /** Your glass is empty (or you put it back): it goes back on the tray. */
  | { t: 'whisky.down' }
  /** You raised your glass: everyone near enough with one of their own clinks theirs with it. */
  | { t: 'whisky.cheers' };

export type WhiskyServerMsg =
  /** `id` poured a dram at piece `piece` (`top`: into the glass they already had), to everyone on the floor. */
  | { t: 'whisky.poured'; id: string; piece: string; top?: boolean }
  /** `id`'s glass went back on the tray: they drank it, or left the floor. */
  | { t: 'whisky.down'; id: string }
  /** Glasses clinked: `ids` (whoever raised theirs first, then the others) and `names` the same people's, where the first stood. */
  | { t: 'whisky.cheers'; ids: string[]; names: string[]; x: number; y: number; z: number };
