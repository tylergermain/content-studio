// The pieces ⚙️ Settings' rows are made of (see settings.ts).

import { h } from './dom';
import type { SettingsPane } from './settings';

/** Who a setting is for, shown by its name: some are yours alone, some the whole office's. */
export type Scope = 'you' | 'floor' | 'office';

/**
 * A setting a feature adds to ⚙️ Settings by itself (the webcam's): the pane it's in, its name and who
 * it's for, and `make`, which makes its rows each time Settings opens and says what to let go of when
 * it closes. It goes after the pane's own settings.
 */
export interface AddedSetting {
  pane: SettingsPane;
  title: string;
  scope: Scope;
  make(): { body: Node[]; close?: () => void };
}

const added: AddedSetting[] = [];

/** Adds a setting to ⚙️ Settings, from the next time it opens. Hands back what takes it out again. */
export function addSetting(s: AddedSetting): () => void {
  added.push(s);
  return () => void (added.includes(s) && added.splice(added.indexOf(s), 1));
}

/** The settings features have added, in the order they were. */
export const addedSettings = (): readonly AddedSetting[] => added;

/** A row of buttons to pick one of `options` from. `get` says which is picked now, and `set` picks another. */
export function choiceRow<T>(label: string, options: readonly (readonly [value: T, label: string])[], get: () => T, set: (value: T) => void): HTMLElement {
  const row = h('div.seg', { role: 'radiogroup', 'aria-label': label });
  const paint = () =>
    row.replaceChildren(
      ...options.map(([value, text]) =>
        h(
          'button.btn',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(get() === value),
            class: get() === value ? 'on' : '',
            onclick: () => {
              if (get() === value) return;
              set(value);
              paint();
            },
          },
          text,
        ),
      ),
    );
  paint();
  return row;
}
