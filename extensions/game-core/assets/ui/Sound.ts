import { AudioClip, AudioSource } from 'cc';
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
    private pausedForAd: number | null = null;

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

    /** 记录为当前背景音乐；音乐开关关闭时不播放并返回 false，打开开关后由 resumeMusic 播放；加载期间被新的播放或停止取代时返回 false；不循环的音乐播完后清除当前背景音乐 */
    async playMusic(ref: SoundRef, loop = true): Promise<boolean> {
        this.lastMusic = { ref, loop };
        const request = ++this.musicRequest;
        const clip = await this.clip(ref);
        if (request !== this.musicRequest) return false;
        if (!clip || !oops.audio?.music || !oops.audio.music.getSwitch()) return false;
        const onPlayComplete = () => {
            if (request === this.musicRequest) this.lastMusic = null;
        };
        oops.audio.playMusic(clip, loop ? { loop } : { loop, onPlayComplete });
        return true;
    }

    /** 从头播放当前背景音乐；没有当前背景音乐时返回 false */
    resumeMusic(): Promise<boolean> {
        return this.lastMusic ? this.playMusic(this.lastMusic.ref, this.lastMusic.loop) : Promise.resolve(false);
    }

    stopMusic() {
        this.lastMusic = null;
        this.musicRequest++;
        oops.audio?.music?.stop();
    }

    /** 暂停正在播放的背景音乐，供广告展示期间使用 */
    pauseForAd() {
        const music = oops.audio?.music;
        if (!music?.getComponent(AudioSource)?.playing) return;
        music.pause();
        this.pausedForAd = this.musicRequest;
    }

    /** 恢复 pauseForAd 暂停的音乐；期间播放了其他音乐、停止了音乐或关闭了音乐开关时不恢复 */
    resumeAfterAd() {
        const request = this.pausedForAd;
        this.pausedForAd = null;
        const music = oops.audio?.music;
        if (request === null || request !== this.musicRequest || !this.lastMusic || !music?.getSwitch()) return;
        music.resume();
    }

    /** 丢弃该 Bundle 的音频缓存并归还引用；当前背景音乐来自该 Bundle 时停止播放 */
    forgetBundle(bundle: string) {
        if (this.lastMusic?.ref.bundle === bundle) this.stopMusic();
        const prefix = `${bundle}:`;
        for (const key of Object.keys(this.clips)) {
            if (!key.startsWith(prefix)) continue;
            void this.clips[key].then((clip) => clip?.decRef(false));
            delete this.clips[key];
        }
        for (const key of Object.keys(this.failedAt)) if (key.startsWith(prefix)) delete this.failedAt[key];
    }

    async playEffect(ref: SoundRef): Promise<boolean> {
        const clip = await this.clip(ref);
        if (!clip || !oops.audio) return false;
        return oops.audio.playEffect(clip) !== null;
    }
}
