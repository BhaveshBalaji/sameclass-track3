import OpusScript from 'opusscript';

/** Discord Opus is decoded directly at 16 kHz mono by libopus's resampler. */
export class SpeechDecoder {
  private codec = new OpusScript(16000, 1, OpusScript.Application.VOIP);
  decode(packet: Buffer): Buffer { return this.codec.decode(packet); }
  close(): void { this.codec.delete(); }
}

/** ElevenLabs mono 16-bit PCM -> Discord 48 kHz stereo raw PCM. */
export function discordPCM(input: Buffer, rate: number): Buffer {
  if (![16000, 24000, 48000].includes(rate) || input.length % 2) throw new Error('Unsupported voice audio format.');
  const repeat = 48000 / rate;
  const result = Buffer.alloc(input.length * repeat * 2);
  for (let offset = 0, out = 0; offset < input.length; offset += 2) {
    const sample = input.readInt16LE(offset);
    for (let n = 0; n < repeat; n++) {
      result.writeInt16LE(sample, out); result.writeInt16LE(sample, out + 2); out += 4;
    }
  }
  return result;
}

export function speechEnergy(pcm: Buffer): number {
  let sum = 0;
  for (let n = 0; n + 1 < pcm.length; n += 2) sum += pcm.readInt16LE(n) ** 2;
  return pcm.length ? Math.sqrt(sum / (pcm.length / 2)) : 0;
}

/** Reject quiet comfort-noise packets and isolated clicks before opening ASR or interrupting. */
export class SpeechActivityGate {
  private consecutive=0;
  detected=false;
  constructor(private threshold=1000){}
  push(pcm:Buffer):boolean{
    if(this.detected)return false;
    this.consecutive=speechEnergy(pcm)>this.threshold?this.consecutive+1:0;
    if(this.consecutive<3)return false;
    this.detected=true;return true;
  }
}
