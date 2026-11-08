const STOPWORDS = new Set([
  '的', '了', '是', '在', '和', '与', '或', '对', '为', '中', '及', '也', '就',
  '都', '而', '着', '从', '到', '把', '被', '让', '向', '于', '之', '其', '此',
  '这', '那', '有', '无', '我们', '你们', '他们', '什么', '如何', '怎么', '可以',
  '请', '吗', '呢', '啊', 'the', 'a', 'an', 'is', 'are', 'was', 'were', 'of',
  'to', 'in', 'on', 'for', 'and', 'or', 'with', 'by', 'at', 'as', 'it', 'this', 'that'
]);

// 中文按 bigram 切分：FTS5 默认分词器不支持中文，bigram 是无外部依赖下召回最稳的方案
export function tokenize(text) {
  const tokens = [];
  const re = /[\u4e00-\u9fff\u3400-\u4dbf]+|[A-Za-z0-9_]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const seg = m[0];
    if (/^[A-Za-z0-9_]+$/.test(seg)) {
      tokens.push(seg.toLowerCase());
    } else if (seg.length === 1) {
      tokens.push(seg);
    } else {
      for (let i = 0; i < seg.length - 1; i++) tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

export function contentTokens(text) {
  return tokenize(text).filter((t) => !STOPWORDS.has(t));
}

export function orExpr(tokens) {
  const uniq = [...new Set(tokens)].filter((t) => t && !t.includes('"'));
  if (!uniq.length) return null;
  return uniq.map((t) => `"${t}"`).join(' OR ');
}

export { STOPWORDS };
