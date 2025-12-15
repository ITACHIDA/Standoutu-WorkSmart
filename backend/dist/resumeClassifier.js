"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptBuilders = void 0;
exports.callPromptPack = callPromptPack;
exports.analyzeJobFromUrl = analyzeJobFromUrl;
const crypto_1 = require("crypto");
const promptPack_1 = require("./promptPack");
const LABELS = [
    'Golang',
    'Java',
    'Rust',
    'Ruby',
    'DevOps',
    'AI',
    'Python',
    'C#',
    'Node.js',
    'PHP',
    'Kotlin',
    'Swift',
    'Frontend',
    'C++',
];
const FALLBACK_PRIORITY = [
    'Golang',
    'Java',
    'Rust',
    'Ruby',
    'DevOps',
    'AI',
    'Python',
    'C#',
    'Node.js',
    'PHP',
    'Kotlin',
    'Swift',
    'Frontend',
    'C++',
];
const TITLE_HIT_WEIGHT = 10;
const PRIMARY_HIT_WEIGHT = 8;
const GENERAL_HIT_WEIGHT = 0.9;
const REQUIRED_HIT_WEIGHT = 4;
const PREFERRED_HIT_WEIGHT = 0.7;
const CUSTOM_WEIGHTS = {
    Golang: 1.11,
    Java: 1.1,
    Rust: 1.0,
    Ruby: 1.0,
    DevOps: 1.08,
    AI: 0.9,
    Python: 0.93,
    'C#': 1.09,
    'Node.js': 0.85,
    PHP: 1.0,
    Kotlin: 0.9,
    Swift: 0.8,
    Frontend: 0.5,
    'C++': 1.0,
};
const STRONG_CONTEXT = [
    /main\s+stack/i,
    /primary\s+tech/i,
    /primary\s+stack/i,
    /primary\s+technology/i,
    /primary\s+language/i,
    /main\s+language/i,
    /core\s+tech/i,
    /core\s+stack/i,
    /core\s+language/i,
    /strong\s+(experience|background|skills?)/i,
    /focus(ed)?\s+on/i,
    /mainly\s+(work(ing)?\s+)?with/i,
];
const LANGUAGE_KEYWORDS = {
    Golang: [/golang/i, /\bgo(lang)?\b/i],
    Java: [/java/i, /j2ee/i, /spring/i],
    DevOps: [
        /devops/i,
        /\bsre\b/i,
        /site\s+reliability/i,
        /kubernetes/i,
        /\bk8s\b/i,
        /docker/i,
        /terraform/i,
        /ansible/i,
        /cloudformation/i,
        /\bci\/?cd\b/i,
        /prometheus/i,
        /grafana/i,
    ],
    'C#': [/c#/i, /\.net/i, /dotnet/i, /asp\.?net/i],
    Ruby: [/ruby\b/i, /ruby\s+on\s+rails/i, /\brails\b/i],
    Rust: [/rust\b/i],
    PHP: [/php/i, /laravel/i],
    Kotlin: [/kotlin/i, /android/i],
    Swift: [/swift\b/i, /\bios\b/i, /xcode/i],
    'C++': [/c\+\+/i],
    Python: [/python/i, /django/i, /flask/i, /fastapi/i],
    'Node.js': [/node\.?js/i, /express\b/i, /\bnest\b/i],
    Frontend: [/frontend/i, /front\s*-?\s*end/i, /react\b/i, /vue\b/i, /angular\b/i, /typescript\b/i],
    AI: [/ai\b/i, /\bml\b/i, /machine\s+learning/i, /deep\s+learning/i, /\bnlp\b/i, /\bllm\b/i, /pytorch/i, /tensorflow/i],
};
const TITLE_KEYWORDS = {
    Golang: [/golang\b/i, /\bgo\s+(developer|engineer|programmer)\b/i],
    Java: [/java\b/i, /\bjava\s+(developer|engineer)\b/i],
    DevOps: [/devops\b/i, /\bsre\b/i, /site reliability/i, /cloud\s+engineer/i, /platform\s+engineer/i],
    'C#': [/c#/i, /dotnet/i, /\.net/i],
    Ruby: [/ruby\b/i, /ruby\s+on\s+rails/i],
    Rust: [/rust\b/i],
    Python: [/python\b/i],
    'Node.js': [/node\.?js\b/i, /node\s+developer/i],
    AI: [/ai\b/i, /\bml\b/i, /machine\s+learning/i, /deep\s+learning/i, /data\s+scientist/i, /llm\b/i],
    PHP: [/php\b/i],
    Kotlin: [/kotlin\b/i],
    Swift: [/swift\b/i, /\bios\b/i, /\biphone\b/i],
    Frontend: [/frontend\b/i, /front\s*-?\s*end\b/i, /react\b/i, /vue\b/i, /angular\b/i],
    'C++': [/c\+\+/i],
};
const JAVASCRIPT_PATTERN = /\bjavascript\b/i;
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN;
const HF_MODEL = 'meta-llama/Meta-Llama-3-8B-Instruct';
function baseWeight(label) {
    return CUSTOM_WEIGHTS[label] ?? 1;
}
function requirementMultiplier(window) {
    let m = 1;
    if (/required|must have/i.test(window))
        m *= REQUIRED_HIT_WEIGHT;
    if (/preferred|nice to have/i.test(window))
        m *= PREFERRED_HIT_WEIGHT;
    return m;
}
function hasStrongContext(window) {
    return STRONG_CONTEXT.some((re) => re.test(window));
}
function scoreKeywords(text, pattern, label, weightBase) {
    let score = 0;
    const re = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
    for (const match of text.matchAll(re)) {
        const start = Math.max(0, match.index - 40);
        const end = Math.min(text.length, match.index + match[0].length + 40);
        const window = text.slice(start, end);
        const contextMultiplier = hasStrongContext(window) ? PRIMARY_HIT_WEIGHT : GENERAL_HIT_WEIGHT;
        const req = requirementMultiplier(window);
        score += weightBase * contextMultiplier * req;
    }
    return score;
}
function normalizeText(html) {
    return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
}
async function fetchJobText(url) {
    try {
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
        const raw = await res.text();
        const plain = normalizeText(raw);
        const titleMatch = raw.match(/<title>([^<]{3,120})<\/title>/i);
        return { text: plain, title: titleMatch?.[1]?.trim() };
    }
    catch (err) {
        return { text: '', title: undefined };
    }
}
function classify(title, text) {
    const lower = text.toLowerCase();
    const roleScores = {};
    const titleScores = {};
    // Title-driven boosts
    if (title) {
        const tLower = title.toLowerCase();
        for (const [label, patterns] of Object.entries(TITLE_KEYWORDS)) {
            for (const pattern of patterns) {
                const hits = (tLower.match(pattern) || []).length;
                if (hits) {
                    titleScores[label] = Math.max(titleScores[label] ?? 0, hits * baseWeight(label) * TITLE_HIT_WEIGHT);
                }
            }
        }
        if (JAVASCRIPT_PATTERN.test(tLower)) {
            titleScores['Frontend'] = Math.max(titleScores['Frontend'] ?? 0, baseWeight('Frontend') * TITLE_HIT_WEIGHT * 0.5);
            titleScores['Node.js'] = Math.max(titleScores['Node.js'] ?? 0, baseWeight('Node.js') * TITLE_HIT_WEIGHT * 0.5);
        }
    }
    // Body keyword scores
    for (const [label, patterns] of Object.entries(LANGUAGE_KEYWORDS)) {
        const weightBase = baseWeight(label);
        let score = 0;
        for (const pattern of patterns) {
            score += scoreKeywords(lower, pattern, label, weightBase);
        }
        roleScores[label] = score;
    }
    if (JAVASCRIPT_PATTERN.test(lower)) {
        const weightBase = baseWeight('Node.js');
        const base = scoreKeywords(lower, JAVASCRIPT_PATTERN, 'Node.js', weightBase);
        roleScores['Frontend'] = (roleScores['Frontend'] ?? 0) + base * 0.5;
        roleScores['Node.js'] = (roleScores['Node.js'] ?? 0) + base * 0.5;
    }
    // Merge
    const finalScores = {};
    for (const label of LABELS) {
        finalScores[label] = Math.max(roleScores[label] ?? 0, titleScores[label] ?? 0);
    }
    // Pick winners
    const sorted = Object.entries(finalScores)
        .map(([label, score]) => ({ label, score }))
        .sort((a, b) => b.score - a.score || FALLBACK_PRIORITY.indexOf(a.label) - FALLBACK_PRIORITY.indexOf(b.label));
    const best = sorted[0]?.label ?? FALLBACK_PRIORITY[0];
    return { best, scores: finalScores, ranked: sorted };
}
async function callHuggingFace(prompt) {
    if (!HF_TOKEN)
        return undefined;
    try {
        const res = await fetch('https://router.huggingface.co/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${HF_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: HF_MODEL,
                messages: [{ role: 'user', content: prompt }],
                max_tokens: 256,
                temperature: 0.1,
            }),
        });
        const data = (await res.json());
        const content = data?.choices?.[0]?.message?.content ||
            (Array.isArray(data) && data[0]?.generated_text) ||
            data?.generated_text ||
            data?.text;
        if (typeof content === 'string')
            return content.trim();
    }
    catch {
        // ignore HF errors
    }
    return undefined;
}
async function callPromptPack(prompt) {
    const raw = await callHuggingFace(prompt);
    if (!raw)
        return undefined;
    try {
        return JSON.parse(raw);
    }
    catch {
        return undefined;
    }
}
exports.promptBuilders = {
    buildResumeParsePrompt: promptPack_1.buildResumeParsePrompt,
    buildJobAnalyzePrompt: promptPack_1.buildJobAnalyzePrompt,
    buildRankResumesPrompt: promptPack_1.buildRankResumesPrompt,
    buildAutofillPlanPrompt: promptPack_1.buildAutofillPlanPrompt,
};
async function analyzeJobFromUrl(url, resumesInput) {
    const { text, title } = await fetchJobText(url);
    const classified = classify(title, text);
    const ranked = classified.ranked.map((r) => ({
        id: r.label,
        label: r.label,
        score: Number.isFinite(r.score) ? Number(r.score) : 0,
    }));
    return {
        id: (0, crypto_1.randomUUID)(),
        recommendedLabel: classified.best,
        recommendedResumeId: undefined,
        ranked,
        rawScores: classified.scores,
        title: title ?? '',
        jobText: text,
    };
}
