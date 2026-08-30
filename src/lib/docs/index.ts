import { searchKey } from '@/lib/format';
import type { User } from '@/lib/types';
import { CONFIG_DOCS } from './articles/config';
import { DAILY_DOCS } from './articles/daily';
import { DATA_DOCS } from './articles/data';
import { PEOPLE_DOCS } from './articles/people';
import type { DocArticle, DocGroupKey } from './types';

export type { DocArticle, DocBlock, DocGroupKey, DocMarker, DocShot } from './types';

export const DOC_GROUPS: { key: DocGroupKey; label: string }[] = [
  { key: 'daily', label: 'Nghiệp vụ hằng ngày' },
  { key: 'people', label: 'Nhân sự & phân quyền' },
  { key: 'config', label: 'Cấu hình hệ thống' },
  { key: 'data', label: 'Số liệu & xuất dữ liệu' },
];

export const ALL_DOCS: DocArticle[] = [
  ...DAILY_DOCS,
  ...PEOPLE_DOCS,
  ...CONFIG_DOCS,
  ...DATA_DOCS,
];

export const docBySlug = (slug: string): DocArticle | undefined =>
  ALL_DOCS.find((d) => d.slug === slug);

/**
 * Bài người này ĐƯỢC THẤY. Điều kiện của từng bài trùng điều kiện hiện màn
 * tương ứng trên sidebar — nhân viên chỉ đọc được hướng dẫn của màn mình mở
 * được, không gặp bài dạy một màn mình không có.
 */
export const docsFor = (user: User | null): DocArticle[] =>
  user ? ALL_DOCS.filter((d) => d.visibleTo(user)) : [];

/**
 * Từ để hỏi trong câu tìm kiếm — "làm sao", "cách", "thế nào", "hướng dẫn"…
 * Người dùng gõ cả câu hỏi, mà bắt khớp đủ mọi từ thì "làm sao thêm mã" trượt
 * bài "Thêm mã giới thiệu" chỉ vì hai chữ "làm sao". Đã bỏ dấu sẵn.
 */
const QUERY_STOPWORDS = new Set([
  'lam', 'sao', 'cach', 'nao', 'the', 'o', 'dau', 'gi', 'la', 'nhu',
  'huong', 'dan', 'toi', 'minh', 'muon', 'can', 'de', 'bi',
]);

/**
 * Khoá tìm kiếm của một bài, HAI tầng — dựng một lần, bài là hằng số.
 *
 * `head` là tiêu đề, mô tả và từ khoá: những chữ nói bài NÀY về cái gì.
 * `full` thêm trọn thân bài, nên nó bắt được cả chữ chỉ xuất hiện trong một
 * bước hay một chú giải.
 *
 * Tách hai tầng vì quét cả thân bài làm từ phổ biến vô dụng: gõ "quà" thì 18
 * trên 23 bài đều có chữ đó ở đâu đó. Xem `searchDocs`.
 */
type Haystack = { head: string; full: string };
const haystacks = new Map<string, Haystack>();

/**
 * `searchKey` ở CẢ hai đầu — từ người gõ và khoá của bài đều phải bỏ dấu,
 * thường hoá như nhau. Dấu câu đổi thành khoảng trắng để `hasTerm` nhìn thấy
 * biên tiếng: giữ lại thì "hồ sơ." nuốt mất biên sau chữ cuối.
 *
 * Chữ đậm `**…**` là mã trình bày, không phải nội dung.
 */
const keyOf = (parts: string[]): string =>
  searchKey(parts.join(' ').replaceAll('**', '').replace(/[^\p{L}\p{N}]+/gu, ' '));

function haystackOf(article: DocArticle): Haystack {
  const cached = haystacks.get(article.slug);
  if (cached) return cached;

  const headParts: string[] = [article.title, article.summary, ...article.keywords];
  if (article.screen) headParts.push(article.screen);

  const bodyParts: string[] = [];
  for (const block of article.blocks) {
    if (block.kind === 'text' || block.kind === 'note') bodyParts.push(block.body);
    if (block.kind === 'steps') bodyParts.push(...block.items);
    if (block.kind === 'shot') bodyParts.push(...block.shot.markers.map((m) => m.label));
  }

  const head = keyOf(headParts);
  const entry: Haystack = { head, full: `${head} ${keyOf(bodyParts)}` };
  haystacks.set(article.slug, entry);
  return entry;
}

/**
 * Một từ khớp khi nó là TRỌN một tiếng trong bài.
 *
 * `matchesSearch` của `lib/format` khớp chuỗi con ở bất kỳ đâu, hợp cho tên
 * người nhưng sai ở đây: tiếng Việt bỏ dấu có nhiều tiếng ngắn nằm lọt trong
 * tiếng khác. Gõ `ấp` thì `ap` khớp trong `cap`, `pham` — câu hỏi trả về 9 trên
 * 15 bài. Chặn mỗi biên trái vẫn chưa đủ: `qua` khớp tiền tố của `quan ly`,
 * `quay lai`, nên gõ `quà` ra 8 bài.
 *
 * Người dùng gõ bằng bộ gõ tiếng Việt nên họ gõ đủ tiếng. Đòi khớp trọn tiếng
 * vì vậy không cản đường ai, và nó là hành vi đoán trước được.
 */
function hasTerm(haystack: string, term: string): boolean {
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(term, from);
    if (at === -1) return false;
    const end = at + term.length;
    const leftOk = at === 0 || haystack[at - 1] === ' ';
    const rightOk = end === haystack.length || haystack[end] === ' ';
    if (leftOk && rightOk) return true;
    from = at + 1;
  }
}

/**
 * Lọc bài theo câu hỏi tự nhiên: "làm sao thêm mã giới thiệu" → bài Thêm mã.
 *
 * Hỏi tầng `head` trước và trả về ngay khi có bài khớp. Chỉ khi không bài nào
 * khớp tiêu đề mới quét trọn thân bài. Cách này giữ câu hỏi hẹp vẫn tìm ra chữ
 * nằm sâu trong một bước, mà từ phổ biến không kéo về gần hết danh sách: gõ
 * "quà" ra ba bài về quà, không phải 18 bài có nhắc tới quà.
 */
export function searchDocs(articles: DocArticle[], query: string): DocArticle[] {
  const allTerms = searchKey(query).split(' ').filter(Boolean);
  if (allTerms.length === 0) return articles;

  const terms = allTerms.filter((t) => !QUERY_STOPWORDS.has(t));
  // Câu toàn từ để hỏi thì giữ nguyên — lọc sạch rồi trả về đủ bài là vô nghĩa.
  const effective = terms.length > 0 ? terms : allTerms;
  const matches = (key: string) => effective.every((t) => hasTerm(key, t));

  const byHead = articles.filter((a) => matches(haystackOf(a).head));
  return byHead.length > 0 ? byHead : articles.filter((a) => matches(haystackOf(a).full));
}
