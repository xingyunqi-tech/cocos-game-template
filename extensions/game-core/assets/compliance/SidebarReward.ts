export interface SidebarRewardStore {
    get(): { lastClaimDay: string };
    set(value: { lastClaimDay: string }): void;
}

export interface SidebarRewardOptions {
    store: SidebarRewardStore;
    launchedFromSidebar: () => boolean;
    /** 存档可用（已登录）时才允许领取 */
    ready?: () => boolean;
    now?: () => Date;
}

function dayKey(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
}

/** 从侧边栏进入时每天可领取一次 */
export class SidebarReward {
    constructor(private readonly options: SidebarRewardOptions) {}

    claimedToday(): boolean {
        return this.options.store.get().lastClaimDay === this.today();
    }

    canClaim(): boolean {
        if (this.options.ready && !this.options.ready()) return false;
        return this.options.launchedFromSidebar() && !this.claimedToday();
    }

    claim(): boolean {
        if (!this.canClaim()) return false;
        this.options.store.set({ lastClaimDay: this.today() });
        return true;
    }

    private today(): string {
        return dayKey((this.options.now ?? (() => new Date()))());
    }
}
