import { Asset, assetManager, type AssetManager } from 'cc';

type Bundle = AssetManager.Bundle;

export function loadBundle(name: string): Promise<Bundle> {
    const loaded = assetManager.getBundle(name);
    if (loaded) return Promise.resolve(loaded);
    return new Promise((resolve, reject) => {
        assetManager.loadBundle(name, (err, bundle) => (err ? reject(err) : resolve(bundle)));
    });
}

/** 加载 Bundle 并预加载其中全部资源，onProgress 取值 0 到 1 */
export async function preloadBundle(name: string, onProgress?: (ratio: number) => void): Promise<Bundle> {
    const bundle = await loadBundle(name);
    let reported = 0;
    await new Promise<void>((resolve, reject) => {
        bundle.preloadDir(
            '',
            (finished, total) => {
                reported = Math.max(reported, total > 0 ? finished / total : 1);
                onProgress?.(reported);
            },
            (err) => (err ? reject(err) : resolve()),
        );
    });
    onProgress?.(1);
    return bundle;
}

export function loadAsset<T extends Asset>(
    bundleName: string,
    path: string,
    type: new (...args: never[]) => T,
): Promise<T> {
    return loadBundle(bundleName).then(
        (bundle) =>
            new Promise<T>((resolve, reject) => {
                bundle.load(path, type as unknown as typeof Asset, (err: Error | null, asset: Asset) => {
                    if (err) reject(err);
                    else resolve(asset as T);
                });
            }),
    );
}

const BUILTIN_BUNDLES: readonly string[] = ['resources', 'main', 'internal', 'start-scene'];

export function assertReleasable(name: string) {
    if (BUILTIN_BUNDLES.includes(name)) throw new Error(`引擎内置 Bundle ${name} 不能释放`);
}

/** 释放 Bundle 内全部资源并移除 Bundle；未加载时返回 false，引擎内置 Bundle 抛错 */
export function unloadBundle(name: string): boolean {
    assertReleasable(name);
    const bundle = assetManager.getBundle(name);
    if (!bundle) return false;
    bundle.releaseAll();
    assetManager.removeBundle(bundle);
    return true;
}
