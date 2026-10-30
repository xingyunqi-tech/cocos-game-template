export interface PayItem {
    /** 业务商品 ID，由服务端定义 */
    productId: string;
    /** 价格，单位分 */
    price: number;
    title?: string;
    /** 透传给服务端的订单附加信息；微信虚拟支付的 signData、paySig、signature 由服务端生成后放在这里 */
    extra?: Record<string, unknown>;
}

export type PayFailReason =
    'unsupported' | 'not_logged_in' | 'cancelled' | 'order_failed' | 'pay_failed' | 'busy' | 'timeout';

export interface PayResult {
    /** pending：平台已受理但结果未确认（如回调丢失、需客服或兑换流程），以 queryOrder 或服务端通知为准 */
    result: 'success' | 'failed' | 'pending';
    /** 服务端订单号，成功时存在；发货以服务端回调为准 */
    orderId?: string;
    reason?: PayFailReason;
    errCode?: number;
}

export interface PendingOrder {
    orderId: string;
    item: PayItem;
    time: number;
}

/** 保存 pending 订单，补单时读取；读写都针对当前用户 */
export interface OrderStore {
    load(): PendingOrder[];
    save(orders: PendingOrder[]): void;
}

export interface PayHooks {
    /** 服务端订单创建后调用，超时返回的 pending 结果带上该订单号 */
    onOrder(orderId: string): void;
}

/** 发货流程：客户端 pay → 服务端创建订单并调起平台支付 → 平台回调服务端 → 服务端发货 → 客户端查询订单或收到推送 */
export interface IPayment {
    readonly supported: boolean;
    pay(item: PayItem, hooks?: PayHooks): Promise<PayResult>;
    /** 查询订单状态，用于 pending 订单与登录后补单；failed 表示订单已关闭，查询本身失败时 reject 或返回 pending */
    queryOrder?(orderId: string): Promise<PayResult>;
}
