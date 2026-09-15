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
      display: {layoutMode: at.LayoutMode.Page, systemsLayoutMode: at.SystemsLayoutMode.UseModelLayout, barsPerRow: 3, staveProfile: at.StaveProfile.Score, scale: 1, justifyLastSystem: true},
      player: {playerMode: at.PlayerMode.EnabledExternalMedia, enableCursor: true,
        enableAnimatedBeatCursor: false, enableElementHighlighting: true,
        scrollMode: at.ScrollMode.OffScreen, scrollOffsetY: -80}
    });
    // Note-based cursor callbacks can alternate between the reference and take.
    // Keep alphaTab's cursor containers, but place them only from the audio clock.
    this.api.customCursorHandler = {
      onAttach: cursors => { this.cursors = cursors; },
      // In pinned alphaTab 1.8.4, assigning a handler to existing cursors
      // calls the incoming handler's onDetach instead of onAttach.
      onDetach: cursors => { this.cursors = cursors; },
      placeBarCursor() {}, placeBeatCursor() {}, transitionBeatCursor() {}
    };
    this.api.customScrollHandler = {forceScrollTo() {}, onBeatCursorUpdating() {}};
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
    const reference = result.practice?.reference;
    const report = reference ? Practice.compare(reference, result, result.practice.allowanceMs) : null;
    const exported = MusicScore.exportMusicXml(reference || result, clef);
    const at = window.alphaTab;
    const score = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(exported.xml), this.api.settings);
    if (reference) {
      const recorded = MusicScore.exportMusicXml({...result, duration: reference.duration, scoreDuration: reference.duration, key_fifths: reference.key_fifths}, clef);
      // Export the same two-part comparison rather than only the reference.
      const actualXml = recorded.xml.replaceAll('id="P1"', 'id="P2"').replaceAll('id="I1"', 'id="I2"').replace('<part-name>Instrument</part-name>', '<part-name>You played</part-name>');
      const partDefinition = actualXml.match(/<score-part id="P2">[\s\S]*?<\/score-part>/)[0];
      const partBody = actualXml.match(/<part id="P2">[\s\S]*?<\/part>/)[0];
      exported.xml = exported.xml.replace('<part-name>Instrument</part-name>', '<part-name>Reference</part-name>').replace('</part-list>', partDefinition + '</part-list>').replace('</score-partwise>', partBody + '</score-partwise>');
      const actualScore = at.importer.ScoreLoader.loadScoreFromBytes(new TextEncoder().encode(recorded.xml), this.api.settings);
      score.tracks[0].name = 'Reference'; score.tracks[0].shortName = 'Ref.';
      actualScore.tracks[0].name = 'You played'; actualScore.tracks[0].shortName = 'You';
      // Complete both tracks to the same measure count before sharing master bars.
      while (score.masterBars.length < actualScore.masterBars.length) score.addMasterBar(actualScore.masterBars[score.masterBars.length]);
      score.addTrack(actualScore.tracks[0]);
      score.finish(this.api.settings);
      const quarterSeconds = 60 / result.tempo * reference.time_signature.denominator / 4;
      const colorTrack = (track, notes, statuses) => {
        for (const staff of track.staves) for (const bar of staff.bars) for (const voice of bar.voices) for (const beat of voice.beats) {
          const time = beat.absolutePlaybackStart / 960 * quarterSeconds;
          const index = notes.findIndex(note => {
            const onset = note.notation_start ?? Math.round(note.start / quarterSeconds * 4) / 4 * quarterSeconds;
            const end = onset + (note.duration_beats ?? note.duration / quarterSeconds) * quarterSeconds;
            return time >= onset - .0001 && time < end - .0001 && beat.notes.some(pitch => pitch.realValue === note.midi);
          });
          if (index < 0) continue;
          for (const note of beat.notes) {
            note.style = new at.model.NoteStyle();
            const color = at.model.Color.fromJson(Practice.colors[statuses[index]]);
            note.style.colors.set(at.model.NoteSubElement.StandardNotationNoteHead, color);
            note.style.colors.set(at.model.NoteSubElement.StandardNotationAccidentals, color);
          }
        }
      };
      colorTrack(score.tracks[0], reference.notes, report.reference);
      colorTrack(score.tracks[1], result.notes, report.actual);
    }
    score.title = reference?.title || result.title || score.title;
    score.defaultSystemsLayout = 3;
    score.systemsLayout = [];
    for (const track of score.tracks) {
      track.defaultSystemsLayout = 3; track.systemsLayout = [];
      for (const staff of track.staves) for (const bar of staff.bars) bar.displayScale = 1;
    }
    for (const bar of score.masterBars) bar.displayScale = 1;
    this.barSeconds = exported.barSeconds;
    this.barCount = score.masterBars.length;
    this.cursorRow = undefined;
    // Absolute measure boundaries, including the padded final measure: never
    // stretch the score to fit the recorded file or realign it to a late attack.
    const syncPoints = score.masterBars.map((_bar, i) => ({barIndex: i, barPosition: 0,
      barOccurence: 0, millisecondOffset: i * exported.barSeconds * 1000}));
    syncPoints.push({barIndex: score.masterBars.length - 1, barPosition: 1,
      barOccurence: 0, millisecondOffset: score.masterBars.length * exported.barSeconds * 1000});
    score.applyFlatSyncPoints(syncPoints);
    this.loading = true;
    try { this.api.renderScore(score, reference ? [0, 1] : [0]); this.active = true; }
    finally { this.loading = false; }
    if (this.xmlURL) URL.revokeObjectURL(this.xmlURL);
    this.xmlURL = URL.createObjectURL(new Blob([exported.xml], {type: 'application/vnd.recordare.musicxml+xml'}));
    const download = document.getElementById('download-musicxml');
    download.href = this.xmlURL; download.hidden = false;
    this.sync();
  }
  sync() {
    if (this.loading || !this.active || !this.api.isReadyForPlayback) return;
    const audio = this.liveClock ? this.liveClock() : this.audio;
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
    } else {
      this.loading = !!this.liveClock;
      try { this.api.play(); } finally { this.loading = false; }
    }
    this.placeTimeCursor(audio);
  }
  placeTimeCursor(audio) {
    if (!this.cursors || !this.barCount) return;
    const position = AlphaScoreView.measurePosition(audio.currentTime, this.barSeconds, this.barCount);
    const bounds = this.api.renderer.boundsLookup?.findMasterBarByIndex(position.index);
    if (!bounds) return;
    const box = bounds.lineAlignedBounds;
    // Use the same rendered bar boundaries for capture, replay, pauses and seeks.
    // No CSS easing or note/rest-dependent animation is allowed to advance it.
    const x = box.x + box.w * position.fraction;
    const cursor = this.cursors.beatCursor;
    cursor.transitionToX(0, x);
    cursor.setBounds(x, box.y, 2, box.h);
    this.cursors.barCursor.setBounds(box.x, box.y, box.w, box.h);
    if (this.cursorRow !== box.y) {
      this.cursorRow = box.y;
      if (!audio.paused && audio.currentTime > 0) cursor.element?.scrollIntoView({block: 'nearest', behavior: 'auto'});
    }
  }
  static measurePosition(time, seconds, count) {
    let measures = Math.max(0, Math.min(time / seconds, count));
    const nearest = Math.round(measures);
    if (Math.abs(measures - nearest) < Number.EPSILON * Math.max(1, measures) * 4) measures = nearest;
    const index = Math.min(count - 1, Math.floor(measures));
    return {index, fraction: measures - index};
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
