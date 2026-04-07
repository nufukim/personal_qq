/**
 * 将 Markdown 格式的文本转为 QQ 纯文本可读格式。
 * 保留内容语义，去除在纯文本中显示杂乱的标记。
 */
export function stripMarkdown(text: string): string {
  let result = text

  // 代码块：保留内容，去掉 ``` 和语言标识
  result = result.replace(/```\w*\n?([\s\S]*?)```/g, (_m, code: string) => code.trimEnd())

  // 图片链接：完全去掉（bot 无法发送图片）
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '')

  // 超链接：[text](url) → text (url)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')

  // 标题：## Header → 【Header】
  result = result.replace(/^#{1,6}\s+(.+)$/gm, '【$1】')

  // 粗体+斜体：***text*** 或 ___text___
  result = result.replace(/\*{3}(.+?)\*{3}/g, '$1')
  result = result.replace(/_{3}(.+?)_{3}/g, '$1')

  // 粗体：**text** 或 __text__
  result = result.replace(/\*{2}(.+?)\*{2}/g, '$1')
  result = result.replace(/_{2}(.+?)_{2}/g, '$1')

  // 斜体：*text* 或 _text_（不匹配乘法/下划线变量名）
  result = result.replace(/(?<!\w)\*([^\s*](?:.*?[^\s*])?)\*(?!\w)/g, '$1')
  result = result.replace(/(?<!\w)_([^\s_](?:.*?[^\s_])?)_(?!\w)/g, '$1')

  // 删除线：~~text~~
  result = result.replace(/~~(.+?)~~/g, '$1')

  // 分隔线：--- 或 *** 或 ___
  result = result.replace(/^[-*_]{3,}\s*$/gm, '————')

  // 行内代码：保留内容，去掉反引号
  result = result.replace(/`([^`]+)`/g, '$1')

  // 引用：> text → text（保留缩进感）
  result = result.replace(/^>\s?/gm, '│ ')

  // 清理多余空行（超过两个连续空行压缩为两个）
  result = result.replace(/\n{3,}/g, '\n\n')

  return result.trim()
}
