import { readFile } from 'node:fs/promises';

const OPENAI_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const CATALOG_PATH = new URL('../hillary_products_converted.json', import.meta.url);

let catalogCache;

const NEED_RULES = {
  dehydration: {
    triggers: ['dehydration', 'dryness', 'сух', 'зневод', 'лущ', 'стяг', 'зволож'],
    keywords: ['зволож', 'гіалурон', 'hyaluronic', 'трегалоз', 'барьер', 'барʼєр', 'бар’єр', 'віднов', 'moistur', 'aqua']
  },
  oily: {
    triggers: ['oily', 'жир', 'блиск', 'себум'],
    keywords: ['себум', 'жир', 'матув', 'niacinamide', 'ніацинамід', 'очищ', 'баланс', 'пори']
  },
  acne: {
    triggers: ['acne', 'breakouts', 'висип', 'акне', 'прищ', 'запален'],
    keywords: ['висип', 'акне', 'salicylic', 'саліцил', 'ніацинамід', 'niacinamide', 'цинк', 'azelaic', 'очищ', 'антибак']
  },
  pores: {
    triggers: ['pores', 'пор', 'комедон'],
    keywords: ['пор', 'комедон', 'ніацинамід', 'niacinamide', 'кислот', 'саліцил', 'очищ', 'глина', 'clay']
  },
  redness: {
    triggers: ['redness', 'почерв', 'купероз', 'розацеа'],
    keywords: ['почерв', 'центел', 'centella', 'заспок', 'ромаш', 'пантенол', 'чутлив', 'віднов']
  },
  sensitivity: {
    triggers: ['sensitivity', 'sensitive', 'чутлив', 'подраз', 'печіння'],
    keywords: ['чутлив', 'заспок', 'віднов', 'барʼєр', 'бар’єр', 'centella', 'центел', 'пантенол', 'ромаш']
  },
  pigmentation: {
    triggers: ['pigmentation', 'spots', 'пігмент', 'плям', 'постакне', 'тон'],
    keywords: ['пігмент', 'постакне', 'вітамін c', 'vitamin c', 'освіт', 'тон', 'сяйв', 'antioxidant', 'антиоксид']
  },
  wrinkles: {
    triggers: ['wrinkles', 'aging', 'зморш', 'віков', 'пружн'],
    keywords: ['зморш', 'антивіков', 'anti-age', 'renuage', 'пептид', 'ретинол', 'колаген', 'ліфтинг', 'пружн']
  },
  dullness: {
    triggers: ['dullness', 'тьмян', 'сяйв', 'нерівний тон'],
    keywords: ['сяйв', 'тон', 'вітамін c', 'антиоксид', 'пілінг', 'ензим', 'оновл']
  },
  spf: {
    triggers: ['spf', 'sun', 'сонц', 'захист'],
    keywords: ['spf', 'сонцезах', 'uv', 'uva', 'uvb', 'vitasun', 'protect']
  },
  cleansing: {
    triggers: ['cleansing', 'очищ', 'макіяж', 'забруд'],
    keywords: ['очищ', 'демакіяж', 'гель', 'пін', 'мус', 'тонер', 'убтан', 'ензим']
  },
  under_eye: {
    triggers: ['under_eye', 'eyes', 'очей', 'набряк', 'темні кола'],
    keywords: ['очей', 'патч', 'набряк', 'темні кола', 'anti-fatigue']
  }
};

const FACE_HINTS = [
  'облич', 'очей', 'губ', 'висип', 'почерв', 'пігмента', 'пори', 'сироват',
  'крем', 'тонер', 'очищ', 'демакіяж', 'маск', 'сонцезах', 'spf', 'renuage',
  'centella', 'niacinamide'
];

const NON_FACE_HINTS = [
  'волос', 'тіла', 'стоп', 'рук', 'нігт', 'антицелюліт', 'інтим', 'душ',
  'шампун', 'кондиціонер', 'дезодорант', 'епіляц', 'скраб для тіла'
];

const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_human_face', 'skin_condition', 'advice', 'skin_type', 'concerns', 'product_goals'],
  properties: {
    is_human_face: { type: 'boolean' },
    skin_condition: { type: 'string' },
    advice: { type: 'string' },
    skin_type: { type: 'string' },
    concerns: {
      type: 'array',
      items: { type: 'string' }
    },
    product_goals: {
      type: 'array',
      items: { type: 'string' }
    }
  }
};

const RECOMMENDATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['recommendations'],
  properties: {
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'reason', 'how_to_use'],
        properties: {
          id: { type: 'string' },
          reason: { type: 'string' },
          how_to_use: { type: 'string' }
        }
      }
    }
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z0-9#]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalize(value = '') {
  return stripHtml(value).toLowerCase();
}

function truncate(value, max = 420) {
  const text = stripHtml(value);
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

async function loadCatalog() {
  if (catalogCache) return catalogCache;

  const raw = await readFile(CATALOG_PATH, 'utf8');
  const data = JSON.parse(raw);
  const categoriesById = new Map((data.categories || []).map((item) => [String(item.id), item]));

  const getCategoryPath = (categoryId) => {
    const names = [];
    const seen = new Set();
    let current = categoriesById.get(String(categoryId));

    while (current && !seen.has(String(current.id))) {
      seen.add(String(current.id));
      names.unshift(current.name);
      current = current.parentId ? categoriesById.get(String(current.parentId)) : null;
    }

    return names.join(' > ');
  };

  catalogCache = (data.offers || []).map((offer) => {
    const categoryPath = getCategoryPath(offer.categoryId);
    const section = offer.params?.['Розділ'] || '';
    const cleanDescription = truncate(offer.description, 900);
    const searchText = normalize([
      offer.name,
      categoryPath,
      section,
      cleanDescription,
      Object.values(offer.params || {}).join(' ')
    ].join(' '));

    return {
      id: String(offer.id),
      groupId: String(offer.group_id || offer.id),
      name: offer.name,
      price: offer.price,
      currency: offer.currencyId || 'UAH',
      url: offer.url,
      image: offer.pictures?.[0] || null,
      vendorCode: offer.vendorCode,
      categoryPath,
      section,
      availability: offer.params?.['Наявність'] || offer.available || '',
      description: cleanDescription,
      searchText
    };
  });

  return catalogCache;
}

function inferNeeds(...texts) {
  const combined = normalize(texts.filter(Boolean).join(' '));
  const needs = new Set();

  for (const [need, rule] of Object.entries(NEED_RULES)) {
    if (rule.triggers.some((trigger) => combined.includes(trigger))) {
      needs.add(need);
    }
  }

  return [...needs];
}

function isFaceProduct(product) {
  const text = product.searchText;
  const positive = FACE_HINTS.some((hint) => text.includes(hint));
  const negative = NON_FACE_HINTS.some((hint) => text.includes(hint));
  return positive && !negative;
}

function scoreProduct(product, needs, userText) {
  let score = 0;
  const text = product.searchText;

  if (product.availability === 'В наявності') score += 16;
  if (product.availability === 'Немає в наявності') score -= 80;
  if (product.availability === 'Товар очікується') score -= 30;

  score += isFaceProduct(product) ? 30 : -24;

  if (text.includes('пробник')) score -= 35;
  if (text.includes('подарунков')) score -= 18;
  if (text.includes('secret box')) score -= 18;
  if (text.includes('комплекс') || text.includes('набір')) score += 3;

  for (const need of needs) {
    const rule = NEED_RULES[need];
    if (!rule) continue;
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) score += 9;
    }
  }

  const userTokens = normalize(userText)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 3);

  for (const token of new Set(userTokens)) {
    if (text.includes(token)) score += 2;
  }

  if (needs.includes('acne') || needs.includes('oily') || needs.includes('pores')) {
    if (text.includes('очищ') || text.includes('тонер') || text.includes('niacinamide') || text.includes('саліцил')) {
      score += 8;
    }
  }

  if (needs.includes('pigmentation') || needs.includes('wrinkles') || needs.includes('spf')) {
    if (text.includes('spf') || text.includes('сонцезах')) score += 12;
  }

  if (needs.includes('dehydration') || needs.includes('sensitivity') || needs.includes('redness')) {
    if (text.includes('крем') || text.includes('віднов') || text.includes('барʼєр') || text.includes('бар’єр')) {
      score += 7;
    }
  }

  return score;
}

function getCandidates(catalog, analysis, userData) {
  const analysisNeeds = [
    ...(analysis.concerns || []),
    ...(analysis.product_goals || []),
    analysis.skin_type
  ];
  const userText = `${userData?.skinType || ''} ${userData?.concerns || ''}`;
  const needs = [...new Set([
    ...inferNeeds(...analysisNeeds, userText),
    ...analysisNeeds.map((item) => normalize(item)).filter((item) => NEED_RULES[item])
  ])];

  const effectiveNeeds = needs.length ? needs : ['dehydration', 'cleansing', 'spf'];
  const ranked = catalog
    .map((product) => ({
      product,
      score: scoreProduct(product, effectiveNeeds, userText)
    }))
    .sort((a, b) => b.score - a.score);

  const seenGroups = new Set();
  const unique = [];

  for (const item of ranked) {
    if (item.score < 10) continue;
    if (seenGroups.has(item.product.groupId)) continue;
    seenGroups.add(item.product.groupId);
    unique.push(item.product);
    if (unique.length >= 18) break;
  }

  return unique.length >= 3 ? unique : ranked.slice(0, 18).map((item) => item.product);
}

function compactCandidates(candidates) {
  return candidates.map((product) => ({
    id: product.id,
    name: product.name,
    category: product.categoryPath || product.section,
    price: product.price,
    availability: product.availability,
    description: truncate(product.description, 320)
  }));
}

function getOpenAIText(response) {
  if (response.output_text) return response.output_text;

  const texts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) texts.push(content.text);
      if (content.type === 'text' && content.text) texts.push(content.text);
    }
  }

  return texts.join('\n');
}

async function callOpenAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY is not configured');
    error.statusCode = 500;
    throw error;
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const body = { model, ...payload };
  if (model.startsWith('gpt-5')) body.reasoning = { effort: 'none' };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.OPENAI_TIMEOUT_MS || 45000));

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data.error?.message || `OpenAI API error ${response.status}`;
      const error = new Error(message);
      error.statusCode = response.status;
      throw error;
    }

    const text = getOpenAIText(data);
    if (!text) throw new Error('OpenAI returned an empty response');
    return JSON.parse(text);
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeSkin({ base64Image, imageMimeType, userData }) {
  const detail = process.env.OPENAI_IMAGE_DETAIL || 'high';

  return callOpenAI({
    instructions: [
      'Ти професійний ШІ-косметолог бренду HiLLARY.',
      'Проаналізуй селфі та анкету, але не став медичних діагнозів.',
      'Якщо є ознаки сильного запалення, алергічної реакції або стану, який потребує лікаря, мʼяко порадь консультацію дерматолога.',
      'У concerns і product_goals використовуй короткі ключі: dehydration, oily, acne, pores, redness, sensitivity, pigmentation, wrinkles, dullness, spf, cleansing, under_eye.',
      'Відповідай тільки за схемою JSON.'
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Анкета клієнта: вік ${userData?.age || 'не вказано'}, тип шкіри ${userData?.skinType || 'не знаю'}, скарги: ${userData?.concerns || 'не вказано'}.`
          },
          {
            type: 'input_image',
            image_url: `data:${imageMimeType || 'image/jpeg'};base64,${base64Image}`,
            detail
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'skin_analysis',
        strict: true,
        schema: ANALYSIS_SCHEMA
      }
    },
    max_output_tokens: 900
  });
}

async function chooseProducts({ analysis, candidates, userData }) {
  return callOpenAI({
    instructions: [
      'Ти косметолог-консультант HiLLARY.',
      'Обери рівно 3 товари тільки з переданого списку кандидатів.',
      'Не вигадуй id або товари. Якщо продукту немає у списку, його не можна рекомендувати.',
      'Пояснення мають бути короткими, людськими і українською.',
      'Не обіцяй лікування акне чи медичний результат.'
    ].join('\n'),
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              client: {
                age: userData?.age || null,
                declared_skin_type: userData?.skinType || null,
                concerns: userData?.concerns || null
              },
              analysis,
              candidates: compactCandidates(candidates)
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'product_recommendations',
        strict: true,
        schema: RECOMMENDATION_SCHEMA
      }
    },
    max_output_tokens: 900
  });
}

function fallbackRecommendations(candidates) {
  return candidates.slice(0, 3).map((product) => ({
    id: product.id,
    reason: 'Підібрано як релевантний засіб за типом шкіри та описаними потребами.',
    how_to_use: 'Використовуйте згідно з інструкцією на сторінці товару.'
  }));
}

function buildFinalRecommendations(candidates, selected) {
  const byId = new Map(candidates.map((product) => [product.id, product]));
  const used = new Set();
  const recommendations = [];

  for (const item of selected.recommendations || []) {
    const product = byId.get(String(item.id));
    if (!product || used.has(product.id)) continue;
    used.add(product.id);
    recommendations.push({
      id: product.id,
      name: product.name,
      description: item.reason || truncate(product.description, 170),
      how_to_use: item.how_to_use,
      price: product.price,
      currency: product.currency,
      link: product.url,
      image: product.image,
      vendorCode: product.vendorCode
    });
    if (recommendations.length === 3) break;
  }

  if (recommendations.length < 3) {
    for (const item of fallbackRecommendations(candidates)) {
      if (used.has(item.id)) continue;
      const product = byId.get(item.id);
      if (!product) continue;
      used.add(product.id);
      recommendations.push({
        id: product.id,
        name: product.name,
        description: item.reason,
        how_to_use: item.how_to_use,
        price: product.price,
        currency: product.currency,
        link: product.url,
        image: product.image,
        vendorCode: product.vendorCode
      });
      if (recommendations.length === 3) break;
    }
  }

  return recommendations;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  try {
    const body = await readJsonBody(req);
    const { base64Image, imageMimeType, userData } = body;

    if (!base64Image) {
      return sendJson(res, 400, { error: 'Photo is required' });
    }

    const analysis = await analyzeSkin({ base64Image, imageMimeType, userData });

    if (!analysis.is_human_face) {
      return sendJson(res, 200, {
        analysis,
        recommendations: [],
        candidateCount: 0
      });
    }

    const catalog = await loadCatalog();
    const candidates = getCandidates(catalog, analysis, userData);

    let selected;
    try {
      selected = await chooseProducts({ analysis, candidates, userData });
    } catch (error) {
      console.warn('Product selection model failed, using local fallback:', error.message);
      selected = { recommendations: fallbackRecommendations(candidates) };
    }

    return sendJson(res, 200, {
      analysis,
      recommendations: buildFinalRecommendations(candidates, selected),
      candidateCount: candidates.length
    });
  } catch (error) {
    console.error('Analyze API error:', error);
    return sendJson(res, error.statusCode || 500, {
      error: error.message || 'Analysis failed'
    });
  }
}
