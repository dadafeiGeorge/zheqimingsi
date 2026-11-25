import type { GlossaryEntry, TranslationSettings } from '../types'
import { getLibraryBase, nativeHttpRequest } from './platform'
import type { TranslationResult } from './translateService'

/**
 * 哲启明思 · 内置零依赖离线翻译引擎
 * - 零网络、零外部模型下载，桌面端与 Android 飞行模式下开箱即用
 * - 融合内置 383+ 跨书哲学术语辞典（德/法/英/希/拉）+ 高频人文学术与通用多语词句库 + 形态还原
 * - 可选支持连接用户自建的本地离线翻译服务（如 LibreTranslate / 本地模型），不可达时无缝回退内置引擎
 */

interface OfflineTermNote {
  source: string
  target: string
  origin?: string
}

// ---------- 1. 多语种高频短语库（优先最长匹配） ----------
const PHRASES_TO_ZH: Record<string, string> = {
  // 法语短语（含阿尔都塞/拉康/福柯/德里达常见学术表达）
  "n'est que": '不过是',
  "n'est pas": '不是',
  "ne ... pas": '不',
  'en réalité': '在现实中',
  'en outre': '此外',
  'en effet': '事实上',
  'par conséquent': '因此',
  'c’est-à-dire': '也就是说',
  "c'est-à-dire": '也就是说',
  "d'une part": '一方面',
  "d'autre part": '另一方面',
  'au contraire': '相反',
  'en tant que': '作为',
  'dans la mesure où': '在某种程度上',
  'il relève': '他指出',
  'il s’agit de': '这涉及',
  "il s'agit de": '这涉及',
  'dont le moindre': '其中最不容忽视的',
  'points de fragilité': '脆弱之处',
  'la conséquence de': '……的后果',
  'dans le parti': '在党内',
  'elle-même': '它自身',
  'lui-même': '他自身',
  'se résument à': '归结为',
  'à travers': '通过',
  'au-delà de': '超越',
  'en soi': '自在',
  'pour soi': '自为',
  'être-là': '此在',
  'mise en scène': '场景布置',
  'raison d’être': '存在理由',
  "raison d'être": '存在理由',
  'point de vue': '观点',
  'prise de conscience': '意识觉醒',
  'mode de production': '生产方式',
  'rapports de production': '生产关系',
  'forces productives': '生产力',
  'lutte des classes': '阶级斗争',
  'appareil idéologique': '意识形态机器',
  'objet petit a': '小客体a',

  // 德语核心哲学短语
  'ding an sich': '自在之物',
  'an sich': '自在',
  'für sich': '自为',
  'an und für sich': '自在自为',
  'in der welt sein': '在世界之中存在',
  'in-der-welt-sein': '在世界之中存在',
  'sein zum tode': '向死而在',
  'wille zur macht': '权力意志',
  'ewige wiederkehr': '永恒轮回',
  'reine vernunft': '纯粹理性',
  'praktische vernunft': '实践理性',
  'kategorischer imperativ': '定言命令',
  'transzendentale ästhetik': '先验感性论',
  'transzendentale logik': '先验逻辑',
  'absoluter geist': '绝对精神',
  'objektiver geist': '客观精神',
  'subjektiver geist': '主观精神',
  'weltgeist': '世界精神',
  'zeitgeist': '时代精神',
  'das heißt': '也就是说',
  'zum beispiel': '例如',
  'im gegensatz zu': '与……相反',
  'in bezug auf': '关于',
  'als solche': '就其自身而言',
  'als solches': '就其自身而言',
  'nicht nur': '不仅',
  'sondern auch': '而且',
  'einerseits': '一方面',
  'andererseits': '另一方面',

  // 英语哲学与学术高频短语
  'in itself': '自在',
  'for itself': '自为',
  'thing in itself': '自在之物',
  'being-in-the-world': '在世界之中存在',
  'being-towards-death': '向死而在',
  'on the other hand': '另一方面',
  'on the one hand': '一方面',
  'in other words': '换言之',
  'in fact': '事实上',
  'in reality': '在现实中',
  'as a result': '因此',
  'in addition': '此外',
  'for example': '例如',
  'for instance': '例如',
  'in contrast': '相比之下',
  'at the same time': '与此同时',
  'in terms of': '就……而言',
  'with respect to': '关于',
  'according to': '根据',
  'because of': '由于',
  'due to': '由于',
  'such as': '例如',
  'as well as': '以及',
  'rather than': '而不是',
  'not only': '不仅',
  'but also': '而且',
  'even though': '尽管',
  'so that': '以便',
  'in order to': '为了',
  'point of view': '观点',
  'pure reason': '纯粹理性',
  'practical reason': '实践理性',
  'categorical imperative': '定言命令',
  'absolute spirit': '绝对精神',
  'historical materialism': '历史唯物主义',
  'dialectical materialism': '辩证唯物主义',
  'mode of production': '生产方式',
  'class struggle': '阶级斗争',
  'surplus value': '剩余价值',
  'social contract': '社会契约',
  'free will': '自由意志',
  'natural law': '自然法',
  'human nature': '人性',
  'state of nature': '自然状态',
  'common sense': '常识',
  'self-consciousness': '自我意识',
  'worldview': '世界观',

  // 拉丁与古希腊哲学名言与短语
  'a priori': '先天的 / 先验的',
  'a posteriori': '后天的 / 经验的',
  'cogito ergo sum': '我思故我在',
  'cogito, ergo sum': '我思故我在',
  'tabula rasa': '白板说',
  'causa sui': '自因',
  'sub specie aeternitatis': '在永恒的视角下',
  'natura naturans': '能动的自然',
  'natura naturata': '被动的自然',
  'res cogitans': '思维实体',
  'res extensa': '广延实体',
  'in situ': '就地 / 原位',
  'per se': '就其本身而言',
  'sine qua non': '必要条件',
  'status quo': '现状',
  'de facto': '事实上',
  'de jure': '法理上',
}

// ---------- 2. 核心多语种词汇表（按语种分表再合并，避免跨语种同形词冲突） ----------
const EN_WORDS_TO_ZH: Record<string, string> = {
  // 英文核心哲学、人文与常用词
  the: '', a: '一个', an: '一个', and: '与', or: '或', but: '但', not: '不', no: '无',
  of: '的', in: '在', on: '在……上', at: '在', to: '向', for: '为了', from: '从', by: '由', with: '以', without: '无',
  about: '关于', into: '进入', through: '通过', between: '在……之间', among: '在……之中', under: '在……之下', over: '之上',
  above: '之上', below: '之下', before: '之前', after: '之后', during: '在……期间', against: '反对', within: '在内', beyond: '超越',
  is: '是', are: '是', am: '是', was: '曾是', were: '曾是', be: '存在', been: '曾是', being: '存在',
  have: '具有', has: '具有', had: '曾具有', do: '做', does: '做', did: '做了',
  can: '能够', could: '能够', will: '将', would: '将会', shall: '应当', should: '应当', may: '可能', might: '或许', must: '必须',
  this: '这', that: '那', these: '这些', those: '那些', it: '它', its: '它的', they: '他们', them: '他们', their: '他们的',
  he: '他', him: '他', his: '他的', she: '她', her: '她的', we: '我们', us: '我们', our: '我们的', you: '你', your: '你的', i: '我', my: '我的',
  who: '谁', which: '哪一个', what: '什么', where: '何处', when: '何时', why: '为何', how: '如何',
  all: '一切', every: '每一个', each: '各自', some: '某些', any: '任何', many: '许多', much: '大量', more: '更', most: '最',
  other: '他者', another: '另一个', same: '同一', different: '不同', such: '如此', only: '仅仅', just: '仅仅', also: '也',
  very: '非常', too: '也', so: '因此', then: '于是', than: '比', as: '作为', if: '如果', because: '因为', although: '虽然', while: '当',
  however: '然而', therefore: '因此', thus: '从而', hence: '由此', moreover: '此外', furthermore: '进而', nevertheless: '尽管如此',
  always: '总是', never: '从不', often: '常常', still: '仍然', already: '已经', yet: '尚', now: '现在', here: '此处', there: '彼处',

  // 英文哲学与学术高频实词
  philosophy: '哲学', philosophical: '哲学的', philosopher: '哲学家', thought: '思想', think: '思考', thinking: '思维',
  reason: '理性', rational: '理性的', rationality: '合理性', understanding: '知性', intellect: '理智', mind: '心灵', spirit: '精神', soul: '灵魂',
  consciousness: '意识', conscious: '有意识的', unconscious: '无意识', subconscious: '潜意识', self: '自我', ego: '自我', subject: '主体', subjective: '主体的', subjectivity: '主体性',
  object: '客体', objective: '客观的', objectivity: '客观性', thing: '物', essence: '本质', essential: '本质的', existence: '存在', exist: '存在', existential: '存在的',
  ontology: '本体论', ontological: '本体论的', metaphysics: '形而上学', metaphysical: '形而上学的', epistemology: '认识论', phenomenology: '现象学', hermeneutics: '诠释学',
  dialectic: '辩证法', dialectical: '辩证的', logic: '逻辑', logical: '逻辑的', contradiction: '矛盾', negation: '否定', synthesis: '综合', thesis: '正题', antithesis: '反题',
  truth: '真理', true: '真实的', false: '虚假的', reality: '现实', real: '实在的', appearance: '现象', phenomenon: '现象', noumenon: '本体',
  knowledge: '知识', know: '认识', cognition: '认知', perception: '知觉', sensation: '感觉', intuition: '直观', experience: '经验', empirical: '经验的',
  transcendental: '先验的', transcendent: '超越的', immanent: '内在的', universal: '普遍的', universality: '普遍性', particular: '特殊的', individual: '个体的',
  concept: '概念', notion: '观念', idea: '理念', ideal: '理想的', idealism: '观念论', materialism: '唯物主义', realism: '实在论', nominalism: '唯名论',
  category: '范畴', principle: '原则', law: '规律', necessity: '必然性', necessary: '必然的', contingency: '偶然性', contingent: '偶然的', possibility: '可能性', possible: '可能的',
  freedom: '自由', free: '自由的', liberty: '自由', autonomy: '自律', desire: '欲望', pleasure: '快感', jouissance: '享乐',
  ethics: '伦理学', ethical: '伦理的', moral: '道德的', morality: '道德', virtue: '德性', good: '善', evil: '恶', justice: '正义', right: '权利', duty: '义务', value: '价值',
  politics: '政治', political: '政治的', state: '国家', society: '社会', social: '社会的', power: '权力', authority: '权威', sovereignty: '主权',
  history: '历史', historical: '历史的', time: '时间', space: '空间', world: '世界', nature: '自然', natural: '自然的', human: '人类', man: '人', life: '生命', death: '死亡',
  language: '语言', speech: '言语', discourse: '话语', text: '文本', sign: '符号', symbol: '象征', symbolic: '象征界', imaginary: '想象界', meaning: '意义', sense: '感官/意义',
  structure: '结构', system: '体系', form: '形式', content: '内容', matter: '质料', substance: '实体', attribute: '属性', mode: '样式', relation: '关系',
  cause: '原因', effect: '结果', consequence: '后果', causality: '因果性', origin: '起源', ground: '根据', foundation: '基础', basis: '基础', limit: '界限', boundary: '边界',
  practice: '实践', praxis: '实践', theory: '理论', theoretical: '理论的', method: '方法', critique: '批判', critical: '批判的', analysis: '分析', analyze: '分析',
  ideology: '意识形态', ideological: '意识形态的', alienation: '异化', fetishism: '拜物教', capital: '资本', labor: '劳动', labour: '劳动', production: '生产', class: '阶级',
  revolution: '革命', revolutionary: '革命的', resistance: '抵抗', struggle: '斗争', conflict: '冲突', crisis: '危机', rupture: '断裂', turn: '转向',
  art: '艺术', aesthetics: '美学', beauty: '美', sublime: '崇高', culture: '文化', religion: '宗教', god: '上帝', faith: '信仰', myth: '神话',
  science: '科学', scientific: '科学的', modern: '现代的', modernity: '现代性', postmodern: '后现代', ancient: '古代的', classical: '古典的', tradition: '传统',
  question: '问题', problem: '问题', answer: '回答', argument: '论证', claim: '主张', proposition: '命题', judgment: '判断', inference: '推理', proof: '证明',
  first: '第一', second: '第二', third: '第三', new: '新的', old: '旧的', great: '伟大的', small: '小的', whole: '整体', part: '部分',
  one: '一', two: '二', three: '三', unity: '统一', totality: '总体性', difference: '差异', identity: '同一性', repetition: '重复',
  become: '成为', becoming: '生成', change: '变化', movement: '运动', process: '过程', development: '发展', progress: '进步',
  make: '制造', create: '创造', produce: '生产', determine: '决定', constitute: '构成', reveal: '揭示', show: '表明', mean: '意味着',
  say: '说', speak: '言说', write: '书写', read: '阅读', see: '看见', find: '发现', give: '给予', take: '取', use: '使用', work: '工作',
  point: '点', fragility: '脆弱性', weakness: '弱点', fiction: '虚构', massive: '大规模的', gap: '空缺', aporia: '疑难/困境',
}

const FR_WORDS_TO_ZH: Record<string, string> = {
  // 法语核心词（覆盖图一示例及法国哲学高频词）
  le: '', la: '', les: '', un: '一个', une: '一个', des: '一些', du: '的', au: '向', aux: '向',
  de: '的', à: '向', en: '在', dans: '在……之中', sur: '关于', sous: '在……之下', par: '通过', pour: '为了', avec: '与', sans: '无',
  entre: '在……之间', vers: '朝向', chez: '在……那里', contre: '反对', selon: '根据', depuis: '自从', pendant: '期间',
  et: '与', ou: '或', mais: '但', donc: '因此', car: '因为', ni: '也不', que: '那/之', qui: '那/谁', dont: '其中/其', où: '何处',
  est: '是', sont: '是', était: '曾是', être: '存在', été: '曾是', a: '有', ont: '有', avoir: '拥有', fait: '做/事实', faire: '做',
  ce: '这', cette: '这', ces: '这些', cela: '那', ceci: '这', il: '他', elle: '她', ils: '他们', elles: '她们', on: '人们', nous: '我们', vous: '你们', je: '我',
  son: '其', sa: '其', ses: '其', leur: '他们的', notre: '我们的', votre: '你们的', mon: '我的', ma: '我的',
  ne: '不', pas: '不', plus: '更/不再', moins: '更少', très: '非常', tout: '一切', tous: '全部', toute: '全部', toutes: '全部',
  même: '甚至/自身', autre: '他者/另一', autres: '其他', tel: '如此', telle: '如此', comme: '如同', si: '如果', bien: '很/善',
  actuelle: '当前的', actuel: '当前的', comporte: '包含', comporter: '包含', terribles: '极其严重的', terrible: '可怕的',
  points: '要点', point: '要点', fragilité: '脆弱性', faiblesse: '弱点', moindre: '最小的',
  reposer: '建立在', repose: '建立在', 'demi-fiction': '半虚构', fiction: '虚构', résistance: '抵抗',
  consciente: '有意识的', conscient: '有意识的', conscience: '意识', parti: '党派', tournant: '转折',
  réalité: '现实', réel: '实在', conséquence: '后果', pratiques: '实践', pratique: '实践',
  anciennes: '古老的/旧有的', ancien: '旧有的', massives: '大规模的', massif: '大规模的',
  relève: '指出', relever: '指出', outre: '之外', analyse: '分析', althussérienne: '阿尔都塞式的',
  contradictions: '矛盾', contradiction: '矛盾', lacunes: '缺漏', lacune: '缺漏', apories: '疑难/困境', aporie: '困境',
  résument: '归结为', prêcher: '宣扬', note: '说明', édition: '版本/编辑',
  philosophie: '哲学', pensée: '思想', raison: '理性', vérité: '真理', monde: '世界', histoire: '历史',
  sujet: '主体', objet: '客体', savoir: '知识', pouvoir: '权力', discours: '话语', texte: '文本', sens: '意义',
  langage: '语言', parole: '言语', écriture: '书写', différance: '延异', trace: '踪迹', signe: '符号',
  idéologie: '意识形态', structure: '结构', système: '体系', temps: '时间', espace: '空间', vie: '生命', mort: '死亡',
  liberté: '自由', désir: '欲望', jouissance: '享乐', inconscient: '无意识', imaginaire: '想象界', symbolique: '象征界',
  homme: '人', société: '社会', état: '国家', classe: '阶级', lutte: '斗争', travail: '劳动', capital: '资本',
  critique: '批判', dialectique: '辩证法', théorie: '理论', concept: '概念', idée: '理念', nature: '自然',
}

const DE_WORDS_TO_ZH: Record<string, string> = {
  // 德语核心词（康德/黑格尔/马克思/海德格尔高频词）
  der: '', die: '', das: '', den: '', dem: '', des: '的', ein: '一个', eine: '一个', einem: '一个', einen: '一个', einer: '一个', eines: '一个',
  und: '与', oder: '或', aber: '但', denn: '因为', doch: '然而', sondern: '而是', nicht: '不', kein: '无', keine: '无',
  ist: '是', sind: '是', war: '曾是', waren: '曾是', sein: '存在', seiend: '存在者', seiende: '存在者', werden: '生成', wird: '成为', wurde: '成为',
  hat: '具有', haben: '具有', kann: '能够', können: '能够', muss: '必须', müssen: '必须', soll: '应当', sollen: '应当', will: '意欲', wollen: '意欲',
  in: '在', an: '在', auf: '在……上', aus: '从', bei: '在……处', mit: '与', nach: '按照/之后', von: '由/的', zu: '向', für: '为了',
  durch: '通过', gegen: '反对', ohne: '无', um: '围绕', über: '关于', unter: '在……之下', vor: '之前', zwischen: '在……之间',
  als: '作为', wie: '如同', wenn: '如果', weil: '因为', dass: '那', daß: '那', obwohl: '尽管', während: '当',
  ich: '我', du: '你', er: '他', sie: '她/他们', es: '它', wir: '我们', ihr: '你们', sich: '自身', selbst: '自身',
  dieser: '这', diese: '这', dieses: '这', jener: '那', alle: '一切', alles: '一切', jeder: '每个', nur: '仅仅', auch: '也', noch: '尚', schon: '已经',
  immer: '总是', nie: '从不', sehr: '非常', mehr: '更', so: '如此', dann: '于是', also: '因此', jedoch: '然而',
  dasein: '此在', aufhebung: '扬弃', aufheben: '扬弃', geist: '精神', begriff: '概念', idee: '理念',
  vernunft: '理性', verstand: '知性', sinnlichkeit: '感性', anschauung: '直观', vorstellung: '表象', urteil: '判断',
  bewusstsein: '意识', bewußtsein: '意识', selbstbewusstsein: '自我意识', subjekt: '主体', objekt: '客体', gegenstand: '对象',
  ding: '物', wesen: '本质', erscheinung: '现象', schein: '假象', wirklichkeit: '现实性', möglichkeit: '可能性', notwendigkeit: '必然性',
  freiheit: '自由', wille: '意志', pflicht: '义务', gesetz: '法则', recht: '法权', sittlichkeit: '伦理', moralität: '道德', staat: '国家',
  wahrheit: '真理', erkenntnis: '认识', wissen: '知识', wissenschaft: '科学', philosophie: '哲学', logik: '逻辑', dialektik: '辩证法',
  widerspruch: '矛盾', negation: '否定', identität: '同一性', unterschied: '差异', einheit: '统一', ganzes: '整体', teil: '部分',
  welt: '世界', zeit: '时间', raum: '空间', natur: '自然', geschichte: '历史', mensch: '人', leben: '生命', tod: '死亡',
  sprache: '语言', rede: '言谈', weltanschauung: '世界观', sorge: '操心', angst: '畏', geworfenheit: '被抛状态',
  entfremdung: '异化', arbeit: '劳动', kapital: '资本', gesellschaft: '社会', klasse: '阶级', praxis: '实践', theorie: '理论',
  kritik: '批判', transzendental: '先验的', empirisch: '经验的', absolut: '绝对的', allgemein: '普遍的', besonders: '特殊的', einzeln: '个别的',
}

const CLASSICAL_WORDS_TO_ZH: Record<string, string> = {
  // 古希腊 / 拉丁哲学单字
  logos: '逻各斯（理性/言辞）', physis: '自然', nomos: '律法', ethos: '伦理/品性', pathos: '情感', telos: '目的',
  arche: '本原', aletheia: '无蔽（真理）', episteme: '知识', doxa: '意见', techne: '技艺', poiesis: '创制',
  nous: '努斯（理智）', psyche: '灵魂', eudaimonia: '幸福/善好生活', aporia: '疑难/困境', ousia: '实体/本质',
  polis: '城邦', katharsis: '净化', mimesis: '模仿',
  substantia: '实体', essentia: '本质', existentia: '存在', cogito: '我思', ratio: '理性', veritas: '真理',
  voluntas: '意志', libertas: '自由', natura: '自然', mundus: '世界', anima: '灵魂', corpus: '身体',
}

const WORDS_TO_ZH: Record<string, string> = {
  ...CLASSICAL_WORDS_TO_ZH,
  ...DE_WORDS_TO_ZH,
  ...FR_WORDS_TO_ZH,
  ...EN_WORDS_TO_ZH,
}

// ---------- 3. 中文 -> 英文核心词表（自动由上述双向构建 + 补充高频汉语词） ----------
const EXTRA_ZH_TO_EN: Record<string, string> = {
  哲学: 'philosophy', 哲学家: 'philosopher', 思想: 'thought', 理性: 'reason', 知性: 'understanding', 感性: 'sensibility',
  存在: 'being', 此在: 'Dasein', 本质: 'essence', 现象: 'phenomenon', 本体: 'noumenon', 自在之物: 'thing-in-itself',
  真理: 'truth', 现实: 'reality', 意识: 'consciousness', 自我意识: 'self-consciousness', 无意识: 'unconscious',
  主体: 'subject', 客体: 'object', 主体性: 'subjectivity', 客观性: 'objectivity', 概念: 'concept', 理念: 'idea', 范畴: 'category',
  辩证法: 'dialectics', 辩证的: 'dialectical', 扬弃: 'Aufhebung', 矛盾: 'contradiction', 否定: 'negation', 统一: 'unity',
  精神: 'spirit', 绝对精神: 'absolute spirit', 自由: 'freedom', 必然性: 'necessity', 偶然性: 'contingency', 可能性: 'possibility',
  历史: 'history', 时间: 'time', 空间: 'space', 世界: 'world', 自然: 'nature', 人类: 'humanity', 社会: 'society', 国家: 'state',
  实践: 'praxis', 理论: 'theory', 批判: 'critique', 逻辑: 'logic', 伦理: 'ethics', 道德: 'morality', 政治: 'politics', 权力: 'power',
  语言: 'language', 话语: 'discourse', 符号: 'sign', 意义: 'meaning', 结构: 'structure', 体系: 'system', 方法: 'method',
  知识: 'knowledge', 认识: 'cognition', 经验: 'experience', 先验: 'transcendental', 先天: 'a priori', 后天: 'a posteriori',
  形而上学: 'metaphysics', 本体论: 'ontology', 认识论: 'epistemology', 现象学: 'phenomenology', 诠释学: 'hermeneutics',
  唯物主义: 'materialism', 唯心主义: 'idealism', 观念论: 'idealism', 意识形态: 'ideology', 异化: 'alienation', 劳动: 'labor', 资本: 'capital', 阶级: 'class',
  我们: 'we', 他们: 'they', 这个: 'this', 那个: 'that', 这些: 'these', 那些: 'those', 自己: 'self', 自身: 'itself',
  但是: 'however', 然而: 'however', 因此: 'therefore', 所以: 'so', 因为: 'because', 如果: 'if', 虽然: 'although', 并且: 'and', 或者: 'or',
  不仅: 'not only', 而且: 'but also', 以及: 'as well as', 关于: 'about', 通过: 'through', 作为: 'as', 根据: 'according to',
  不是: 'is not', 就是: 'is', 能够: 'can', 必须: 'must', 应当: 'should', 可能: 'may', 已经: 'already', 仍然: 'still',
  的: 'of', 是: 'is', 在: 'in', 与: 'and', 和: 'and', 不: 'not', 无: 'without', 有: 'has', 为: 'for', 对: 'for', 从: 'from',
}

let glossaryLoaded = false
let glossaryOriginToZh = new Map<string, { zh: string; def: string; origin: string }>()
let glossaryZhToOrigin = new Map<string, { origin: string; def: string }>()

async function ensureGlossaryIndexLoaded() {
  if (glossaryLoaded) return
  glossaryLoaded = true
  try {
    const res = await fetch(`${getLibraryBase()}/glossary-index.json`)
    if (!res.ok) return
    const list: GlossaryEntry[] = await res.json()
    for (const entry of list) {
      if (!entry.t) continue
      const zh = entry.t.trim()
      const origRaw = (entry.o || '').trim()
      if (origRaw) {
        glossaryZhToOrigin.set(zh, { origin: origRaw, def: entry.d || '' })
        // 拆分多个原词（如 "Dasein / Being-there" 或 "Aufhebung, sublation"）
        const parts = origRaw
          .replace(/[（()）\[\]]/g, '/')
          .split(/[/,;，；]/)
          .map((s) => s.trim())
          .filter((s) => s.length >= 2)
        for (const p of parts) {
          const key = p.toLowerCase()
          if (!glossaryOriginToZh.has(key)) {
            glossaryOriginToZh.set(key, { zh, def: entry.d || '', origin: p })
          }
        }
      }
    }
  } catch {}
}

function detectLanguage(text: string): 'zh' | 'fr' | 'de' | 'en' {
  const zhCount = (text.match(/[\u4e00-\u9fff]/g) || []).length
  if (zhCount > text.length * 0.22) return 'zh'
  if (/[éèêëàâçîïôùûüœæ«»]/i.test(text) || /\b(?:est|dans|pour|avec|qui|que|une|des|les|elle|mais)\b/i.test(text)) {
    return 'fr'
  }
  if (/[äöüß]/i.test(text) || /\b(?:der|die|das|und|nicht|ist|ein|eine|sich|mit|für|auf|über)\b/i.test(text)) {
    return 'de'
  }
  return 'en'
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function lookupForeignWord(rawWord: string): { zh: string; origin?: string } | null {
  const lower = rawWord.toLowerCase()
  const glossHit = glossaryOriginToZh.get(lower)
  if (glossHit) return { zh: glossHit.zh, origin: glossHit.origin }

  if (WORDS_TO_ZH[lower] !== undefined) return { zh: WORDS_TO_ZH[lower] }

  // 处理法语省音前缀 (l'analyse, d'une, n'est, qu'il, s'agit)
  const apostropheMatch = lower.match(/^(?:l|d|n|qu|s|c|j|m|t)[’'](.+)$/)
  if (apostropheMatch) {
    const stem = apostropheMatch[1]
    const sub = lookupForeignWord(stem)
    if (sub) {
      const prefixMap: Record<string, string> = {
        d: '的',
        n: '不',
        qu: '那',
        l: '',
        s: '自我',
        c: '这',
        j: '我',
      }
      const pref = prefixMap[lower.split(/[’']/)[0]] ?? ''
      return { zh: `${pref}${sub.zh}`, origin: sub.origin }
    }
  }

  // 常见词形还原（复数、动词变位、形容词词尾）
  const candidates: string[] = []
  if (lower.endsWith('ies') && lower.length > 4) candidates.push(lower.slice(0, -3) + 'y')
  if (lower.endsWith('es') && lower.length > 3) candidates.push(lower.slice(0, -2))
  if (lower.endsWith('s') && lower.length > 3) candidates.push(lower.slice(0, -1))
  if (lower.endsWith('ing') && lower.length > 5) {
    candidates.push(lower.slice(0, -3), lower.slice(0, -3) + 'e')
  }
  if (lower.endsWith('ed') && lower.length > 4) {
    candidates.push(lower.slice(0, -2), lower.slice(0, -1))
  }
  if (lower.endsWith('ly') && lower.length > 4) candidates.push(lower.slice(0, -2))
  if (lower.endsWith('en') && lower.length > 4) candidates.push(lower.slice(0, -2))
  if (lower.endsWith('er') && lower.length > 4) candidates.push(lower.slice(0, -2))
  if (lower.endsWith('e') && lower.length > 3) candidates.push(lower.slice(0, -1))
  if (lower.endsWith('aux') && lower.length > 4) candidates.push(lower.slice(0, -3) + 'al')
  if (lower.endsWith('ment') && lower.length > 6) candidates.push(lower.slice(0, -4))

  const noAccent = stripAccents(lower)
  if (noAccent !== lower) candidates.push(noAccent)

  for (const cand of candidates) {
    const g = glossaryOriginToZh.get(cand)
    if (g) return { zh: g.zh, origin: g.origin }
    if (WORDS_TO_ZH[cand] !== undefined) return { zh: WORDS_TO_ZH[cand] }
  }
  return null
}

function translateForeignToZh(text: string): { translated: string; notes: OfflineTermNote[] } {
  const notes: OfflineTermNote[] = []
  const seenNotes = new Set<string>()
  const addNote = (source: string, target: string, origin?: string) => {
    const k = source.toLowerCase()
    if (!target || seenNotes.has(k) || notes.length >= 8) return
    seenNotes.add(k)
    notes.push({ source, target, origin })
  }

  // 1. 先检查整段是否直接命中短语库或哲学术语辞典
  const exactKey = text.trim().toLowerCase().replace(/\s+/g, ' ')
  if (PHRASES_TO_ZH[exactKey]) {
    return { translated: PHRASES_TO_ZH[exactKey], notes }
  }
  const exactGloss = glossaryOriginToZh.get(exactKey)
  if (exactGloss) {
    addNote(text.trim(), exactGloss.zh, exactGloss.origin)
    return {
      translated: `${exactGloss.zh}${exactGloss.def ? `（${exactGloss.def.slice(0, 80)}）` : ''}`,
      notes,
    }
  }

  // 2. 替换多词短语（按长度降序，使用占位符防止二次改写）
  const placeholders: Array<{ token: string; zh: string }> = []
  let working = text.replace(/[’‘]/g, "'")

  const sortedPhrases = Object.keys(PHRASES_TO_ZH).sort((a, b) => b.length - a.length)
  for (const phrase of sortedPhrases) {
    const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`(?<![A-Za-zÀ-ÿ])${escaped}(?![A-Za-zÀ-ÿ])`, 'gi')
    working = working.replace(re, (matched) => {
      const zh = PHRASES_TO_ZH[phrase]
      const token = `⟦P${placeholders.length}⟧`
      placeholders.push({ token, zh })
      if (matched.length >= 4 && zh) addNote(matched, zh)
      return ` ${token} `
    })
  }

  // 3. 逐词查表与形态还原
  const tokens = working.split(/(\s+|[,.;:!?()«»"“”\[\]—–]+)/)
  const outParts: string[] = []
  let translatedWordCount = 0
  let totalWordCount = 0

  for (const tok of tokens) {
    if (!tok) continue
    if (/^\s+$/.test(tok)) continue
    if (/^⟦P\d+⟧$/.test(tok)) {
      const found = placeholders.find((p) => p.token === tok)
      if (found) outParts.push(found.zh)
      translatedWordCount++
      totalWordCount++
      continue
    }
    if (/^[,.;:!?()«»"“”\[\]—–]+$/.test(tok)) {
      const mapped = tok
        .replace(/,/g, '，')
        .replace(/\./g, '。')
        .replace(/;/g, '；')
        .replace(/:/g, '：')
        .replace(/\?/g, '？')
        .replace(/!/g, '！')
        .replace(/«/g, '「')
        .replace(/»/g, '」')
      outParts.push(mapped)
      continue
    }

    if (/[A-Za-zÀ-ÿ]/.test(tok)) {
      totalWordCount++
      const hit = lookupForeignWord(tok)
      if (hit) {
        translatedWordCount++
        if (hit.zh) {
          outParts.push(hit.zh)
          if (tok.length >= 5 && hit.zh.length >= 2) {
            addNote(tok, hit.zh, hit.origin)
          }
        }
      } else {
        outParts.push(tok)
      }
    } else {
      outParts.push(tok)
    }
  }

  // 清理拼接空格与重复标点
  let assembled = outParts
    .join('')
    .replace(/([A-Za-zÀ-ÿ])([\u4e00-\u9fff])/g, '$1 $2')
    .replace(/([\u4e00-\u9fff])([A-Za-zÀ-ÿ])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .replace(/，，+/g, '，')
    .replace(/。。+/g, '。')
    .trim()

  if (!assembled || (totalWordCount > 0 && translatedWordCount === 0)) {
    assembled = `${text}（离线词库未收录该专词，联网后可切换 Bing / Google / DeepL / AI 获取完整译文）`
  }

  return { translated: assembled, notes }
}

function translateZhToForeign(text: string, targetLang: string): { translated: string; notes: OfflineTermNote[] } {
  const notes: OfflineTermNote[] = []
  const seen = new Set<string>()
  const isEn = targetLang === 'en' || targetLang === 'auto'

  // 构建中文 -> 目标语映射
  const zhMap = new Map<string, string>(Object.entries(EXTRA_ZH_TO_EN))
  glossaryZhToOrigin.forEach((val, zh) => {
    if (!zhMap.has(zh)) {
      zhMap.set(zh, val.origin)
    }
  })

  // 如果目标语是德/法，从 WORDS_TO_ZH 反向补齐对应哲学词汇
  if (!isEn) {
    for (const [foreign, zh] of Object.entries(WORDS_TO_ZH)) {
      if (zh && zh.length >= 2 && !zh.includes('/') && !zhMap.has(zh)) {
        zhMap.set(zh, foreign)
      }
    }
  }

  const keys = Array.from(zhMap.keys()).sort((a, b) => b.length - a.length)
  const out: string[] = []
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (!/[\u4e00-\u9fff]/.test(ch)) {
      const mapped = ch
        .replace('，', ', ')
        .replace('。', '. ')
        .replace('；', '; ')
        .replace('：', ': ')
        .replace('？', '? ')
        .replace('！', '! ')
        .replace('「', '"')
        .replace('」', '"')
        .replace('“', '"')
        .replace('”', '"')
      out.push(mapped)
      i++
      continue
    }

    let matched = false
    for (const k of keys) {
      if (text.startsWith(k, i)) {
        const val = zhMap.get(k)!
        out.push(val + ' ')
        if (k.length >= 2 && !seen.has(k) && notes.length < 8) {
          seen.add(k)
          notes.push({ source: k, target: val })
        }
        i += k.length
        matched = true
        break
      }
    }
    if (!matched) {
      out.push(ch)
      i++
    }
  }

  const cleaned = out
    .join('')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()

  return { translated: cleaned || text, notes }
}

/**
 * 离线翻译主入口：
 * 1) 若用户开启本地离线服务（如本机 LibreTranslate），优先请求本地服务
 * 2) 否则或本地服务不可用时，毫秒级执行内置零依赖离线哲学多语翻译引擎
 */
export async function offlineTranslate(
  text: string,
  settings: TranslationSettings
): Promise<TranslationResult> {
  await ensureGlossaryIndexLoaded()

  // 可选本地离线神经翻译服务（例如本机部署的 LibreTranslate）
  if (settings.offlineUseLocalServer && settings.offlineLocalUrl.trim()) {
    try {
      const resp = await nativeHttpRequest({
        url: settings.offlineLocalUrl.trim(),
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: text,
          source: settings.sourceLang === 'auto' ? 'auto' : settings.sourceLang.split('-')[0],
          target: settings.targetLang.split('-')[0],
          format: 'text',
        }),
        timeoutMs: 8000,
      })
      if (resp.ok) {
        const json = JSON.parse(resp.body)
        const tr = json?.translatedText || json?.translation || json?.text
        if (typeof tr === 'string' && tr.trim()) {
          return {
            translatedText: tr.trim(),
            engine: 'offline',
            engineName: '离线翻译引擎 (本地服务)',
          }
        }
      }
    } catch {
      // 自动平滑降级到内置零依赖离线引擎
    }
  }

  const detected = settings.sourceLang !== 'auto' ? (settings.sourceLang.startsWith('zh') ? 'zh' : 'en') : detectLanguage(text)
  const targetIsZh = settings.targetLang === 'zh-CN' || settings.targetLang === 'zh-TW'

  if (detected === 'zh' && !targetIsZh) {
    const { translated, notes } = translateZhToForeign(text, settings.targetLang)
    return {
      translatedText: translated,
      detectedSourceLang: 'zh',
      engine: 'offline',
      engineName: '离线翻译引擎 (内置)',
      termNotes: notes.length > 0 ? notes : undefined,
    }
  }

  if (detected === 'zh' && targetIsZh) {
    // 若中文段落内夹杂德/法/英/拉丁哲学原词，离线引擎自动提取并逐词释义标注
    const foreignMatches = Array.from(new Set(text.match(/[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’-]{1,}/g) || []))
    if (foreignMatches.length > 0) {
      const notes: OfflineTermNote[] = []
      let annotated = text
      for (const word of foreignMatches) {
        const hit = lookupForeignWord(word)
        if (hit && hit.zh) {
          notes.push({ source: word, target: hit.zh, origin: hit.origin })
          annotated = annotated.replace(new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), `${word}【${hit.zh}】`)
        }
      }
      if (notes.length > 0) {
        return {
          translatedText: annotated,
          detectedSourceLang: 'zh',
          engine: 'offline',
          engineName: '离线翻译引擎 (内置术语)',
          termNotes: notes.slice(0, 8),
        }
      }
    }
    // 否则反查中文哲学词条对应的外文原词
    const { translated, notes } = translateZhToForeign(text, 'en')
    return {
      translatedText: translated,
      detectedSourceLang: 'zh',
      engine: 'offline',
      engineName: '离线翻译引擎 (内置中译英)',
      termNotes: notes.length > 0 ? notes : undefined,
    }
  }

  const { translated, notes } = translateForeignToZh(text)
  return {
    translatedText: translated,
    detectedSourceLang: detected,
    engine: 'offline',
    engineName: '离线翻译引擎 (内置)',
    termNotes: notes.length > 0 ? notes : undefined,
  }
}
