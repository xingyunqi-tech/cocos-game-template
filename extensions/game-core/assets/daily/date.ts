const DAY_MS = 86_400_000;

/** 日期回拨的容忍天数：记录日期比今天晚不超过该天数时视为回拨，更晚视为错误日期 */
export const ROLLBACK_TOLERANCE_DAYS = 2;

/** YYYY-MM-DD 转为自 1970-01-01 起的天数 */
export function dayNumber(date: string): number {
    return Math.floor(Date.parse(`${date}T00:00:00Z`) / DAY_MS);
}

/** last 比 today 晚 1 到 ROLLBACK_TOLERANCE_DAYS 天，即本机或服务器日期回拨 */
export function isRollback(last: string, today: string): boolean {
    if (last === '' || today >= last) return false;
    return dayNumber(last) - dayNumber(today) <= ROLLBACK_TOLERANCE_DAYS;
}
