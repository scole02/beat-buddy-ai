// alphaTab owns engraving, score ticks, bar layout and the playback cursor.
class AlphaScoreView {
  constructor(element, audio, onError) {
    this.audio = audio;
    this.loading = false;
    this.active = false;
    this.xmlURL = null;
    const at = window.alphaTab;
    this.api = new at.AlphaTabApi(element, {
      core: {fontDirectory: '/static/vendor/alphatab/font/', useWorkers: false},
      display: {layoutMode: at.LayoutMode.Page, barsPerRow: 3, staveProfile: at.StaveProfile.Score, scale: 1, justifyLastSystem: true},
      player: {playerMode: at.PlayerMode.EnabledExternalMedia, enableCursor: true,
        enableAnimatedBeatCursor: true, enableElementHighlighting: true,
        scrollMode: at.ScrollMode.OffScreen, scrollOffsetY: -80}
    });
    this.api.error.on(error => onError(`Could not render the score: ${error.message || error}`));
    this.api.playerReady.on(() => this.sync());
    this.api.renderFinished.on(() => this.sync());
    this.api.player.output.handler = {
      get backingTrackDuration() { return Number.isFinite(audio.duration) ? audio.duration * 1000 : 0; },
      get playbackRate() { return audio.playbackRate; },
      set playbackRate(value) { if (audio.playbackRate !== value) audio.playbackRate = value; },
      get masterVolume() { return audio.volume; },
      set masterVolume(value) { if (audio.volume !== value) audio.volume = value; },
      seekTo: milliseconds => {
        if (!this.loading && this.active) audio.currentTime = milliseconds * audio.playbackRate / 1000;
      },
      play: () => {
        if (!this.loading && this.active && audio.paused && !audio.ended) audio.play().catch(error => onError(error.message));
      },
      pause: () => { if (!this.loading && this.active && !audio.paused) audio.pause(); }
    };
  }
  render(result, clef) {
    const exported = MusicScore.exportMusicXml(result, clef);
    const at = window.alphaTab;
    const score = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(exported.xml), this.api.settings);
    // Absolute measure boundaries, including the padded final measure: never
    // stretch the score to fit the recorded file or realign it to a late attack.
    const syncPoints = score.masterBars.map((_bar, i) => ({barIndex: i, barPosition: 0,
      barOccurence: 0, millisecondOffset: i * exported.barSeconds * 1000}));
    syncPoints.push({barIndex: score.masterBars.length - 1, barPosition: 1,
      barOccurence: 0, millisecondOffset: score.masterBars.length * exported.barSeconds * 1000});
    score.applyFlatSyncPoints(syncPoints);
    this.loading = true;
    try { this.api.renderScore(score); this.active = true; }
    finally { this.loading = false; }
    if (this.xmlURL) URL.revokeObjectURL(this.xmlURL);
    this.xmlURL = URL.createObjectURL(new Blob([exported.xml], {type: 'application/vnd.recordare.musicxml+xml'}));
    const download = document.getElementById('download-musicxml');
    download.href = this.xmlURL; download.hidden = false;
    this.sync();
  }
  sync() {
    if (this.loading || !this.active || !this.api.isReadyForPlayback) return;
    const audio = this.audio;
    // Setting alphaTab's speed also seeks its player, even if unchanged. Never
    // set it each animation frame or that seek would keep resetting the audio.
    if (this.api.playbackSpeed !== audio.playbackRate) {
      this.loading = true;
      try { this.api.playbackSpeed = audio.playbackRate; }
      finally { this.loading = false; }
    }
    // alphaTab's external-media timeline is speed-adjusted milliseconds.
    this.api.player.output.updatePosition(audio.currentTime / audio.playbackRate * 1000);
    if (audio.paused || audio.ended || audio.seeking || audio.readyState < 3) {
      // Waiting/seeking must freeze the score without pausing the media element.
      this.loading = true;
      try { this.api.pause(); } finally { this.loading = false; }
    } else this.api.play();
  }
  clear() {
    this.active = false;
    this.api.pause();
    document.getElementById('download-musicxml').hidden = true;
    if (this.xmlURL) URL.revokeObjectURL(this.xmlURL);
    this.xmlURL = null;
  }
  destroy() { this.clear(); this.api.destroy(); }
}
