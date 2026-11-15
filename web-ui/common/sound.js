/* Sound design for the panel: three cues, all synthesised with Web Audio so no
 * audio files ship with the repo.
 *
 * Default is OFF. Sound in a tool that people open while listening to music is
 * an imposition, so it is a switch the user turns on once and we remember it.
 * Every cue is triggered by a real event (tab change, success, log cleared) and
 * is deliberately quiet; nothing loops.
 */

(function () {
  "use strict";

  var KEY = "selena.sound";
  var ctx = null;
  var master = null;
  var enabled = localStorage.getItem(KEY) === "on";

  function context() {
    if (!ctx) {
      var AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return null;
      ctx = new AudioCtor();
      master = ctx.createGain();
      master.gain.value = 0.07;
      master.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  /* A cello-ish pluck: one triangle with a fast decay through a lowpass, so it
   * reads as a string being touched rather than a beep. */
  function pluck(freq) {
    if (!enabled) return;
    var c = context();
    if (!c) return;

    var now = c.currentTime;
    var osc = c.createOscillator();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();

    osc.type = "triangle";
    osc.frequency.value = freq || 523.25;

    filter.type = "lowpass";
    filter.frequency.value = 1800;

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.9, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.24);
  }

  /* Success: a short open fifth-plus-third, the smallest thing that reads as
   * "that worked" without sounding like a game reward jingle. */
  function chord() {
    if (!enabled) return;
    var c = context();
    if (!c) return;

    var now = c.currentTime;
    [392.0, 493.88, 587.33].forEach(function (freq, index) {
      var osc = c.createOscillator();
      var gain = c.createGain();

      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.45 / (index + 1), now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);

      osc.connect(gain);
      gain.connect(master);

      osc.start(now);
      osc.stop(now + 0.58);
    });
  }

  /* Silence: one low note, nothing melodic, matching the action. */
  function low() {
    if (!enabled) return;
    var c = context();
    if (!c) return;

    var now = c.currentTime;
    var osc = c.createOscillator();
    var gain = c.createGain();

    osc.type = "sine";
    osc.frequency.setValueAtTime(196, now);
    osc.frequency.exponentialRampToValueAtTime(130.81, now + 0.28);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    osc.connect(gain);
    gain.connect(master);

    osc.start(now);
    osc.stop(now + 0.36);
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    localStorage.setItem(KEY, enabled ? "on" : "off");
    if (enabled) pluck(523.25);
    return enabled;
  }

  window.SelenaAudio = {
    pluck: pluck,
    chord: chord,
    low: low,
    setEnabled: setEnabled,
    isEnabled: function () { return enabled; }
  };
})();