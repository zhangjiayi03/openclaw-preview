// 自动标签推断：基于文件名 / 元数据关键词匹配
// 规则：每个标签对应一组关键词（中英文），文本中出现任一关键词即打上该标签

export const TAG_RULES = [
  { name: '小说',    color: '#c0584a', keywords: ['小说','novel','fiction','story','短篇','长篇','连载'] },
  { name: '文学',    color: '#a04a7a', keywords: ['文学','散文','随笔','诗集','诗歌','诗','literature','prose','poem'] },
  { name: '技术',    color: '#3f7a8a', keywords: ['编程','程序','代码','算法','数据结构','计算机','软件','前端','后端','开发','技术','programming','code','algorithm','software','computer','python','java','javascript','go语言','rust','c++','typescript','react','vue','linux','数据库'] },
  { name: '历史',    color: '#7a6a5a', keywords: ['历史','史书','朝代','传记','传','history','biography','古代','近代'] },
  { name: '哲学',    color: '#6a5a8a', keywords: ['哲学','思想','伦理','philosophy','mind'] },
  { name: '心理',    color: '#a04a7a', keywords: ['心理','心理学','psychology','情绪','认知'] },
  { name: '经管',    color: '#b5a642', keywords: ['经济','管理','商业','金融','投资','创业','营销','business','economy','finance','management','marketing'] },
  { name: '科普',    color: '#5a8a4a', keywords: ['科普','科学','物理','化学','生物','天文','科学','science','physics','biology'] },
  { name: '科幻',    color: '#3f7a8a', keywords: ['科幻','science fiction','scifi','未来','星际','太空'] },
  { name: '悬疑',    color: '#6a5a8a', keywords: ['悬疑','推理','侦探','犯罪','mystery','thriller','detective'] },
  { name: '工具书',  color: '#7a6a5a', keywords: ['手册','指南','教程','入门','精通','权威','字典','词典','handbook','guide','tutorial','dictionary'] },
  { name: '教材',    color: '#5a8a4a', keywords: ['教材','课本','大学','高中','初中','数学','物理','化学','英语','textbook'] },
  { name: '艺术',    color: '#c0584a', keywords: ['艺术','绘画','音乐','设计','摄影','art','painting','music','design'] },
  { name: '社科',    color: '#8a6a3f', keywords: ['社会','政治','法律','法学','人类学','社会学','sociology','politics','law'] },
  { name: '童书',    color: '#d98a3f', keywords: ['童话','儿童','绘本','孩子','少儿','child','children','fairy'] },
];

const LOWER = TAG_RULES.map(r => ({ ...r, kw: r.keywords.map(k => k.toLowerCase()) }));

// 基于文本推断标签名数组（去重）
export function inferTagNames(text) {
  if (!text) return [];
  const t = String(text).toLowerCase();
  const found = new Set();
  for (const rule of LOWER) {
    for (const k of rule.kw) {
      if (t.includes(k)) { found.add(rule.name); break; }
    }
  }
  return [...found];
}

// 根据标签名查找规则（颜色）
export function ruleByName(name) {
  return TAG_RULES.find(r => r.name === name);
}

export default TAG_RULES;
