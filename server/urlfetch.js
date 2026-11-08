import * as cheerio from 'cheerio';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

export async function fetchUrl(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000)
  });
  if (!res.ok) throw new Error(`抓取失败 HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('html') && !contentType.includes('text')) {
    const text = await res.text();
    return { title: url, text };
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  $('script, style, noscript, iframe, svg, header, footer, nav, aside').remove();

  const title =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('title').text().trim() ||
    $('h1').first().text().trim() ||
    url;

  let text = '';
  for (const sel of ['#js_content', '.rich_media_content', 'article', 'main', '#content', 'body']) {
    const el = $(sel).first();
    if (el.length) {
      const t = el
        .text()
        .replace(/[ \t\u00a0]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
      if (t.length > text.length) text = t;
      if (text.length > 200) break;
    }
  }
  if (!text) throw new Error('页面正文提取为空');
  return { title, text };
}
