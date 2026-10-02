/**
 * The window a video screen opens: what's on it, with its sound and the browser's own controls.
 */
import './ui.css';
import { h, openModal, type Modal } from '../../ui/dom';
import { mediaUrl, type MediaFile } from './playlist';

export interface Watching {
  floor: string;
  file: MediaFile;
  /** How far into it the screen on the floor is, in seconds: the window picks up from there. */
  at: number;
  /** The picture's own size, when the screen knows it: the window's cut to its shape before it has loaded. */
  size: { w: number; h: number } | null;
}

/** Opens `file` in a window. Closing it (its ✕, or Esc) stops the sound and puts you back in the office. */
export function openScreenWindow({ floor, file, at, size }: Watching): Modal {
  const src = mediaUrl(floor, file.name, file.size);
  const video = file.kind === 'video' ? (h('video', { src, controls: true, autoplay: true, loop: true, playsinline: true, preload: 'auto' }) as HTMLVideoElement) : null;
  const media = video ?? h('img', { src, alt: file.name });
  if (size) media.style.setProperty('--shape', String(size.w / size.h));
  if (video) {
    video.addEventListener(
      'loadedmetadata',
      () => {
        media.style.setProperty('--shape', String(video.videoWidth / video.videoHeight || 16 / 9));
        if (at > 0 && Number.isFinite(video.duration) && at < video.duration - 0.5) video.currentTime = at;
      },
      { once: true },
    );
  } else media.addEventListener('load', () => media.style.setProperty('--shape', String((media as HTMLImageElement).naturalWidth / (media as HTMLImageElement).naturalHeight || 16 / 9)), { once: true });
  const el = h('div.modal.screen-window', { role: 'dialog', 'aria-label': file.name }, h('header', {}, h('h2', {}, `📺 ${file.name}`)), h('div.screen-stage', {}, media));
  return openModal(el, {
    doing: `📺 watching ${file.name}`,
    onClose: () => {
      if (!video) return;
      // Let go of it, so its sound stops and nothing's fetched for a window that's gone.
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
  });
}
