"""
Renders the demo school's short lessons on the physics of sound: animated waveforms with titles
and captions, over tones synthesized to match what's on screen. Each clip is written as an MP4
(H.264 + AAC) that package.sh then turns into HLS the way the worker does.

    python3 -m venv .venv && .venv/bin/pip install numpy pillow
    .venv/bin/python apps/web/scripts/demo-media/render.py OUT_DIR [clip ...]

Everything here is made from scratch (no recordings or footage), so the clips can ship with the
app.
"""

import math
import os
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

W, H, FPS, SS = 1280, 720, 30, 2  # output size, frame rate, supersampling for smooth lines
RATE = 48_000

FONT_DIR = '/usr/share/fonts/truetype/liberation'
BOLD = os.path.join(FONT_DIR, 'LiberationSans-Bold.ttf')
REGULAR = os.path.join(FONT_DIR, 'LiberationSans-Regular.ttf')

BG = (12, 12, 20)
PANEL = (22, 22, 34)
GRID = (40, 40, 58)
TEXT = (245, 245, 250)
MUTED = (161, 161, 178)
VIOLET = (167, 139, 250)
PINK = (244, 114, 182)
SKY = (56, 189, 248)
AMBER = (251, 191, 36)

COURSE = 'Grand Academy  ·  The Physics of Sound'

_fonts = {}


def font(path, size):
    key = (path, size)
    if key not in _fonts:
        _fonts[key] = ImageFont.truetype(path, size * SS)
    return _fonts[key]


# Sound --------------------------------------------------------------------------------------------

def sine(f):
    return lambda t: np.sin(2 * np.pi * f * t)


def harmonics(f, amps):
    """A tone built from harmonics: amps[n-1] is the strength of the n-th harmonic."""
    def tone(t):
        out = np.zeros_like(t)
        for n, a in enumerate(amps, start=1):
            if a:
                out += a * np.sin(2 * np.pi * f * n * t)
        return out / max(1e-9, sum(abs(a) for a in amps))
    return tone


def mix(*tones):
    return lambda t: sum(tone(t) for tone in tones) / len(tones)


SQUARE = [1 / n if n % 2 else 0 for n in range(1, 16)]
SAW = [1 / n for n in range(1, 16)]
CLARINET_LIKE = [1, 0, 0.45, 0, 0.3, 0, 0.18, 0, 0.1]


def render_audio(scenes, duration):
    t = np.arange(int(duration * RATE)) / RATE
    out = np.zeros_like(t)
    for scene in scenes:
        tone = scene.get('tone')
        if not tone:
            continue
        a, b = scene['start'], scene['end']
        mask = (t >= a) & (t < b)
        local = t[mask]
        level = scene.get('level', 1.0)
        if callable(level):
            level = level(local - a)
        # 40 ms fades, so nothing clicks.
        fade = np.minimum(1, np.minimum((local - a) / 0.04, (b - local) / 0.04))
        out[mask] += tone(local) * level * fade * 0.32
    return np.clip(out, -1, 1)


def write_wav(path, samples):
    data = (samples * 32767).astype('<i2')
    stereo = np.repeat(data[:, None], 2, axis=1)
    with wave.open(path, 'wb') as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(stereo.tobytes())


# Drawing ------------------------------------------------------------------------------------------

def S(v):
    return int(round(v * SS))


def ease(x):
    x = max(0.0, min(1.0, x))
    return x * x * (3 - 2 * x)


def blend(color, alpha):
    return tuple(int(BG[i] + (color[i] - BG[i]) * alpha) for i in range(3))


def text(draw, xy, s, size, color=TEXT, bold=False, alpha=1.0, anchor='la'):
    draw.text((S(xy[0]), S(xy[1])), s, font=font(BOLD if bold else REGULAR, size), fill=blend(color, alpha), anchor=anchor)


def wrap(s, size, width, bold=False):
    f = font(BOLD if bold else REGULAR, size)
    words, lines, line = s.split(), [], ''
    for word in words:
        trial = f'{line} {word}'.strip()
        if f.getlength(trial) <= width * SS:
            line = trial
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    return lines


def header(draw, alpha):
    text(draw, (64, 44), COURSE, 20, MUTED, alpha=alpha)


def panel(draw, box, alpha):
    x0, y0, x1, y1 = box
    draw.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(18), fill=blend(PANEL, alpha))
    # A light grid, like graph paper.
    for i in range(1, 8):
        x = x0 + (x1 - x0) * i / 8
        draw.line((S(x), S(y0 + 12), S(x), S(y1 - 12)), fill=blend(GRID, alpha * 0.6), width=S(1))
    cy = (y0 + y1) / 2
    draw.line((S(x0 + 16), S(cy), S(x1 - 16), S(cy)), fill=blend(GRID, alpha), width=S(1.5))


def curve(draw, box, fn, color, alpha, width=4.0, amplitude=1.0):
    """fn maps u in [0, 1] across the panel to a value in [-1, 1]."""
    x0, y0, x1, y1 = box
    cy, half = (y0 + y1) / 2, (y1 - y0) / 2 - 22
    n = int((x1 - x0 - 40) * SS / 2)
    u = np.linspace(0, 1, n)
    xs = x0 + 20 + u * (x1 - x0 - 40)
    ys = cy - fn(u) * half * amplitude
    points = [(S(x), S(y)) for x, y in zip(xs, ys)]
    draw.line(points, fill=blend(color, alpha), width=S(width), joint='curve')


def caption(draw, big, small, alpha, color=TEXT):
    y = 540
    text(draw, (64, y), big, 44, color, bold=True, alpha=alpha)
    for i, line in enumerate(wrap(small, 26, 1150)):
        text(draw, (64, y + 62 + i * 36), line, 26, MUTED, alpha=alpha)


def scene_alpha(t, scene):
    return ease((t - scene['start']) / 0.45) * ease((scene['end'] - t) / 0.45)


# Scenes -------------------------------------------------------------------------------------------

def draw_title(draw, t, s, alpha):
    lines = wrap(s['title'], 64, 1100, bold=True)
    top = 250 - (len(lines) - 1) * 38
    for i, line in enumerate(lines):
        text(draw, (W / 2, top + i * 78), line, 64, TEXT, bold=True, alpha=alpha, anchor='mm')
    text(draw, (W / 2, top + len(lines) * 78 + 18), s['subtitle'], 28, MUTED, alpha=alpha, anchor='mm')
    # A short wave under the title.
    box = (W / 2 - 220, top + len(lines) * 78 + 70, W / 2 + 220, top + len(lines) * 78 + 150)
    phase = t * 0.8
    curve(draw, box, lambda u: np.sin(2 * np.pi * (2 * u - phase)) * np.clip(np.minimum(u, 1 - u) * 6, 0, 1), VIOLET, alpha, width=3.5, amplitude=0.8)


WAVE_BOX = (64, 92, W - 64, 500)


def draw_wave(draw, t, s, alpha):
    panel(draw, WAVE_BOX, alpha)
    phase = (t - s['start']) * s.get('scroll', 0.5)
    amp = s.get('amplitude', 0.8)
    shape = s.get('shape', lambda x: np.sin(2 * np.pi * x))
    cycles = s['cycles']
    # Leave room on the right for the loudness meter, when there is one.
    box = (WAVE_BOX[0], WAVE_BOX[1], WAVE_BOX[2] - (64 if 'meter' in s else 0), WAVE_BOX[3])
    curve(draw, box, lambda u: shape(cycles * u - phase), s.get('color', VIOLET), alpha, width=4.5, amplitude=amp)
    # The axes: time along, air pressure up.
    x0, y0, x1, y1 = WAVE_BOX
    text(draw, (x1 - 24, y1 - 36), 'time →', 20, MUTED, alpha=alpha, anchor='ra')
    text(draw, (x0 + 24, y0 + 20), 'air pressure', 20, MUTED, alpha=alpha)
    if s.get('window'):
        text(draw, (x1 - 24, y0 + 20), s['window'], 20, MUTED, alpha=alpha, anchor='ra')
    if 'meter' in s:
        # How loud: a bar on the right edge of the panel.
        level = s['meter']
        bx0, by1 = x1 - 46, y1 - 70
        by0 = y0 + 60
        draw.rounded_rectangle((S(bx0), S(by0), S(bx0 + 14), S(by1)), radius=S(7), fill=blend(GRID, alpha))
        top = by1 - (by1 - by0) * level
        draw.rounded_rectangle((S(bx0), S(top), S(bx0 + 14), S(by1)), radius=S(7), fill=blend(AMBER, alpha))
    caption(draw, s['label'], s['text'], alpha, s.get('color', TEXT) if s.get('tint') else TEXT)


def draw_two(draw, t, s, alpha):
    """Two tones a few hertz apart, one above the other: in a short window they look the same."""
    top = (64, 92, W - 64, 290)
    bottom = (64, 302, W - 64, 500)
    phase = (t - s['start']) * 0.4
    for box, f, color, label in ((top, 440, VIOLET, '440 Hz'), (bottom, 444, PINK, '444 Hz')):
        panel(draw, box, alpha)
        cycles = f / 100  # a 1/100-second window
        curve(draw, box, lambda u, c=cycles: np.sin(2 * np.pi * (c * u - phase)), color, alpha, width=4, amplitude=0.62)
        text(draw, (box[0] + 24, box[1] + 18), label, 22, color, bold=True, alpha=alpha)
    text(draw, (W - 88, 106), '0.01 s window', 20, MUTED, alpha=alpha, anchor='ra')
    caption(draw, s['label'], s['text'], alpha)


def draw_beats(draw, t, s, alpha):
    """440 Hz and 444 Hz together over a whole second: their sum swells and fades 4 times."""
    box = WAVE_BOX
    panel(draw, box, alpha)
    x0, y0, x1, y1 = box
    local = t - s['start']
    df = 4.0

    def envelope(u):
        return np.abs(np.cos(np.pi * df * (u + local * 0.25)))

    # The fast carrier, drawn as a filled band between the envelope's edges.
    cy, half = (y0 + y1) / 2, (y1 - y0) / 2 - 22
    n = int((x1 - x0 - 40) * SS / 2)
    u = np.linspace(0, 1, n)
    xs = x0 + 20 + u * (x1 - x0 - 40)
    env = envelope(u)
    upper = [(S(x), S(cy - e * half * 0.74)) for x, e in zip(xs, env)]
    lower = [(S(x), S(cy + e * half * 0.74)) for x, e in zip(xs[::-1], env[::-1])]
    draw.polygon(upper + lower, fill=blend((70, 52, 120), alpha))
    draw.line(upper, fill=blend(VIOLET, alpha), width=S(3), joint='curve')
    draw.line(lower, fill=blend(VIOLET, alpha), width=S(3), joint='curve')
    # Mark each beat.
    for k in range(5):
        u_peak = (k - local * 0.25) / df
        u_peak -= math.floor(u_peak)
        x = x0 + 20 + u_peak * (x1 - x0 - 40)
        top = cy - half * 0.74 - 22
        draw.ellipse((S(x - 6), S(top - 6), S(x + 6), S(top + 6)), fill=blend(AMBER, alpha))
    text(draw, (x1 - 24, y0 + 20), '1 s window', 20, MUTED, alpha=alpha, anchor='ra')
    text(draw, (x0 + 24, y1 - 38), '440 Hz + 444 Hz', 22, VIOLET, bold=True, alpha=alpha)
    text(draw, (x1 - 24, y1 - 36), 'time →', 20, MUTED, alpha=alpha, anchor='ra')
    caption(draw, s['label'], s['text'], alpha)


def draw_timbre(draw, t, s, alpha):
    """A waveform on the left, its harmonics as bars on the right."""
    left = (64, 92, 820, 500)
    right = (840, 92, W - 64, 500)
    panel(draw, left, alpha)
    amps = s['amps']
    norm = sum(abs(a) for a in amps)
    phase = (t - s['start']) * 0.35

    def raw(x):
        return sum(a * np.sin(2 * np.pi * n * x) for n, a in enumerate(amps, start=1))

    if 'peak' not in s:
        s['peak'] = float(np.max(np.abs(raw(np.linspace(0, 1, 4000)))))

    def shape(u):
        return raw(3 * u - phase) / s['peak'] * 0.78

    curve(draw, left, shape, s['color'], alpha, width=4.5)
    text(draw, (left[0] + 24, left[1] + 20), '220 Hz', 22, s['color'], bold=True, alpha=alpha)
    # Harmonics.
    x0, y0, x1, y1 = right
    draw.rounded_rectangle((S(x0), S(y0), S(x1), S(y1)), radius=S(18), fill=blend(PANEL, alpha))
    text(draw, (x0 + 24, y0 + 20), 'harmonics', 20, MUTED, alpha=alpha)
    count = 10
    gap = (x1 - x0 - 48) / count
    base = y1 - 52
    tallest = max(abs(a) for a in amps[:count]) or 1
    for i in range(count):
        a = abs(amps[i]) if i < len(amps) else 0
        h = (base - y0 - 70) * a / tallest
        bx = x0 + 24 + i * gap + gap * 0.18
        if h > 0:
            draw.rounded_rectangle((S(bx), S(base - h), S(bx + gap * 0.64), S(base)), radius=S(4), fill=blend(s['color'], alpha))
        text(draw, (bx + gap * 0.32, base + 10), str(i + 1), 18, MUTED, alpha=alpha, anchor='ma')
    del norm
    caption(draw, s['label'], s['text'], alpha)


def draw_summary(draw, t, s, alpha):
    text(draw, (W / 2, 210), s['title'], 54, TEXT, bold=True, alpha=alpha, anchor='mm')
    for i, (key, value) in enumerate(s['points']):
        y = 300 + i * 74
        a = alpha * ease((t - s['start'] - 0.5 - i * 0.6) / 0.5)
        draw.rounded_rectangle((S(250), S(y - 28), S(W - 250), S(y + 30)), radius=S(14), fill=blend(PANEL, a))
        text(draw, (284, y), key, 28, VIOLET, bold=True, alpha=a, anchor='lm')
        text(draw, (W - 284, y), value, 26, TEXT, alpha=a, anchor='rm')


DRAW = {'title': draw_title, 'wave': draw_wave, 'two': draw_two, 'beats': draw_beats, 'timbre': draw_timbre, 'summary': draw_summary}


# The clips ----------------------------------------------------------------------------------------

def seq(*scenes):
    t = 0.0
    out = []
    for length, scene in scenes:
        out.append({**scene, 'start': t, 'end': t + length})
        t += length
    return out, t


CLIPS = {
    'sound-waves': seq(
        (6, {'kind': 'title', 'title': 'What a sound wave looks like', 'subtitle': 'Lesson 1  ·  Frequency and pitch'}),
        (12, {'kind': 'wave', 'cycles': 3, 'tone': sine(220), 'window': '0.014 s window', 'label': '220 Hz  ·  the note A3',
              'text': 'The speaker pushes the air and pulls it back 220 times every second. One push and pull is one wave.'}),
        (12, {'kind': 'wave', 'cycles': 6, 'tone': sine(440), 'window': '0.014 s window', 'label': '440 Hz  ·  A4, one octave up',
              'text': 'Twice the frequency: twice as many waves fit in the same time, and we hear the same note an octave higher.'}),
        (12, {'kind': 'wave', 'cycles': 12, 'tone': sine(880), 'window': '0.014 s window', 'label': '880 Hz  ·  A5',
              'text': 'Double it again and the waves get shorter still. Each doubling is one more octave.'}),
        (8, {'kind': 'summary', 'title': 'Frequency is pitch', 'tone': None,
             'points': [('Frequency', 'waves per second, in hertz (Hz)'), ('Higher frequency', 'a higher note'), ('Twice the frequency', 'one octave up')]}),
    ),
    'loudness': seq(
        (6, {'kind': 'title', 'title': 'Loudness is amplitude', 'subtitle': 'Lesson 2  ·  How hard the air is pushed'}),
        (10, {'kind': 'wave', 'cycles': 6, 'tone': sine(440), 'level': 1.0, 'amplitude': 0.8, 'meter': 0.95, 'label': 'Loud',
              'text': 'Big swings in air pressure. The wave reaches far above and below the middle line.'}),
        (10, {'kind': 'wave', 'cycles': 6, 'tone': sine(440), 'level': 0.35, 'amplitude': 0.36, 'meter': 0.5, 'label': 'Softer',
              'text': 'The same 440 Hz, so the same note. Only the height of the wave, its amplitude, has changed.'}),
        (10, {'kind': 'wave', 'cycles': 6, 'tone': sine(440), 'level': 0.1, 'amplitude': 0.12, 'meter': 0.18, 'label': 'Quiet',
              'text': 'Small swings, a quiet sound. Our ears hear about ten times more energy as roughly twice as loud.'}),
        (8, {'kind': 'summary', 'title': 'Two separate dials', 'tone': None,
             'points': [('Amplitude', 'how loud'), ('Frequency', 'how high'), ('Change one', 'and the other stays put')]}),
    ),
    'beats': seq(
        (6, {'kind': 'title', 'title': 'Beats: two notes that almost match', 'subtitle': 'Lesson 3  ·  Interference'}),
        # One after the other (440 Hz, then 444 Hz from 12 s), not yet together.
        (12, {'kind': 'two', 'tone': lambda t: np.where(t < 12, np.sin(2 * np.pi * 440 * t), np.sin(2 * np.pi * 444 * t)),
              'label': '440 Hz, then 444 Hz',
              'text': 'Two tones only 4 Hz apart, played one after the other. Over a hundredth of a second they look almost the same.'}),
        (16, {'kind': 'beats', 'tone': mix(sine(440), sine(444)), 'label': '4 beats every second',
              'text': 'Played together they drift in and out of step: the sound swells and fades 444 − 440 = 4 times a second.'}),
        (8, {'kind': 'summary', 'title': 'Tuning by ear', 'tone': None,
             'points': [('Beat rate', 'the difference in frequency'), ('Slower beats', 'closer to in tune'), ('No beats', 'in tune')]}),
    ),
    'timbre': seq(
        (6, {'kind': 'title', 'title': 'Timbre: same note, different shapes', 'subtitle': 'Lesson 4  ·  Harmonics'}),
        (10, {'kind': 'timbre', 'amps': [1], 'tone': sine(220), 'color': SKY, 'label': 'A pure tone',
              'text': 'One frequency only. It sounds clean and a little dull, like a tuning fork.'}),
        (10, {'kind': 'timbre', 'amps': CLARINET_LIKE, 'tone': harmonics(220, CLARINET_LIKE), 'color': VIOLET, 'label': 'Odd harmonics',
              'text': 'Add 3, 5 and 7 times the frequency, quieter each time: hollow and reedy, a little like a clarinet.'}),
        (10, {'kind': 'timbre', 'amps': SAW, 'tone': harmonics(220, SAW), 'color': PINK, 'label': 'Every harmonic',
              'text': 'All of them, each a bit softer than the last: bright and buzzy, like a bowed string. Still the same note, A3.'}),
        (8, {'kind': 'summary', 'title': 'What makes instruments differ', 'tone': None,
             'points': [('Pitch', 'the lowest frequency'), ('Timbre', 'the mix of harmonics'), ('Waveform', 'the harmonics, added up')]}),
    ),
}


def render(name, out_dir):
    scenes, duration = CLIPS[name]
    os.makedirs(out_dir, exist_ok=True)
    audio = os.path.join(out_dir, f'{name}.wav')
    write_wav(audio, render_audio(scenes, duration))
    video = os.path.join(out_dir, f'{name}.mp4')
    ffmpeg = subprocess.Popen(
        ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
         '-i', audio, '-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', video],
        stdin=subprocess.PIPE)
    frames = int(duration * FPS)
    for i in range(frames):
        t = i / FPS
        image = Image.new('RGB', (W * SS, H * SS), BG)
        draw = ImageDraw.Draw(image)
        scene = next(s for s in scenes if s['start'] <= t < s['end'])
        alpha = scene_alpha(t, scene)
        header(draw, 1.0)
        DRAW[scene['kind']](draw, t, scene, alpha)
        ffmpeg.stdin.write(image.resize((W, H), Image.LANCZOS).tobytes())
    ffmpeg.stdin.close()
    if ffmpeg.wait() != 0:
        raise SystemExit(f'ffmpeg failed for {name}')
    os.remove(audio)
    print(f'{name}: {duration:.0f} s -> {video}')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    names = sys.argv[2:] or list(CLIPS)
    for name in names:
        render(name, sys.argv[1])
