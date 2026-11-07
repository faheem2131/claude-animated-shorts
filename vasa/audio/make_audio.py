# Sound for "The Warship That Sank Before Lunch" (Vasa, 1628): the synthetic voice (gain only), an original score
# (brass fanfare, timpani, pizzicato, pads, glock; ducked under the voice) and synthesized SFX, mixed to
# mix.wav (48 kHz stereo 24-bit, exactly 66.5 s, ~-15 LUFS, true peak <= -1 dBTP). Event times come from words.json
# and the shot cuts in app/src/videos/vasa/story.ts. Also writes stems (voice / music / sfx) and cues.md.
import json, os, subprocess, sys
import numpy as np
from scipy import signal
from dsp import SR, ns, tt, rng, lp, hp, bp, colored, smooth_noise, fades, ramp, modal, place, st, pan, widen, make_ir, convolve_st, integrated, true_peak, dbg, read_wav, write_wav, curve, momentary_max
import instruments as I

HERE = os.path.dirname(os.path.abspath(__file__))
VOICE = os.path.join(HERE, "..", "voice")
FPS = 30
TOTAL = 1995
DUR = TOTAL / FPS
N = ns(DUR)
CUTS = [0, 93, 205, 285, 336, 402, 473, 530, 575, 615, 660, 705, 780, 840, 925, 1005, 1080, 1112, 1206, 1272, 1400, 1455, 1518, 1608, 1695, 1760, 1830]
r0 = rng(7)
cues = []
def cue(t, what): cues.append((round(t, 2), what))

# ------------------------------------------------------------------ voice
def load_voice():
    cmd = ["ffmpeg", "-v", "error", "-y", "-i", os.path.join(VOICE, "voice.wav"), "-ar", str(SR), "-ac", "1", "-f", "f32le", "-"]
    x = np.frombuffer(subprocess.check_output(cmd), dtype=np.float32).astype(np.float64)
    buf = np.zeros(N); buf[: min(N, len(x))] = x[:N]
    return buf
def speech_env(words, pad_a=0.06, pad_b=0.18):
    e = np.zeros(N)
    for w in words:
        a, b = ns(max(0, w["start"] - pad_a)), ns(w["end"] + pad_b)
        e[a:b] = 1
    k = ns(0.12)
    return np.convolve(e, np.hanning(2 * k) / np.hanning(2 * k).sum(), "same")

# ------------------------------------------------------------------ sfx helpers
def whoosh(t, dur=0.45, vel=0.5, up=True):
    n = ns(dur); r = rng(int(t * 1000) % 9999)
    nz = r.standard_normal(n); sw = np.linspace(400, 5000, n) if up else np.linspace(5000, 400, n)
    out = np.zeros(n); blk = 512
    for i in range(0, n, blk):
        f = sw[i]; seg = nz[i:i + blk + 512]
        out[i:i + blk] = bp(seg, f * 0.6, min(f * 1.6, 20000), 1)[:min(blk, n - i)] if len(seg) > 64 else 0
    env = np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5
    return widen(out * env * vel / (np.std(out) + 1e-9) * 0.3, r)
def thud(f=55, vel=0.9, dur=0.9):
    r = rng(3); t = tt(dur); g = 1 + 0.8 * np.exp(-t / 0.05)
    y = np.sin(2 * np.pi * np.cumsum(f * g) / SR) * np.exp(-t / 0.25) + lp(r.standard_normal(len(t)), 300) * np.exp(-t / 0.05) * 0.5
    return fades(y * vel, 0.001, 0.05)
def splash(dur=1.2, vel=0.8, seed=1):
    r = rng(seed); n = ns(dur); t = np.arange(n) / SR
    y = bp(r.standard_normal(n), 500, 7000, 2) * np.exp(-t / (dur * 0.3)) + 0.5 * lp(r.standard_normal(n), 500) * np.exp(-t / (dur * 0.5))
    return widen(fades(y * vel * 0.6, 0.002, 0.1), r)
def creak(dur=1.0, f0=180, vel=0.5, seed=2, rise=1.4):
    r = rng(seed); n = ns(dur); t = np.arange(n) / SR
    f = f0 * (1 + (rise - 1) * (t / dur)) * (1 + 0.25 * smooth_noise(n, r, 14))
    ph = 2 * np.pi * np.cumsum(f) / SR
    y = np.sign(np.sin(ph)) * 0.3 + np.sin(ph) * 0.5 + 0.4 * np.sin(2.6 * ph)
    y = bp(y, 250, 2400, 2) * np.sin(np.pi * np.minimum(1, t / dur)) ** 0.6 * (1 + 0.4 * np.sin(2 * np.pi * 23 * t))
    return fades(y * vel * 0.5, 0.01, 0.1)
def murmur(dur, vel=0.5, seed=4, bright=1.0):
    r = rng(seed); n = ns(dur)
    y = np.zeros(n)
    for f0 in (300, 500, 800, 1300):
        y += bp(r.standard_normal(n), f0 * 0.8, f0 * 1.25, 2) * (1 + 0.8 * smooth_noise(n, r, 4))
    y = hp(y, 150)
    return widen(fades(y / (np.std(y) + 1e-9) * vel * 0.2 * bright, 0.2, 0.3), r)
def cheer(dur, vel=0.6, seed=5):
    r = rng(seed); n = ns(dur); t = np.arange(n) / SR
    y = np.zeros(n)
    for k in range(18):
        f0 = r.uniform(260, 460); c = r.uniform(0, dur * 0.7); w = r.uniform(0.35, 0.9)
        env = np.exp(-((t - c - w / 2) / (w / 2.2)) ** 2)
        y += env * np.sin(2 * np.pi * np.cumsum(f0 * (1 + 0.15 * np.sin(2 * np.pi * 5 * t))) / SR) * 0.15
    y += bp(r.standard_normal(n), 700, 3500, 2) * 0.35 * (1 + 0.5 * smooth_noise(n, r, 3))
    return widen(fades(y * vel * 0.5, 0.15, 0.4), r)
def wind(dur, vel=0.4, seed=6):
    r = rng(seed); n = ns(dur)
    y = bp(colored(n, r, 1.0), 200, 1800, 2) * (0.5 + 0.5 * smooth_noise(n, r, 1.5))
    return widen(fades(y * vel * 0.3, 0.8, 0.8), r)
def bubbles_snd(dur, vel=0.4, seed=8, n_b=26):
    r = rng(seed); buf = np.zeros(ns(dur))
    for _ in range(n_b):
        f = r.uniform(500, 1600); d = r.uniform(0.04, 0.09); t = tt(d); k = ns(r.uniform(0, dur - 0.1))
        s = np.sin(2 * np.pi * np.cumsum(f * (1 + 2.5 * t / d)) / SR) * np.exp(-t / (d * 0.5)) * r.uniform(0.3, 1)
        buf[k:k + len(s)] += s[: len(buf) - k]
    return widen(buf * vel * 0.5, r)
def footsteps(t0, t1, vel=0.5, seed=9):
    r = rng(seed); buf = np.zeros((2, N))
    k = t0
    while k < t1:
        g = thud(r.uniform(90, 140), 0.5, 0.18)
        place(buf, pan(g, r.uniform(-0.5, 0.5)), k, vel * r.uniform(0.4, 1.0))
        place(buf, pan(hp(r.standard_normal(ns(0.05)) * np.exp(-tt(0.05) / 0.01), 800) * 0.2, r.uniform(-0.6, 0.6)), k, vel * 0.5)
        k += r.uniform(0.05, 0.14)
    return buf
def glint(t, f=2640, vel=0.5): return I.glock(f, vel, rng(int(t * 100)), 1.4)
def drip(vel=0.5): return fades(modal(0.25, [(1500, 1.0, 0.04), (3200, 0.3, 0.02)], rng(1)) * vel, 0.0005, 0.05)

# ------------------------------------------------------------------ SFX stem
def make_sfx(words):
    buf = np.zeros((2, N)); r = rng(11)
    def P(x, t, g=1.0): place(buf, x, t, g)
    # picture cuts (skip those inside a fade / flashes)
    for c in CUTS[2:]:
        if c in (1695, 1760, 1608): continue
        P(whoosh(c / FPS - 0.12, 0.3, 0.35), c / FPS - 0.12)
    # hook: riser into the flash hit, then the flash flare
    P(whoosh(2.5, 0.65, 0.5), 2.5); P(thud(48, 0.9, 1.3), 3.1); P(splash(0.6, 0.3, 21), 3.1, 0.5); cue(3.1, "flash hit")
    # gold paint glints
    for t0 in (13.8, 14.25, 14.7): P(glint(t0), t0 - 0.02, 0.8); P(I.glock(3520, 0.4, r, 1.0), t0, 0.5)
    cue(13.8, "gold glints x3")
    # crowd cheers on the shore, sails go up
    P(cheer(3.2, 0.55, 5), 15.7); cue(15.7, "crowd cheer")
    P(murmur(60, 0.35, 4), 0.0, 0.5)
    for k, t0 in enumerate((17.7, 18.1, 18.5, 18.85)): P(splash(0.5, 0.25, 30 + k), t0, 0.5)  # canvas dropping (noise bursts)
    P(creak(1.4, 150, 0.5, 12, 1.5), 17.8); cue(17.7, "sails drop, ropes creak")
    P(wind(3.2, 0.5, 6), 19.0); cue(19.0, "breeze")
    P(creak(1.3, 170, 0.6, 13, 1.3), 20.6); P(creak(1.2, 220, 0.8, 14, 1.8), 22.0); cue(20.6, "hull groans: lean")
    P(wind(3.2, 0.9, 7), 21.8)
    P(cheer(0.9, 0.25, 6)[:, :ns(0.9)], 22.0, 0.3)
    # gasp as it leans a lot
    gp = np.zeros(ns(0.7)); gp = bp(r.standard_normal(len(gp)), 600, 2200, 2) * np.sin(np.pi * np.linspace(0, 1, len(gp))) * 0.5
    P(widen(gp, r), 22.55, 0.8); cue(22.55, "crowd gasp")
    # water pours in
    P(splash(2.8, 0.8, 41), 23.5, 0.8); P(bp(colored(ns(2.6), r, 0.8), 150, 2500, 2) * 0.35 * np.hanning(ns(2.6)), 23.6, 0.7); cue(23.5, "water pours through ports")
    # the plunge
    P(thud(45, 1.0, 1.6), 26.9); P(splash(1.8, 1.0, 51), 26.9); P(thud(38, 1.0, 1.8), 27.55); P(splash(2.0, 1.0, 52), 27.55); cue(26.9, "slam + splash"); cue(27.55, "last gulp")
    P(bubbles_snd(2.4, 0.6, 8), 27.6); cue(27.6, "bubbles")
    # silence then deadpan
    P(murmur(4, 0.15, 14), 28.2, 0.3); P(drip(0.25), 29.4, 0.6); P(drip(0.2), 30.1, 0.5)
    # the king: stinger + angry stamp
    P(thud(70, 0.7, 0.8), 33.0); cue(33.0, "king stinger")
    # tall and heavy up top: slow creak; light down low: gurgle
    P(creak(2.2, 120, 0.6, 15, 1.2), 34.4); P(splash(1.0, 0.25, 61), 36.2, 0.6)
    # canoe: wobble creaks and splashes, final splash on the tip
    for k, t0 in enumerate((37.3, 37.9, 38.45, 38.95)): P(splash(0.45, 0.22, 70 + k), t0, 0.5); 
    P(creak(1.0, 260, 0.45, 16, 1.5), 38.0)
    P(splash(1.6, 1.0, 75), 39.52); P(thud(80, 0.6, 0.5), 39.52); cue(39.52, "canoe splash")
    # dock test: boots across the deck, hull rocking, stops dead
    P(footsteps(42.5, 45.9, 0.55, 9), 0.0); P(creak(1.3, 140, 0.55, 17, 1.4), 42.9); P(creak(1.3, 150, 0.6, 18, 1.4), 44.2); cue(42.5, "30 men run: boots + rocking")
    P(thud(60, 0.8, 0.6), 45.95); cue(45.95, "stop")
    # sweat drips
    for t0 in (47.0, 47.5, 48.0): P(drip(0.5), t0, 0.7)
    # court: quill scratching / paper
    P(hp(bp(colored(ns(1.2), r, 0.5), 2500, 7000, 1), 2000) * 0.1 * np.hanning(ns(1.2)), 49.2); cue(49.2, "quill")
    P(I.brass(110, 0.5, 0.6, r, "tuba"), 52.8, 0.4)
    # underwater: muffled bubbles + low drone
    P(lp(bubbles_snd(3.0, 0.7, 9, 40), 1800), 53.6, 0.9); P(lp(colored(ns(3.0), r, 1.5), 300) * 0.08 * np.hanning(ns(3.0)), 53.6); cue(53.6, "underwater drone")
    # raising: water rushing off, wood creaking
    P(splash(3.2, 0.7, 91), 56.7, 0.7); P(creak(2.0, 130, 0.5, 19, 1.3), 57.0); P(wind(3, 0.3, 21), 56.6, 0.4); cue(56.7, "ship rises, water streams")
    # museum glow: shimmer
    P(I.glock(1760, 0.5, r, 2.0), 58.7, 0.5); P(I.glock(2217, 0.4, r, 2.0), 58.85, 0.4); P(I.glock(2637, 0.4, r, 2.2), 59.0, 0.4)
    # final: crowd, gulls
    P(murmur(5, 0.3, 24), 61.0, 0.5)
    for t0, f in ((62.0, 2400), (63.6, 2800)):
        t = tt(0.45); y = np.sin(2 * np.pi * np.cumsum(f * (1 + 0.3 * np.sin(np.pi * t / 0.45))) / SR) * np.sin(np.pi * t / 0.45) ** 2 * 0.1; P(y, t0, 0.5)
    return buf

# ------------------------------------------------------------------ music
def make_music(words):
    buf = np.zeros((2, N)); r = rng(21)
    def P(x, t, g=1.0, p=0.0): place(buf, pan(x, p) if x.ndim == 1 else x, t, g)
    Gmaj = [43, 47, 50, 55, 59, 62, 67]  # G2 B2 D3 G3 B3 D4 G4
    # --- 0-15.8: ceremonial fanfare in G, timpani on the beats, 100 bpm
    beat = 0.6
    t = 0.0; k = 0
    notes = [67, 67, 71, 74, 79, 74, 79, 78, 76, 74, 72, 71]
    for i, n in enumerate(notes):
        P(I.brass(I.m2f(n - 12), beat * 0.9, 0.7, r, "horn"), i * beat, 0.6, -0.15)
    for i in range(0, 26): P(I.timpani(I.m2f(43 if i % 2 == 0 else 50), 0.5, r, 1.2), i * beat, 0.5 if i % 4 else 0.7)
    for t0 in np.arange(0.3, 15.5, beat): P(I.snare(0.35, r), t0, 0.35, 0.2)
    for t0 in (0.0, 4.8, 9.6): P(I.cymbal(0.5, r, 2.0), t0, 0.4)
    P(I.pad([I.m2f(m) for m in (55, 59, 62, 67)], 16.0, 0.5, r, 1.5, 1.5), 0.0, 0.5)
    # --- 15.8-23.5: cheerful launch, fife + oompah, then rising tension
    mel = [74, 76, 78, 79, 78, 76, 74, 71]
    for i, n in enumerate(mel * 2): P(I.fife(I.m2f(n + 12), 0.28, 0.55, r), 15.8 + i * 0.45, 0.5, 0.3)
    for t0 in np.arange(15.8, 22.0, 0.6): P(I.brass(I.m2f(43), 0.3, 0.6, r, "tuba"), t0, 0.5); P(I.brass(I.m2f(55), 0.2, 0.5, r, "stab"), t0 + 0.3, 0.35)
    for t0 in np.arange(22.0, 26.0, 0.3): P(I.timpani(I.m2f(41), 0.6, r, 1.0), t0, 0.5 + 0.5 * (t0 - 22) / 4)
    P(I.pad([I.m2f(m) for m in (53, 56, 59, 62)], 5.0, 0.7, r, 3.5, 1.0, 700), 21.5, 0.7)
    for k, n in enumerate((71, 70, 69, 68, 67, 66, 65, 64)): P(I.brass(I.m2f(n - 12), 0.45, 0.8, r, "horn", fall=0.3), 22.6 + k * 0.5, 0.6)
    # --- 27.55 impact then silence, deadpan 28-33: sparse pizzicato + muted tuba wah
    P(I.timpani(I.m2f(36), 1.0, r, 2.5), 27.55, 0.9)
    for i, n in enumerate((55, 58, 62, 58)): P(I.pluck(I.m2f(n), 0.6, r, 0.9), 28.4 + i * 0.7, 0.5, -0.2)
    P(I.brass(I.m2f(45), 0.6, 0.6, r, "soft", fall=1.5), 30.4, 0.6); P(I.brass(I.m2f(43), 0.8, 0.6, r, "soft", fall=2.0), 31.2, 0.6)
    P(I.brass(I.m2f(38), 0.5, 0.9, r, "tuba"), 33.0, 0.8); P(I.timpani(I.m2f(33), 0.9, r, 1.5), 33.0, 0.8)
    # --- 33.5-42: curious plucks + vibes
    pat = [62, 66, 69, 66, 62, 66, 69, 74]
    for i in range(0, 20): P(I.pluck(I.m2f(pat[i % 8] - 12), 0.55, r, 0.5), 33.7 + i * 0.4, 0.45, 0.2)
    for t0 in np.arange(33.6, 41.8, 1.6): P(I.vibes(I.m2f(74), 0.4, r, 1.4), t0, 0.35, -0.3)
    # --- 42.3-45.95: frantic running: fast plucks + snare roll, then dead stop
    for i in range(0, 40): P(I.pluck(I.m2f(pat[i % 8] - 5), 0.7, r, 0.25), 42.4 + i * 0.09, 0.5, (i % 2) * 0.6 - 0.3)
    for t0, v in I.snare_roll(42.4, 45.9, 0.25, 0.9, r, 26.0): P(I.snare(v, r), t0, 0.4)
    P(I.cymbal(0.6, r, 1.2), 45.95, 0.5)
    # --- 46.5-53.5: nervous then bureaucratic: tuba waddle
    for i in range(0, 14): P(I.brass(I.m2f((43, 50)[i % 2]), 0.3, 0.55, r, "tuba"), 46.8 + i * 0.5, 0.45)
    for i, n in enumerate((67, 66, 67, 64)): P(I.fife(I.m2f(n + 12), 0.4, 0.45, r), 49.2 + i * 0.8, 0.4, 0.3)
    # --- 53.6-56.5: underwater: pad + slow vibes
    P(I.pad([I.m2f(m) for m in (45, 52, 57, 60)], 3.2, 0.7, r, 1.2, 1.2, 450, 12), 53.5, 0.6)
    for i, n in enumerate((69, 72, 76)): P(I.vibes(I.m2f(n), 0.4, r, 2.0), 54.0 + i * 0.9, 0.35, 0.3)
    # --- 56.6-61: rising, bright: pad swell + brass chord
    P(I.pad([I.m2f(m) for m in (55, 59, 62, 67, 71)], 5.2, 0.8, r, 2.4, 1.2, 1400), 56.0, 0.7)
    for i, n in enumerate((67, 71, 74, 79)): P(I.brass(I.m2f(n - 12), 0.55, 0.7, r, "horn"), 58.5 + i * 0.5, 0.55)
    P(I.timpani(I.m2f(43), 0.8, r, 2.0), 58.6, 0.7)
    # --- 61-66.5: warm resolve, glock sparkle, long final chord
    notes = [71, 74, 79, 78, 76, 74, 71, 67]
    for i, n in enumerate(notes): P(I.glock(I.m2f(n + 12), 0.45, r, 1.6), 61.2 + i * 0.5, 0.45, 0.3)
    for i, n in enumerate((79, 74, 71, 67)): P(I.brass(I.m2f(n - 12), 1.2 if i == 3 else 0.55, 0.7, r, "horn"), 61.0 + i * 0.6, 0.5)
    P(I.pad([I.m2f(m) for m in (43, 55, 59, 62, 67, 71)], 5.0, 0.9, r, 1.0, 2.5, 1300), 61.4, 0.7)
    P(I.timpani(I.m2f(43), 0.9, r, 3.0), 63.7, 0.8); P(I.cymbal(0.6, r, 3.0), 63.7, 0.4)
    return buf

# ------------------------------------------------------------------ mix
def main():
    words = json.load(open(os.path.join(VOICE, "words.json")))
    voice = load_voice(); sp = speech_env(words)
    sfx = make_sfx(words); music = make_music(words)
    # a touch of room on the music so it sits behind the voice
    ir = make_ir(0.9, 3)
    music = 0.8 * music + 0.35 * convolve_st(music, ir)
    # underwater low-pass for shot 24 (53.6 - 56.5)
    a, b = ns(53.6), ns(56.5); m = np.ones(N); 
    # duck music under speech (-6 dB), sfx under speech (-3 dB)
    duck_m = 1 - (1 - dbg(-6.0)) * sp; duck_s = 1 - (1 - dbg(-3.0)) * sp
    music = music * duck_m; sfx = sfx * duck_s
    # levels: voice reference -> music about -10 LU under it, sfx peaks about -6 dB re voice
    def lufs(x): return integrated(st(x))
    v = st(voice)
    for name, x, rel in (("music", music, -11.0), ("sfx", sfx, -12.0)):
        pass
    music *= dbg(lufs(v) - 11.0 - lufs(music)); sfx *= dbg(lufs(v) - 11.0 - lufs(sfx))
    mix = v + music + sfx
    # master: -15 LUFS then a soft limiter for true peak <= -1 dBTP
    mix *= dbg(-15.0 - lufs(mix))
    for _ in range(6):
        pk = true_peak(mix)
        if pk <= -1.2: break
        mix = np.tanh(mix * 1.0 / dbg(-1.2)) * dbg(-1.2) if pk > 2 else mix * dbg(-1.2 - pk)
    mix *= dbg(-15.0 - lufs(mix)) if true_peak(mix * dbg(-15.0 - lufs(mix))) <= -1.0 else 1.0
    for _ in range(4):
        pk = true_peak(mix)
        if pk <= -1.0: break
        mix *= dbg(-1.1 - pk)
    write_wav(os.path.join(HERE, "mix.wav"), mix)
    for name, x in (("stem_voice", v), ("stem_music", music), ("stem_sfx", sfx)): write_wav(os.path.join(HERE, name + ".wav"), x * 1.0)
    with open(os.path.join(HERE, "cues.md"), "w") as f:
        f.write("# Vasa SFX cues\n\n" + "\n".join(f"- {t:6.2f} s  {w}" for t, w in sorted(cues)) + "\n")
    print(f"mix: {DUR:.3f} s, integrated {lufs(mix):.1f} LUFS, true peak {true_peak(mix):.2f} dBTP, momentary max {momentary_max(mix):.1f} LUFS")

if __name__ == "__main__":
    main()
