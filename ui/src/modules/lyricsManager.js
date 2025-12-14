/**
 * Lyrics Manager Module
 */

import { URLS } from './constants.js';
import { DOMElements } from './domElements.js';

export class LyricsManager {
    constructor(uiHelpers, onSeek) {
        this.uiHelpers = uiHelpers;
        this.onSeek = onSeek;
        this.isLyricsMode = false;
        this.currentTrackId = null;
        this.lyricsData = null;
        this.syncInterval = null;
    }

    async toggleLyrics() {
        console.log('[LyricsManager] toggleLyrics called. Current mode:', this.isLyricsMode);
        this.isLyricsMode = !this.isLyricsMode;
        const { playerContainer, lyricsContainer, lyricsButton } = DOMElements;

        if (this.isLyricsMode) {
            console.log('[LyricsManager] Activating Lyrics Mode');
            playerContainer.classList.add('lyrics-mode');

            // Auto-minimize search section when entering lyrics mode
            if (DOMElements.searchSection) {
                DOMElements.searchSection.classList.add('minimized');
            }

            if (lyricsContainer) lyricsContainer.classList.remove('hidden');
            if (lyricsButton) lyricsButton.classList.add('active');
            await this.loadLyricsForCurrentTrack();
        } else {
            console.log('[LyricsManager] Deactivating Lyrics Mode');
            playerContainer.classList.remove('lyrics-mode');
            if (lyricsContainer) lyricsContainer.classList.add('hidden');
            if (lyricsButton) lyricsButton.classList.remove('active');
            this.stopSync();
        }
    }

    async loadLyricsForCurrentTrack() {
        console.log('[LyricsManager] loadLyricsForCurrentTrack called. Track ID:', this.currentTrackId);
        if (!this.currentTrackId) {
            console.warn('[LyricsManager] No current track ID found.');
            return;
        }

        const { lyricsContent, lyricsLoading } = DOMElements;
        if (lyricsContent) lyricsContent.innerHTML = '';
        if (lyricsLoading) lyricsLoading.classList.remove('hidden');

        try {
            console.log(`[LyricsManager] Fetching lyrics from: ${URLS.SERVER_URL}/lyrics/${this.currentTrackId}`);
            const response = await fetch(`${URLS.SERVER_URL}/lyrics/${this.currentTrackId}`);
            console.log('[LyricsManager] Response status:', response.status);

            if (!response.ok) throw new Error('Lyrics fetch failed');
            const data = await response.json();
            console.log('[LyricsManager] Lyrics data received:', data);

            this.lyricsData = data.lyrics;
            this.renderLyrics();
        } catch (e) {
            console.error('[LyricsManager] Error fetching lyrics:', e);
            if (lyricsContent) lyricsContent.innerHTML = '<p class="error">No lyrics found.</p>';
        } finally {
            if (lyricsLoading) lyricsLoading.classList.add('hidden');
        }
    }

    renderLyrics() {
        const { lyricsContent } = DOMElements;
        if (!lyricsContent || !this.lyricsData) return;

        // Spotify returns lines usually in a 'lines' array or similar structure depending on version
        // Standard structure from color-lyrics/v2: { lyrics: { lines: [ { startTimeMs: "...", words: "..." } ... ], ... } }
        // Note: The struct might differ. Let's handle lines.

        const lines = this.lyricsData.lines || [];
        if (lines.length === 0) {
            lyricsContent.innerHTML = '<p>Instrumental or no lyrics available.</p>';
            return;
        }

        const html = lines.map((line, index) => {
            return `<p class="lyric-line" data-time="${line.startTimeMs}" data-index="${index}">${line.words || '♪'}</p>`;
        }).join('');

        lyricsContent.innerHTML = html;

        // Add click listeners for seeking
        const lyricElements = lyricsContent.querySelectorAll('.lyric-line');
        lyricElements.forEach(el => {
            el.addEventListener('click', () => {
                const timeMs = parseInt(el.dataset.time);
                if (!isNaN(timeMs) && this.onSeek) {
                    console.log(`[LyricsManager] Seeking to ${timeMs}ms`);
                    this.onSeek(timeMs);
                }
            });
            el.style.cursor = 'pointer'; // Ensure interaction cue
        });

        this.startSync();
    }

    startSync() {
        this.stopSync();
        this.syncInterval = setInterval(() => {
            // We need access to current player position. 
            // Since we don't have direct access here easily, we rely on main.js calling updateSync or 
            // we pass a position provider. But main.js is cleaner.
            // Let's rely on updatePosition called from external
        }, 500);
    }

    stopSync() {
        if (this.syncInterval) clearInterval(this.syncInterval);
    }

    updatePosition(positionMs) {
        if (!this.isLyricsMode || !this.lyricsData) return;

        const { lyricsContent } = DOMElements;
        if (!lyricsContent) return;

        // Find current line
        const lines = Array.from(lyricsContent.querySelectorAll('.lyric-line'));
        let currentLineIndex = -1;

        for (let i = 0; i < lines.length; i++) {
            const time = parseInt(lines[i].dataset.time);
            if (time <= positionMs) {
                currentLineIndex = i;
            } else {
                break;
            }
        }

        // Update UI
        if (currentLineIndex !== -1) {
            const currentLine = lines[currentLineIndex];
            if (!currentLine.classList.contains('active')) {
                lines.forEach(l => l.classList.remove('active'));
                currentLine.classList.add('active');

                currentLine.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center'
                });
            }
        }
    }

    onTrackChanged(trackId) {
        this.currentTrackId = trackId;
        if (this.isLyricsMode) {
            this.loadLyricsForCurrentTrack();
        }
    }
}
