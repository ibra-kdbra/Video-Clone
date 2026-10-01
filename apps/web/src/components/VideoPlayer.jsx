import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { formatClock } from '../lib/format.js';
import { createStore, useStore } from '../lib/store.js';
import { parseStoryboard, spriteSheets } from '../lib/storyboard.js';
import Icon from './Icon.jsx';
import PlayerMenu from './PlayerMenu.jsx';
import SeekBar from './SeekBar.jsx';
import styles from './VideoPlayer.module.scss';

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const HIDE_AFTER_MS = 2800;
const NEXT_IN_S = 8;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const rateLabel = (rate) => `${rate}×`;
const qualityName = (height) => `${height}p`;

/** Volume, mute and speed carry over from one lesson to the next (in this browser). */
const settings = createStore(
  'grand.player',
  (value) => ({
    volume: Number.isFinite(value?.volume) ? clamp(value.volume, 0, 1) : 1,
    muted: value?.muted === true,
    rate: RATES.includes(value?.rate) ? value.rate : 1,
  }),
  { volume: 1, muted: false, rate: 1 },
);

/** Safari (and iOS) play HLS themselves; everywhere else hls.js feeds the video through Media Source Extensions. */
const playsHlsNatively = (video) => Boolean(video.canPlayType('application/vnd.apple.mpegurl')) && !(window.MediaSource || window.ManagedMediaSource);

const bufferedRanges = (video) => Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]);

/** Whether a key press is someone typing (in a text field), which shortcuts must leave alone. */
function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.tagName === 'INPUT') return target.type !== 'range';
  return target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT';
}

/**
 * The lesson player for uploaded videos: a <video> fed by hls.js (loaded on demand, without a
 * worker, which the CSP forbids) or by the browser's own HLS where it has it, under custom
 * controls: play, ±10 s, volume, time, speed, quality (Auto or a fixed rendition), picture in
 * picture and full screen, and a seek bar with storyboard previews.
 *
 * Keyboard (while the player has focus, or nothing else does): Space or K play and pause, J and L
 * skip 10 s, ← and → 5 s, ↑ and ↓ change the volume, M mutes, F goes full screen, 0–9 jump to that
 * tenth of the video, < and > change the speed. The controls fade out while playing and come back
 * with any movement, key press or focus.
 *
 * Playback links expire (after a few hours). When loading fails, `onRefresh()` fetches a fresh
 * playback and the video carries on from the same moment; `expiresAt` is also checked before
 * playing again after a long pause.
 *
 * `watch` (from useWatchProgress, for enrolled students) hears every time update, seek, pause and
 * the end, to report what has really been watched.
 */
export default function VideoPlayer({ playback, title, subtitle, startAt = 0, autoPlay = false, onRefresh, watch, onEnded, next }) {
  const { manifestUrl, posterUrl, storyboardUrl, durationSeconds, expiresAt } = playback;
  const preferences = useStore(settings);
  const container = useRef(null);
  const video = useRef(null);
  const hlsRef = useRef(null);
  const position = useRef(startAt);
  const wantsPlay = useRef(autoPlay);
  const recoveries = useRef([]);
  const recovering = useRef(false);
  const hideTimer = useRef(null);
  const osdTimer = useRef(null);
  const hintId = useId();
  const nextRef = useRef(next);
  useEffect(() => {
    nextRef.current = next;
  });

  const [paused, setPaused] = useState(true);
  const [started, setStarted] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [ended, setEnded] = useState(false);
  const [time, setTime] = useState(startAt);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [buffered, setBuffered] = useState([]);
  const [levels, setLevels] = useState([]);
  const [level, setLevel] = useState(-1);
  const [playingLevel, setPlayingLevel] = useState(-1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pip, setPip] = useState(false);
  const [menu, setMenu] = useState(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [active, setActive] = useState(true);
  const [focusInControls, setFocusInControls] = useState(false);
  const [error, setError] = useState(null);
  const [reloads, setReloads] = useState(0);
  const [cues, setCues] = useState([]);
  const [osd, setOsd] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [countdown, setCountdown] = useState(null);

  // Something happened (pointer, key, focus): show the controls, and hide them again after a while.
  const poke = useCallback(() => {
    setActive(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  /** A short message in the middle of the picture for keyboard actions, also read out by screen readers. */
  const flash = useCallback((icon, text) => {
    clearTimeout(osdTimer.current);
    setOsd({ icon, text, key: Date.now() });
    setAnnouncement(text);
    osdTimer.current = setTimeout(() => setOsd(null), 700);
  }, []);
  useEffect(() => () => clearTimeout(osdTimer.current), []);

  /** Fetches a fresh playback and reloads from the same moment (expired links, a dropped connection). */
  const recover = useCallback(async () => {
    // Several parts can fail at once; one refresh serves them all.
    if (recovering.current) return;
    const element = video.current;
    if (element) {
      if (element.currentTime > 0) position.current = element.currentTime;
      wantsPlay.current = wantsPlay.current || !element.paused;
    }
    const now = Date.now();
    recoveries.current = recoveries.current.filter((at) => now - at < 60_000);
    if (recoveries.current.length >= 3) {
      setError({ message: 'The video stopped loading. Check your connection, then try again.', retry: true });
      return;
    }
    recoveries.current.push(now);
    recovering.current = true;
    setWaiting(true);
    try {
      const fresh = await onRefresh?.();
      // The same address (it hadn't expired after all): load it again anyway.
      if (!fresh || fresh.manifestUrl === manifestUrl) setReloads((count) => count + 1);
    } catch {
      setError({ message: "The video couldn't be loaded. Try again in a moment.", retry: true });
    } finally {
      recovering.current = false;
    }
  }, [manifestUrl, onRefresh]);

  // Loads the video, again whenever its address changes (a refreshed link) or a reload is asked for.
  useEffect(() => {
    const element = video.current;
    let hls = null;
    let cancelled = false;
    let mediaRecoveries = 0;
    const from = position.current;
    const play = () => {
      if (!wantsPlay.current) return;
      element.play().catch(() => {
        // Autoplay refused (no gesture yet): the big play button is there.
      });
    };
    setError(null);

    if (playsHlsNatively(element)) {
      const seek = () => {
        if (from > 0) element.currentTime = from;
        play();
      };
      element.addEventListener('loadedmetadata', seek, { once: true });
      element.src = manifestUrl;
      return () => {
        element.removeEventListener('loadedmetadata', seek);
        element.removeAttribute('src');
        element.load();
      };
    }

    import('hls.js/light')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError({ message: "This browser can't play this video. Try a recent version of Chrome, Edge, Firefox or Safari.", retry: false });
          return;
        }
        hls = new Hls({
          // A worker would be a blob: script, which the CSP (worker-src 'none') rightly refuses.
          enableWorker: false,
          startPosition: from > 0 ? from : -1,
          capLevelToPlayerSize: true,
          maxBufferLength: 30,
          backBufferLength: 60,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setLevels(data.levels.map((item, index) => ({ index, height: item.height, bitrate: item.bitrate })));
          setLevel(hls.autoLevelEnabled ? -1 : hls.currentLevel);
          play();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => setPlayingLevel(data.level));
        hls.on(Hls.Events.ERROR, (_, data) => {
          // The store refusing a signed address means it has expired: fetch fresh ones right away,
          // rather than after hls.js has tried every rendition.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && data.response?.code === 403) {
            recover();
            return;
          }
          if (!data.fatal) return;
          const { MANIFEST_INCOMPATIBLE_CODECS_ERROR, BUFFER_INCOMPATIBLE_CODECS_ERROR, BUFFER_ADD_CODEC_ERROR } = Hls.ErrorDetails;
          if ([MANIFEST_INCOMPATIBLE_CODECS_ERROR, BUFFER_INCOMPATIBLE_CODECS_ERROR, BUFFER_ADD_CODEC_ERROR].includes(data.details)) {
            // No retry helps here: the browser can't decode H.264 (some builds of Chromium can't).
            setError({ message: "This browser can't play this video's format (H.264). Try Chrome, Edge, Firefox or Safari.", retry: false });
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries < 2) {
            mediaRecoveries += 1;
            hls.recoverMediaError();
          } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            recover();
          } else {
            setError({ message: "This video couldn't be played. Try reloading the page.", retry: true });
          }
        });
        hls.attachMedia(element);
        hls.loadSource(manifestUrl);
      })
      .catch(() => !cancelled && setError({ message: "The player couldn't load. Check your connection and reload the page.", retry: false }));

    return () => {
      cancelled = true;
      hlsRef.current = null;
      hls?.destroy();
    };
    // `recover` changes with the address, which already re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manifestUrl, reloads]);

  // The storyboard (thumbnails for the seek bar), fetched once per address; the player works without it.
  useEffect(() => {
    if (!storyboardUrl) return undefined;
    const controller = new AbortController();
    fetch(storyboardUrl, { signal: controller.signal, credentials: 'same-origin' })
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => setCues(parseStoryboard(text, new URL(storyboardUrl, window.location.href).href)))
      .catch(() => {});
    return () => controller.abort();
  }, [storyboardUrl]);

  const preloadSprites = useCallback(() => {
    for (const url of spriteSheets(cues)) {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }, [cues]);

  // Saved volume, mute and speed, applied to the element.
  useEffect(() => {
    const element = video.current;
    element.volume = preferences.volume;
    element.muted = preferences.muted;
    element.defaultPlaybackRate = preferences.rate;
    element.playbackRate = preferences.rate;
  }, [preferences]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const element = video.current;
    const enter = () => setPip(true);
    const leave = () => setPip(false);
    element.addEventListener('enterpictureinpicture', enter);
    element.addEventListener('leavepictureinpicture', leave);
    return () => {
      element.removeEventListener('enterpictureinpicture', enter);
      element.removeEventListener('leavepictureinpicture', leave);
    };
  }, []);

  // Actions ------------------------------------------------------------------------------------

  const togglePlay = useCallback(() => {
    const element = video.current;
    if (!element) return;
    if (element.paused || element.ended) {
      wantsPlay.current = true;
      setCountdown(null);
      // After a long pause the links may have expired: refresh first, then play from here.
      if (expiresAt && Date.parse(expiresAt) - Date.now() < 15_000) {
        recover();
        return;
      }
      element.play().catch(() => {});
    } else {
      wantsPlay.current = false;
      element.pause();
    }
  }, [expiresAt, recover]);

  const seekTo = useCallback((seconds) => {
    const element = video.current;
    if (!element || !(element.duration > 0)) return;
    element.currentTime = clamp(seconds, 0, element.duration);
    setTime(element.currentTime);
    setEnded(false);
    setCountdown(null);
  }, []);

  const seekBy = useCallback(
    (delta) => {
      const element = video.current;
      if (!element) return;
      seekTo(element.currentTime + delta);
      flash(delta < 0 ? 'back10' : 'forward10', `${delta > 0 ? '+' : '−'}${Math.abs(delta)} s · ${formatClock(element.currentTime)}`);
    },
    [seekTo, flash],
  );

  const setVolume = useCallback(
    (volume, announce = false) => {
      const next = clamp(Math.round(volume * 100) / 100, 0, 1);
      settings.set((current) => ({ ...current, volume: next, muted: next === 0 }));
      if (announce) flash(next === 0 ? 'volumeOff' : 'volume', `Volume ${Math.round(next * 100)}%`);
    },
    [flash],
  );

  const toggleMute = useCallback(() => {
    const current = settings.get();
    const muted = !current.muted;
    const volume = !muted && current.volume === 0 ? 0.5 : current.volume;
    settings.set({ ...current, muted, volume });
    flash(muted ? 'volumeOff' : 'volume', muted ? 'Muted' : `Volume ${Math.round(volume * 100)}%`);
  }, [flash]);

  const replay = useCallback(() => {
    seekTo(0);
    togglePlay();
  }, [seekTo, togglePlay]);

  const setRate = useCallback(
    (rate) => {
      settings.set((current) => ({ ...current, rate }));
      flash('clock', `Speed ${rateLabel(rate)}`);
    },
    [flash],
  );

  const chooseLevel = useCallback(
    (index) => {
      const hls = hlsRef.current;
      if (!hls) return;
      // currentLevel switches at once (dropping what's buffered); -1 hands the choice back to hls.js.
      hls.currentLevel = index;
      setLevel(index);
      const chosen = levels.find((item) => item.index === index);
      flash('sliders', chosen ? `Quality ${qualityName(chosen.height)}` : 'Quality: Auto');
    },
    [levels, flash],
  );

  const toggleFullscreen = useCallback(() => {
    const element = video.current;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (container.current?.requestFullscreen) container.current.requestFullscreen().catch(() => {});
    // iPhones only let the video itself go full screen.
    else element?.webkitEnterFullscreen?.();
  }, []);

  const togglePip = useCallback(() => {
    const element = video.current;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else element?.requestPictureInPicture?.().catch(() => {});
  }, []);

  // Keyboard shortcuts -------------------------------------------------------------------------

  useEffect(() => {
    const onKey = (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      const root = container.current;
      if (!root) return;
      const target = event.target;
      const inside = root.contains(target);
      // With nothing in particular focused (the page itself), the letter shortcuts still work.
      const idle = target === document.body || target === document.documentElement || target?.id === 'main';
      if (!inside && !idle) return;
      const onControl = inside && target !== root && target.closest?.('button, a, [role="slider"], input');
      // Sliders (seek, volume) move with the arrow keys themselves.
      const onSlider = inside && target.closest?.('[role="slider"], input');
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      if (key === ' ' || key === 'k') {
        // Space presses the focused button instead.
        if (key === ' ' && onControl) return;
        togglePlay();
      } else if (key === 'j') seekBy(-10);
      else if (key === 'l') seekBy(10);
      else if (key === 'm') toggleMute();
      else if (key === 'f') toggleFullscreen();
      else if (/^[0-9]$/.test(key) && duration > 0) {
        seekTo((Number(key) / 10) * duration);
        flash('clock', `${Number(key) * 10}% · ${formatClock((Number(key) / 10) * duration)}`);
      } else if (key === '>' || key === '<') {
        const index = RATES.indexOf(settings.get().rate) + (key === '>' ? 1 : -1);
        if (index >= 0 && index < RATES.length) setRate(RATES[index]);
      } else if (inside && !onSlider && (key === 'ArrowLeft' || key === 'ArrowRight')) seekBy(key === 'ArrowLeft' ? -5 : 5);
      else if (inside && !onSlider && (key === 'ArrowUp' || key === 'ArrowDown')) {
        const { volume, muted } = settings.get();
        setVolume((muted ? 0 : volume) + (key === 'ArrowUp' ? 0.05 : -0.05), true);
      } else return;
      event.preventDefault();
      poke();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [duration, togglePlay, seekBy, seekTo, toggleMute, toggleFullscreen, setRate, setVolume, flash, poke]);

  // The lock screen and media keys.
  useEffect(() => {
    const session = navigator.mediaSession;
    if (!session || typeof window.MediaMetadata !== 'function') return undefined;
    session.metadata = new window.MediaMetadata({
      title,
      artist: subtitle ?? '',
      artwork: posterUrl ? [{ src: posterUrl, sizes: '1280x720', type: 'image/jpeg' }] : [],
    });
    const handlers = {
      play: () => video.current?.play(),
      pause: () => video.current?.pause(),
      seekbackward: () => seekBy(-10),
      seekforward: () => seekBy(10),
      seekto: (details) => seekTo(details.seekTime),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        session.setActionHandler(action, handler);
      } catch {
        // Not every browser knows every action.
      }
    }
    return () => {
      session.metadata = null;
      for (const action of Object.keys(handlers)) {
        try {
          session.setActionHandler(action, null);
        } catch {
          // As above.
        }
      }
    };
  }, [title, subtitle, posterUrl, seekBy, seekTo]);

  // "Up next": a short countdown to the next lesson, which any press on the player cancels.
  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown <= 0) {
      nextRef.current?.go();
      return undefined;
    }
    const timer = setTimeout(() => setCountdown((value) => (value === null ? null : value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  // Rendering ----------------------------------------------------------------------------------

  const visible = active || paused || Boolean(menu) || scrubbing || focusInControls || Boolean(error) || ended;
  const volumeIcon = preferences.muted || preferences.volume === 0 ? 'volumeOff' : preferences.volume < 0.5 ? 'volumeLow' : 'volume';
  const sortedLevels = [...levels].sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
  const playingHeight = levels.find((item) => item.index === playingLevel)?.height;
  const qualityValue =
    level === -1 ? (playingHeight ? `Auto · ${qualityName(playingHeight)}` : 'Auto') : qualityName(levels.find((item) => item.index === level)?.height ?? 0);
  const pipSupported = typeof document !== 'undefined' && document.pictureInPictureEnabled;

  return (
    <div
      ref={container}
      className={styles.player}
      data-visible={visible}
      data-fullscreen={fullscreen || undefined}
      role="region"
      aria-label={`Video player: ${title}`}
      aria-describedby={hintId}
      tabIndex={0}
      onPointerMove={poke}
      onPointerDown={poke}
      onFocus={poke}
    >
      <video
        ref={video}
        className={styles.video}
        poster={posterUrl ?? undefined}
        playsInline
        preload="metadata"
        onPlay={() => {
          setPaused(false);
          setStarted(true);
          setEnded(false);
          poke();
        }}
        onPause={() => {
          setPaused(true);
          watch?.pause();
        }}
        onSeeking={(event) => event.currentTarget.readyState > 0 && watch?.seeking(event.currentTarget.currentTime)}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || durationSeconds || 0)}
        onDurationChange={(event) => Number.isFinite(event.currentTarget.duration) && setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          // Not while the video is being unloaded (leaving, or a reload), which reports 0:00.
          if (element.readyState > 0) watch?.observe(element.currentTime, { playing: !element.paused, rate: element.playbackRate });
          if (scrubbing) return;
          setTime(element.currentTime);
          if (element.currentTime > 0) position.current = element.currentTime;
        }}
        onProgress={(event) => setBuffered(bufferedRanges(event.currentTarget))}
        onEnded={() => {
          setEnded(true);
          setPaused(true);
          wantsPlay.current = false;
          watch?.ended();
          onEnded?.();
          if (next) setCountdown(NEXT_IN_S);
        }}
        onError={() => {
          // Only the browser's own HLS reports here; hls.js reports through its own events.
          if (!hlsRef.current && video.current?.error) recover();
        }}
      />

      {/* Clicks on the picture: play and pause with a mouse; on touch, a tap first brings the controls back. */}
      <div
        className={styles.surface}
        onClick={(event) => {
          if (event.nativeEvent.pointerType === 'touch' && !visible) return;
          togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
        aria-hidden="true"
      />

      {waiting && !error && !paused && <span className={styles.spinner} aria-hidden="true" />}

      {!started && !error && (
        <button type="button" className={styles.bigPlay} onClick={togglePlay} aria-label={`Play ${title}`}>
          <Icon name="play" size={34} />
        </button>
      )}

      {osd && (
        <div key={osd.key} className={styles.osd} aria-hidden="true">
          <Icon name={osd.icon} size={26} />
          <span className="tabular">{osd.text}</span>
        </div>
      )}

      {ended && !error && (
        <div className={styles.endCard}>
          {next ? (
            <>
              <p className={styles.upNext}>Up next</p>
              <p className={styles.nextTitle}>{next.title}</p>
              <div className={styles.endActions}>
                <Link to={next.to} state={{ autoplay: true }} className={styles.nextButton}>
                  <Icon name="skipNext" size={18} />
                  {countdown !== null ? `Next lesson in ${countdown}` : 'Next lesson'}
                </Link>
                {countdown !== null ? (
                  <button type="button" className={styles.endSecondary} onClick={() => setCountdown(null)}>
                    Cancel
                  </button>
                ) : (
                  <button type="button" className={styles.endSecondary} onClick={replay}>
                    <Icon name="replay" size={18} />
                    Watch again
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <p className={styles.nextTitle}>You've reached the end of this course</p>
              <div className={styles.endActions}>
                <button type="button" className={styles.endSecondary} onClick={replay}>
                  <Icon name="replay" size={18} />
                  Watch again
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {error && (
        <div className={styles.error} role="alert">
          <Icon name="alert" size={28} />
          <p>{error.message}</p>
          {error.retry && (
            <button
              type="button"
              className={styles.endSecondary}
              onClick={() => {
                recoveries.current = [];
                wantsPlay.current = true;
                setError(null);
                recover();
              }}
            >
              <Icon name="refresh" size={18} />
              Try again
            </button>
          )}
        </div>
      )}

      <div
        className={styles.controls}
        onFocus={() => setFocusInControls(true)}
        onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocusInControls(false)}
      >
        <SeekBar
          time={time}
          duration={duration}
          buffered={buffered}
          cues={cues}
          onPreviewStart={preloadSprites}
          onScrub={(value) => setScrubbing(value !== null)}
          onSeek={seekTo}
        />
        <div className={styles.row}>
          <button
            type="button"
            className={styles.button}
            onClick={togglePlay}
            aria-label={paused ? 'Play (k)' : 'Pause (k)'}
            title={paused ? 'Play (k)' : 'Pause (k)'}
          >
            <Icon name={paused ? 'play' : 'pause'} size={24} />
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.wide}`}
            onClick={() => seekBy(-10)}
            aria-label="Back 10 seconds (j)"
            title="Back 10 seconds (j)"
          >
            <Icon name="back10" size={24} />
          </button>
          <button
            type="button"
            className={`${styles.button} ${styles.wide}`}
            onClick={() => seekBy(10)}
            aria-label="Forward 10 seconds (l)"
            title="Forward 10 seconds (l)"
          >
            <Icon name="forward10" size={24} />
          </button>
          <div className={styles.volume}>
            <button
              type="button"
              className={styles.button}
              onClick={toggleMute}
              aria-label={preferences.muted ? 'Unmute (m)' : 'Mute (m)'}
              title={preferences.muted ? 'Unmute (m)' : 'Mute (m)'}
            >
              <Icon name={volumeIcon} size={24} />
            </button>
            <input
              type="range"
              className={styles.slider}
              min="0"
              max="1"
              step="0.05"
              value={preferences.muted ? 0 : preferences.volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Volume"
              aria-valuetext={`${Math.round((preferences.muted ? 0 : preferences.volume) * 100)}%`}
              style={{ '--level': preferences.muted ? 0 : preferences.volume }}
            />
          </div>
          <p className={`${styles.time} tabular`}>
            <span>{formatClock(time)}</span>
            <span className={styles.total}> / {formatClock(duration)}</span>
          </p>

          <span className={styles.spacer} />

          <PlayerMenu
            label="Playback speed"
            value={rateLabel(preferences.rate)}
            current={rateLabel(preferences.rate)}
            open={menu === 'speed'}
            onOpenChange={(open) => setMenu(open ? 'speed' : null)}
            options={RATES.map((rate) => ({ value: rate, label: rate === 1 ? 'Normal' : rateLabel(rate), selected: rate === preferences.rate }))}
            onSelect={setRate}
          />
          {levels.length > 1 && (
            <PlayerMenu
              label="Quality"
              value={level === -1 ? (playingHeight >= 720 ? 'HD' : 'Auto') : qualityName(levels.find((item) => item.index === level)?.height ?? 0)}
              current={qualityValue}
              open={menu === 'quality'}
              onOpenChange={(open) => setMenu(open ? 'quality' : null)}
              options={[
                { value: -1, label: 'Auto', detail: level === -1 && playingHeight ? qualityName(playingHeight) : undefined, selected: level === -1 },
                ...sortedLevels.map((item) => ({
                  value: item.index,
                  label: qualityName(item.height),
                  detail: item.height >= 720 ? 'HD' : undefined,
                  selected: level === item.index,
                })),
              ]}
              onSelect={chooseLevel}
            />
          )}
          {pipSupported && (
            <button
              type="button"
              className={`${styles.button} ${styles.wide}`}
              onClick={togglePip}
              aria-label={pip ? 'Leave picture in picture' : 'Picture in picture'}
              aria-pressed={pip}
              title="Picture in picture"
            >
              <Icon name="pip" size={22} />
            </button>
          )}
          <button
            type="button"
            className={styles.button}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'}
            title={fullscreen ? 'Exit full screen (f)' : 'Full screen (f)'}
          >
            <Icon name={fullscreen ? 'fullscreenExit' : 'fullscreen'} size={22} />
          </button>
        </div>
      </div>

      <p id={hintId} className="visually-hidden">
        Keyboard shortcuts: Space or K to play and pause, J and L to skip 10 seconds, arrow keys to skip 5 seconds and change the volume, M to mute, F for full
        screen, and 0 to 9 to jump through the video.
      </p>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
