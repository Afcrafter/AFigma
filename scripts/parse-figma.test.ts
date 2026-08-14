/**
 * Figma 链接解析表驱动自测。
 * 运行：npm run test:parse
 */
import { parseFigmaUrl } from "../lib/figma";

type Expect = { fileKey: string; nodeId?: string } | null;

const cases: [string, Expect][] = [
  // 经典 file 链接 + URL 编码 node-id（0%3A1 → 0:1）
  [
    "https://www.figma.com/file/abc123/name?node-id=0%3A1",
    { fileKey: "abc123", nodeId: "0:1" },
  ],
  // design 链接 + 新版连字符 node-id（12-34 → 12:34）
  [
    "https://www.figma.com/design/xyz789/name?node-id=12-34",
    { fileKey: "xyz789", nodeId: "12:34" },
  ],
  // node-id 后跟其他 query 参数
  [
    "https://www.figma.com/file/K1/name?node-id=1%3A2&t=xxx&mode=dev",
    { fileKey: "K1", nodeId: "1:2" },
  ],
  // 无 node-id
  ["https://www.figma.com/file/abc123/name", { fileKey: "abc123", nodeId: undefined }],
  // 无查询串
  ["https://www.figma.com/design/xyz789", { fileKey: "xyz789", nodeId: undefined }],
  // 老式冒号 node-id（未编码）
  [
    "https://www.figma.com/file/abc/name?node-id=0:1",
    { fileKey: "abc", nodeId: "0:1" },
  ],
  // 非 Figma 链接
  ["https://example.com/not-figma", null],
  // 含中文路径片段
  [
    "https://www.figma.com/file/Z9abcdef/用户中心设计?node-id=42-7",
    { fileKey: "Z9abcdef", nodeId: "42:7" },
  ],
];

let pass = 0;
let fail = 0;

for (const [input, expected] of cases) {
  const got = parseFigmaUrl(input);
  const ok =
    got === null && expected === null
      ? true
      : got !== null &&
        expected !== null &&
        got.fileKey === expected.fileKey &&
        (got.nodeId ?? undefined) === (expected.nodeId ?? undefined);
  if (ok) {
    pass++;
    console.log(`✅ ${input}\n   → ${JSON.stringify(got)}`);
  } else {
    fail++;
    console.log(`❌ ${input}\n   期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(got)}`);
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
if (fail > 0) process.exit(1);
