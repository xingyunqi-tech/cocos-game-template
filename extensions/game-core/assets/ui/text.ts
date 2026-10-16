/** 按行拆分，每行单独渲染，避免单个 Label 超出文本画布上限 */
export function splitLines(text: string): string[] {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/\n+$/, '')
        .split('\n')
        .map((line) => line.trimEnd());
}
