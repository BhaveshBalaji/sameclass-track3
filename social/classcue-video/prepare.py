"""Prepare caption timing and original audio layers for the HyperFrames composition."""
from pathlib import Path
import json, math, random, struct, subprocess, wave

ROOT = Path(__file__).resolve().parent
FF = ROOT / 'node_modules/ffmpeg-static/ffmpeg'

def ff(*args):
    subprocess.run([str(FF), '-hide_banner', '-loglevel', 'error', '-y', *map(str,args)], check=True)

def clock(t):
    return t + .35 + (1.1 if t >= 15.18 else 0) + (.6 if t >= 18 else 0)

words = json.loads((ROOT/'assets/words.json').read_text())
# Phrase boundaries preserve names such as Rate My Professors intact.
ends=[3,5,12,14,17,22,25,27,32,36,40,43,44,48,52,54,58]
groups=[]
begin=0
for end in ends:
    groups.append(words[begin:end+1]);begin=end+1
captions=[]
for i,g in enumerate(groups):
    start=clock(g[0]['start']); end=clock(g[-1]['end'])+.22
    if i+1<len(groups):end=clock(groups[i+1][0]['start'])-.025
    captions.append(dict(text=' '.join(w['text'] for w in g),start=round(start,3),end=round(end,3)))
(ROOT/'captions.js').write_text('const CAPTIONS = '+json.dumps(captions,ensure_ascii=False,indent=2)+';\n')

def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(ROOT/'classcue-captions.srt').write_text('\n\n'.join(f"{i+1}\n{stamp(c['start'])} --> {stamp(c['end'])}\n{c['text']}" for i,c in enumerate(captions))+'\n')

def synth(name,duration,fn):
    rate=48000
    with wave.open(str(ROOT/'assets'/name),'wb') as f:
        f.setnchannels(1);f.setsampwidth(2);f.setframerate(rate)
        f.writeframes(b''.join(struct.pack('<h',max(-32767,min(32767,int(fn(i/rate)*32767)))) for i in range(round(rate*duration))))

rng=random.Random(16)
synth('swoosh.wav',.3,lambda t:.11*rng.uniform(-1,1)*math.sin(math.pi*t/.3)**2)
synth('chime.wav',.85,lambda t:.16*(math.sin(2*math.pi*880*t)+.45*math.sin(2*math.pi*1320*t))*math.exp(-t*6)*min(1,t/.009))

ff('-i',ROOT/'assets/music.mp3','-af','loudnorm=I=-27:TP=-8:LRA=6,afade=t=in:d=0.7,afade=t=out:st=26.5:d=1.5','-ar','48000',ROOT/'assets/music-bed.wav')

# Every sound is placed in film time; speech is normalized independently.
layers=[('voice.wav',.35,1,26.26),('music-bed.wav',0,1,28),
        ('typing.mp3',.56,.25,.85),('typing.mp3',3.01,.2,.65),('typing.mp3',4.03,.18,.55),
        ('swoosh.wav',1.44,.65,.3),('swoosh.wav',3.64,.45,.3),('swoosh.wav',4.58,.45,.3),
        ('pop.mp3',5.33,.25,.55),('pop.mp3',6.63,.18,.55),('pop.mp3',8.36,.18,.55),('pop.mp3',9.73,.18,.55),
        ('pop.mp3',11.32,.2,.55),('pop.mp3',11.86,.2,.55),('pop.mp3',12.44,.2,.55),
        ('swoosh.wav',14.5,.5,.3),('typing.mp3',16.83,.15,.5),('pop.mp3',17.65,.23,.55),
        ('swoosh.wav',20.04,.5,.3),('chime.wav',22.35,.6,.85)]
args=[];filters=[]
for i,(name,start,vol,dur) in enumerate(layers):
    args+=['-i',ROOT/'assets'/name]
    filters.append(f'[{i}:a]atrim=duration={dur},asetpts=PTS-STARTPTS,volume={vol},adelay={round(start*1000)}:all=1[a{i}]')
filters.append(''.join(f'[a{i}]' for i in range(len(layers)))+f'amix=inputs={len(layers)}:normalize=0:duration=longest,alimiter=limit=0.84:level=0,apad=whole_dur=28,atrim=duration=28[mix]')
ff(*args,'-filter_complex',';'.join(filters),'-map','[mix]','-ar','48000','-ac','2',ROOT/'assets/final-mix.wav')
print(f'Prepared {len(captions)} caption groups and {len(layers)} audio layers.')
