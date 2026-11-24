/* Horrorable TV DUI player: YouTube + Twitch.
 * Loaded from the FXServer's public HTTPS address (https://<id>.users.cfx.re/horrorable_tv/player.html)
 * so YouTube gets a real Referer (no error 153) and Twitch gets a valid `parent` domain. */
(function () {
  'use strict';
  const params = new URLSearchParams(location.search);
  const status = document.getElementById('status');
  const KINDS = { youtube: 'YouTube', twitch: 'Twitch' };
  const kind = params.get('kind') === 'twitch' ? 'twitch' : 'youtube';
  const tw = params.get('tw') || 'channel';
  const initialId = params.get('id') || '';
  const patterns = {
    youtube: /^[a-zA-Z0-9_-]{11}$/,
    channel: /^[a-zA-Z0-9_]{2,25}$/,
    video: /^[0-9]{1,15}$/,
    clip: /^[a-zA-Z0-9_-]{3,100}$/
  };
  let player = null;
  let ready = false;
  let lastId = null;
  let ccOn = null;
  let pending = {
    action: 'sync', kind: kind, tw: tw, id: initialId,
    seconds: +params.get('start') || 0,
    volume: params.has('volume') ? +params.get('volume') : 50,
    paused: params.get('paused') === '1',
    cc: params.get('cc') === '1'
  };

  function label(str) { status.textContent = str || ''; }
  function clamp(x, min, max) { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
  function validId(k, t, id) { return k === 'youtube' ? patterns.youtube.test(id || '') : !!(patterns[t] && patterns[t].test(id || '')); }
  function validSync(d) { return d && d.action === 'sync' && validId(d.kind || 'youtube', d.tw || 'channel', d.id); }
  function loadScript(src, onload) {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.referrerPolicy = 'strict-origin-when-cross-origin';
    s.onload = onload || null;
    s.onerror = function () { label('Could not load player script: ' + src); };
    document.head.appendChild(s);
  }

  // ---------------- YouTube ----------------
  function applyCaptions(on) {
    if (ccOn === on) return;
    ccOn = on;
    try {
      if (on) { player.loadModule('captions'); player.setOption('captions', 'track', { languageCode: 'en' }); }
      else player.unloadModule('captions');
    } catch (_) { /* captions unavailable for this video */ }
  }
  function applyYoutube(d) {
    const target = clamp(d.seconds, 0, 86400);
    if (lastId !== d.id) {
      lastId = d.id;
      player.loadVideoById({ videoId: d.id, startSeconds: target });
    } else if (typeof player.getCurrentTime === 'function') {
      const actual = Number(player.getCurrentTime()) || 0;
      if (Math.abs(actual - target) > 3.5) player.seekTo(target, true);
    }
    player.unMute();
    player.setVolume(clamp(d.volume, 0, 100));
    if (d.paused) player.pauseVideo(); else player.playVideo();
    applyCaptions(!!d.cc);
  }
  function startYoutube() {
    window.onYouTubeIframeAPIReady = function () {
      lastId = initialId;
      player = new YT.Player('player', {
        width: 1280, height: 720, videoId: initialId, host: 'https://www.youtube.com',
        playerVars: {
          autoplay: 1, controls: 0, disablekb: 1, modestbranding: 1, playsinline: 1, rel: 0,
          cc_load_policy: pending.cc ? 1 : 0, iv_load_policy: 3,
          start: Math.floor(clamp(pending.seconds, 0, 86400)), origin: location.origin,
          widget_referrer: location.href
        },
        events: {
          onReady: function () { ready = true; apply(pending); if (unlocked) unlockAudio(); },
          onStateChange: function (e) { if (e.data === YT.PlayerState.PLAYING) label(''); },
          onError: function (e) {
            const code = e.data;
            if (code === 101 || code === 150) label('The owner of this video does not allow it to be embedded.');
            else if (code === 153) label('YouTube error 153: the TV player has no valid HTTPS origin yet.');
            else if (code === 100) label('This YouTube video was removed or is private.');
            else label('YouTube cannot play this video (error ' + code + ').');
          }
        }
      });
    };
    loadScript('https://www.youtube.com/iframe_api');
  }

  // ---------------- Twitch ----------------
  function applyTwitch(d) {
    if (tw === 'clip' || !player) return;
    try {
      player.setMuted(false);
      player.setVolume(clamp(d.volume, 0, 100) / 100);
      if (tw === 'video') {
        const target = clamp(d.seconds, 0, 86400);
        const actual = Number(player.getCurrentTime()) || 0;
        if (Math.abs(actual - target) > 4) player.seek(target);
      }
      if (d.paused) player.pause(); else player.play();
    } catch (e) { label('Twitch player issue: ' + (e.message || String(e))); }
  }
  function startTwitch() {
    const parent = location.hostname;
    if (tw === 'clip') {
      const f = document.createElement('iframe');
      f.src = 'https://clips.twitch.tv/embed?clip=' + encodeURIComponent(initialId) +
        '&parent=' + encodeURIComponent(parent) + '&autoplay=true&muted=false';
      f.allow = 'autoplay; fullscreen';
      document.getElementById('player').appendChild(f);
      ready = true; label('');
      return;
    }
    loadScript('https://player.twitch.tv/js/embed/v1.js', function () {
      const opts = { width: 1280, height: 720, parent: [parent], autoplay: true, muted: false, controls: false };
      if (tw === 'video') { opts.video = 'v' + initialId; opts.time = Math.floor(clamp(pending.seconds, 0, 86400)) + 's'; }
      else opts.channel = initialId.toLowerCase();
      player = new Twitch.Player('player', opts);
      player.addEventListener(Twitch.Player.READY, function () { ready = true; apply(pending); if (unlocked) unlockAudio(); });
      player.addEventListener(Twitch.Player.PLAYING, function () { label(''); });
      player.addEventListener(Twitch.Player.OFFLINE, function () { if (tw === 'channel') label(initialId + ' is offline on Twitch.'); });
    });
  }

  function apply(d) {
    if (!validSync(d)) return;
    pending = d;
    if (!player || !ready) return;
    try {
      if ((d.kind || 'youtube') !== kind) return; // a kind switch reloads the page from Lua
      if (kind === 'youtube') applyYoutube(d); else applyTwitch(d);
    } catch (e) { label('Player issue: ' + (e.message || String(e))); }
  }

  // ---------------- Audio unlock ----------------
  // A DUI page never gets a real click, so the browser only allows muted autoplay and
  // YouTube/Twitch silently start muted. The game clicks #unlock (SendDuiMouseDown/Up);
  // that user gesture lets us unmute and play with sound.
  let unlocked = false;
  function unlockAudio() {
    unlocked = true;
    if (!player || !ready) return;
    const vol = clamp(pending.volume, 0, 100);
    try {
      if (kind === 'youtube') {
        player.unMute();
        player.setVolume(vol);
        if (!pending.paused) player.playVideo();
      } else if (typeof player.setMuted === 'function') {
        player.setMuted(false);
        player.setVolume(vol / 100);
        if (!pending.paused) player.play();
      }
    } catch (_) { /* not ready for commands yet; the next click retries */ }
  }
  ['mousedown', 'click'].forEach(function (ev) { document.getElementById('unlock').addEventListener(ev, unlockAudio); });
  setInterval(function () {
    if (!unlocked || !ready || !player || kind !== 'youtube') return;
    try { if (player.isMuted() && clamp(pending.volume, 0, 100) > 0) unlockAudio(); } catch (_) {}
  }, 1000);

  window.addEventListener('message', function (event) {
    let d = event.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (_) { return; } }
    if (validSync(d)) apply(d);
  });

  if (!validId(kind, tw, initialId)) { label('Invalid ' + KINDS[kind] + ' link'); return; }
  label('Loading ' + KINDS[kind] + '...');
  if (kind === 'twitch') startTwitch(); else startYoutube();
  setTimeout(function () { if (!ready) label(KINDS[kind] + ' is not responding.'); }, 15000);
})();
