/**
 * UI Helpers Module
 * Genel UI işlemleri ve yardımcı fonksiyonlar
 */

import { DOMElements } from './domElements.js';
import { URLS, UI } from './constants.js';

export class UIHelpers {
  constructor() {
    this.marqueeTargets = new Set();
    this.marqueeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
          entries.forEach(entry => {
            this.updateMarquee(entry.target);
          });
        })
      : null;
  }

  /**
   * Kontrolları devre dışı bırak
   */
  disableControls() {
    const buttons = [
      DOMElements.playButton,
      DOMElements.prevButton,
      DOMElements.nextButton,
      DOMElements.playlistPlayButton,
      DOMElements.volumeDownButton,
      DOMElements.volumeUpButton,
      DOMElements.resumePlaybackButton
    ];

    const inputs = [DOMElements.volumeSlider];

    buttons.forEach(btn => {
      if (btn) btn.disabled = true;
    });

    inputs.forEach(input => {
      if (input) input.disabled = true;
    });
  }

  /**
   * Kontrolları aktif hale getir
   */
  enableControls() {
    const buttons = [
      DOMElements.playButton,
      DOMElements.prevButton,
      DOMElements.nextButton,
      DOMElements.playlistPlayButton,
      DOMElements.volumeDownButton,
      DOMElements.volumeUpButton,
      DOMElements.resumePlaybackButton
    ];

    const inputs = [DOMElements.volumeSlider];

    buttons.forEach(btn => {
      if (btn) btn.disabled = false;
    });

    inputs.forEach(input => {
      if (input) input.disabled = false;
    });
  }

  /**
   * Giriş ekranını göster
   */
  showLogin() {
    if (DOMElements.loginContainer) {
      DOMElements.loginContainer.classList.remove('hidden');
    }
    if (DOMElements.playerContainer) {
      DOMElements.playerContainer.classList.add('hidden');
    }
  }

  /**
   * Oynatıcı ekranını göster
   */
  showPlayer() {
    if (DOMElements.loginContainer) {
      DOMElements.loginContainer.classList.add('hidden');
    }
    if (DOMElements.playerContainer) {
      DOMElements.playerContainer.classList.remove('hidden');
    }
  }

  /**
   * Süreyi MM:SS formatına çevir
   */
  formatDuration(durationMs) {
    if (!durationMs || typeof durationMs !== 'number') {
      return '0:00';
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  /**
   * Değeri min-max arasında sınırla
   */
  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /**
   * İlerleme çubuğunu güncelle
   */
  updateProgress(state) {
    if (!DOMElements.progressBar) return;

    if (!state || typeof state.duration !== 'number' || state.duration <= 0) {
      DOMElements.progressBar.style.width = '0%';
      return;
    }

    const position = Math.max(0, typeof state.position === 'number' ? state.position : 0);
    const percent = Math.min((position / state.duration) * 100, 100);
    DOMElements.progressBar.style.width = `${percent}%`;
  }

  /**
   * Oynatma butonunu güncelle
   */
  updatePlayButton(paused) {
    if (DOMElements.playButton) {
      DOMElements.playButton.textContent = paused ? 'PLAY' : 'PAUSE';
    }
  }

  /**
   * Şu an oynatılan track'i göster
   */
  updateNowPlaying(track, placeholderArt = URLS.PLACEHOLDER_ALBUM_ART) {
    if (DOMElements.trackNameEl) {
      DOMElements.trackNameEl.textContent = track.name || 'Unknown Track';
    }

    if (DOMElements.artistNameEl) {
      const artistNames = Array.isArray(track.artists)
        ? track.artists.map(artist => artist.name).filter(Boolean).join(', ')
        : 'Unknown Artist';
      DOMElements.artistNameEl.textContent = artistNames || 'Unknown Artist';
    }

    if (DOMElements.albumArtEl) {
      const artUrl = track.album?.images?.[0]?.url || placeholderArt;
      DOMElements.albumArtEl.src = artUrl;
    }
  }

  /**
   * Marquee hedefini işaretle
   */
  markMarqueeTarget(element) {
    if (!element) return;

    if (element.dataset.marqueeTarget === 'true') {
      requestAnimationFrame(() => {
        this.updateMarquee(element);
      });
      return;
    }

    element.dataset.marqueeTarget = 'true';
    this.marqueeTargets.add(element);

    if (this.marqueeObserver) {
      this.marqueeObserver.observe(element);
    }

    requestAnimationFrame(() => {
      this.updateMarquee(element);
    });
  }

  /**
   * Marquee animasyonunu güncelle
   */
  updateMarquee(element) {
    if (!element) return;

    if (!element.isConnected) {
      if (this.marqueeObserver) {
        this.marqueeObserver.unobserve(element);
      }
      this.marqueeTargets.delete(element);
      element.removeAttribute('data-marquee-target');
      return;
    }

    let text = element.textContent || '';

    const existingTrack = element.querySelector(':scope > .marquee-track');
    if (existingTrack) {
      const firstSegment = existingTrack.querySelector(':scope > .marquee-segment');
      text = firstSegment ? firstSegment.textContent || '' : existingTrack.textContent || '';
    }

    element.textContent = text;
    element.classList.remove('marquee');
    element.style.removeProperty('--marquee-distance');
    element.style.removeProperty('--marquee-duration');
    element.style.removeProperty('--marquee-gap');
    element.setAttribute('title', text);

    const containerWidth = element.clientWidth;

    if (!containerWidth || element.scrollWidth <= containerWidth + 1) {
      element.removeAttribute('aria-label');
      return;
    }

    element.textContent = '';
    const track = document.createElement('div');
    track.className = 'marquee-track';
    track.setAttribute('aria-hidden', 'true');

    const segment = document.createElement('span');
    segment.className = 'marquee-segment';
    segment.textContent = text;
    track.appendChild(segment);

    const clone = segment.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    track.appendChild(clone);

    element.appendChild(track);
    element.classList.add('marquee');
    element.setAttribute('aria-label', text);

    element.style.setProperty('--marquee-gap', `${UI.MARQUEE_GAP}px`);

    const contentWidth = segment.scrollWidth;
    if (!contentWidth) {
      element.classList.remove('marquee');
      element.textContent = text;
      element.removeAttribute('aria-label');
      return;
    }

    element.style.setProperty('--marquee-distance', `${contentWidth}px`);

    const duration = Math.min(
      Math.max(contentWidth / UI.MARQUEE_MIN_SPEED, UI.MARQUEE_MIN_DURATION),
      UI.MARQUEE_MAX_DURATION
    );
    element.style.setProperty('--marquee-duration', `${duration}s`);
  }

  /**
   * Container içindeki marquee hedeflerini kaldır
   */
  removeMarqueeTargetsWithin(container) {
    if (!container) return;

    this.marqueeTargets.forEach(target => {
      if (!target.isConnected || container.contains(target)) {
        if (this.marqueeObserver) {
          this.marqueeObserver.unobserve(target);
        }
        target.removeAttribute('data-marquee-target');
        this.marqueeTargets.delete(target);
      }
    });
  }

  /**
   * Temizle
   */
  destroy() {
    if (this.marqueeObserver) {
      this.marqueeObserver.disconnect();
    }
    this.marqueeTargets.clear();
  }
}

export default UIHelpers;
