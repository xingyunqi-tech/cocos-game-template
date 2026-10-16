import { AudioClip } from 'cc';
import { oops } from 'db://oops-framework/core/Oops';
import { loadAsset } from '../config/Bundles';

export interface SoundRef {
    bundle: string;
    path: string;
}

const RETRY_AFTER_MS = 10000;

/** 按 Bundle 与路径播放音乐、音效，资源加载后缓存；开关与音量由 oops.audio 管理 */
export class SoundService {
    private clips: Record<string, Promise<AudioClip | null>> = {};
    private failedAt: Record<string, number> = {};
    private lastMusic: { ref: SoundRef; loop: boolean } | null = null;
    private musicRequest = 0;

    clip(ref: SoundRef): Promise<AudioClip | null> {
        const key = `${ref.bundle}:${ref.path}`;
        if (Date.now() - (this.failedAt[key] ?? -Infinity) < RETRY_AFTER_MS) return Promise.resolve(null);
        this.clips[key] ??= loadAsset(ref.bundle, ref.path, AudioClip).then(
            (clip) => {
                clip.addRef();
                return clip;
            },
            (err: unknown) => {
                console.warn(`[game-core] 音频加载失败 ${key}`, err);
                delete this.clips[key];
                this.failedAt[key] = Date.now();
                return null;
            },
        );
        return this.clips[key];
    }

    /** 记录为当前背景音乐；音乐开关关闭时不播放并返回 false，打开开关后由 resumeMusic 播放；加载期间被新的播放或停止取代时返回 false */
    async playMusic(ref: SoundRef, loop = true): Promise<boolean> {
        this.lastMusic = { ref, loop };
        const request = ++this.musicRequest;
        const clip = await this.clip(ref);
        if (request !== this.musicRequest) return false;
        if (!clip || !oops.audio?.music || !oops.audio.music.getSwitch()) return false;
        oops.audio.playMusic(clip, { loop });
        return true;
    }

    resumeMusic(): Promise<boolean> {
        return this.lastMusic ? this.playMusic(this.lastMusic.ref, this.lastMusic.loop) : Promise.resolve(false);
    }

    stopMusic() {
        this.lastMusic = null;
        this.musicRequest++;
        oops.audio?.music?.stop();
    }

    async playEffect(ref: SoundRef): Promise<boolean> {
        const clip = await this.clip(ref);
        if (!clip || !oops.audio) return false;
        return oops.audio.playEffect(clip) !== null;
    }
}
