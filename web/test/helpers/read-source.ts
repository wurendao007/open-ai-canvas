// 部分用例直接读产品源码，断言里写的是 \n。仓库以 CRLF 检出时这些断言永远匹配不上，
// 失败与被断言的代码是否正确无关。这里在读取时把行尾统一成 LF，让断言只关心代码本身，
// 而不是工作区的检出方式（也就不需要批量改动仓库的 CRLF）。
export async function readSourceText(url: URL) {
    const source = await Bun.file(url).text();
    return source.replace(/\r\n/g, "\n");
}
