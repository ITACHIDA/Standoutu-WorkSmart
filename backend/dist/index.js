"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const websocket_1 = __importDefault(require("@fastify/websocket"));
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const fs_2 = __importDefault(require("fs"));
const zod_1 = require("zod");
const playwright_1 = require("playwright");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const pdf_parse_1 = __importDefault(require("pdf-parse"));
const mammoth_1 = require("mammoth");
const data_1 = require("./data");
const auth_1 = require("./auth");
const db_1 = require("./db");
const resumeClassifier_1 = require("./resumeClassifier");
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = (0, fastify_1.default)({ logger: true });
const PROJECT_ROOT = path_1.default.join(__dirname, '..');
const RESUME_DIR = process.env.RESUME_DIR ?? path_1.default.join(PROJECT_ROOT, 'data', 'resumes');
const HF_TOKEN = process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGING_FACE_TOKEN || '';
const HF_MODEL = process.env.HF_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct';
const livePages = new Map();
function sanitizeText(input) {
    if (!input)
        return '';
    return input.replace(/\u0000/g, '');
}
function looksBinary(buf) {
    if (!buf || !buf.length)
        return false;
    const sample = buf.subarray(0, Math.min(buf.length, 1024));
    let nonText = 0;
    for (const byte of sample) {
        if (byte === 0)
            return true;
        // allow tab/newline/carriage return and basic printable range
        if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
            nonText += 1;
        }
    }
    return nonText / sample.length > 0.3;
}
async function extractResumeTextFromFile(filePath, fileName) {
    try {
        const ext = (fileName ?? path_1.default.extname(filePath)).toLowerCase();
        const buf = await fs_1.promises.readFile(filePath);
        // Try magic-header detection for PDF when extension is missing/misleading.
        if (buf.subarray(0, 4).toString() === '%PDF') {
            try {
                const parsed = await (0, pdf_parse_1.default)(buf);
                if (parsed.text?.trim())
                    return sanitizeText(parsed.text);
            }
            catch {
                // fall through
            }
        }
        if (ext === '.txt') {
            return sanitizeText(buf.toString('utf8'));
        }
        if (ext === '.docx') {
            const res = await (0, mammoth_1.extractRawText)({ path: filePath });
            return sanitizeText(res.value ?? '');
        }
        if (ext === '.pdf') {
            const parsed = await (0, pdf_parse_1.default)(buf);
            return sanitizeText(parsed.text ?? '');
        }
        if (looksBinary(buf)) {
            return '';
        }
        return sanitizeText(buf.toString('utf8'));
    }
    catch (err) {
        console.error('extractResumeTextFromFile failed', err);
        return '';
    }
}
async function saveParsedResumeJson(resumeId, parsed) {
}
async function tryParseResumeText(resumeId, resumeText, baseProfile) {
    if (!resumeText?.trim())
        return undefined;
    try {
        const prompt = resumeClassifier_1.promptBuilders.buildResumeParsePrompt({
            resumeId,
            resumeText,
            baseProfile,
        });
        const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
        if (parsed?.result)
            return parsed.result;
        if (parsed)
            return parsed;
    }
    catch (err) {
        console.error('LLM resume parse failed', err);
    }
    return simpleParseResume(resumeText);
}
function simpleParseResume(resumeText) {
    const lines = resumeText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    const emailMatch = resumeText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    const phoneMatch = resumeText.match(/(\+?\d[\d\s\-\(\)]{8,})/);
    const nameLine = lines.find((l) => l && l.length <= 80 && !l.includes('@') && !/\d/.test(l));
    const summary = lines.slice(0, 6).join(' ').slice(0, 600);
    const skillsIdx = lines.findIndex((l) => /skill/i.test(l));
    const skillsLine = skillsIdx >= 0 ? lines.slice(skillsIdx + 1, skillsIdx + 4).join(', ') : '';
    const skills = skillsLine
        .split(/[,;]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 1)
        .slice(0, 20);
    const linkedinMatch = resumeText.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i);
    // Section detection
    const workIdx = lines.findIndex((l) => /work\s+experience/i.test(l));
    const eduIdx = lines.findIndex((l) => /education/i.test(l));
    const endIdx = (idx) => {
        const cutoffs = [workIdx, eduIdx].filter((n) => n >= 0 && n > idx);
        return cutoffs.length ? Math.min(...cutoffs) : lines.length;
    };
    function sliceSection(idx) {
        if (idx < 0)
            return [];
        return lines.slice(idx + 1, endIdx(idx));
    }
    const workLines = sliceSection(workIdx);
    const educationLines = sliceSection(eduIdx);
    function parseWork(blocks) {
        const items = [];
        let current = null;
        const datePattern = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*\d{4})/i;
        const rangePattern = /(\d{4})\s*[–-]\s*(Present|\d{4})/i;
        const bulletPattern = /^[\u2022*\-•]+\s*/;
        for (const l of blocks) {
            const isBullet = bulletPattern.test(l);
            if (!isBullet) {
                // treat as new role/company line when it looks like a heading
                const looksLikeRole = /engineer|developer|manager|lead|architect|consultant|specialist|director/i.test(l) ||
                    rangePattern.test(l) ||
                    datePattern.test(l);
                if (current)
                    items.push(current);
                if (looksLikeRole) {
                    const dates = l.match(rangePattern) || l.match(datePattern);
                    const parts = l.split(/[–-]/);
                    const titlePart = parts[0]?.trim() ?? '';
                    const companyPart = parts.slice(1).join('-').replace(rangePattern, '').replace(datePattern, '').trim();
                    current = {
                        company: companyPart || l.replace(rangePattern, '').replace(datePattern, '').trim(),
                        title: titlePart || '',
                        start_date: dates ? dates[1] ?? '' : '',
                        end_date: dates && dates[2] ? dates[2] : '',
                        location: '',
                        bullets: [],
                    };
                }
                else if (current) {
                    current.company = `${current.company} ${l}`.trim();
                }
                else {
                    current = { company: l, title: '', start_date: '', end_date: '', location: '', bullets: [] };
                }
            }
            else if (current) {
                current.bullets.push(l.replace(bulletPattern, '').trim());
            }
        }
        if (current)
            items.push(current);
        return items.slice(0, 6);
    }
    function parseEducation(blocks) {
        const edu = [];
        const degreePattern = /(bachelor|master|mba|phd|b\.sc|m\.sc|bachelor’s|master’s)/i;
        for (const l of blocks) {
            if (!l)
                continue;
            const degree = (l.match(degreePattern) || [])[0] ?? '';
            edu.push({
                degree: degree || '',
                field: '',
                start_date: '',
                end_date: '',
                details: [l],
            });
            if (edu.length >= 4)
                break;
        }
        return edu;
    }
    const experience = parseWork(workLines.length ? workLines : lines).map((e) => ({
        company: e.company || null,
        title: e.title || null,
        start_date: e.start_date || null,
        end_date: e.end_date || null,
        location: e.location || null,
        bullets: (e.bullets || []).filter((b) => b),
    }));
    const education = parseEducation(educationLines);
    return {
        name: nameLine || '',
        contact_info: {
            email: emailMatch?.[0] || null,
            phone: phoneMatch?.[0]?.trim() || null,
            location: null,
            links: {
                linkedin: linkedinMatch?.[0] || null,
            },
        },
        summary: summary || null,
        education: education.map((e) => ({
            degree: e.degree || null,
            field: e.field || null,
            start_date: e.start_date || null,
            end_date: e.end_date || null,
            details: e.details || [],
        })),
        experience: experience.map((e) => ({
            company: e.company || null,
            title: e.title || null,
            start_date: e.start_date || null,
            end_date: e.end_date || null,
            location: e.location || null,
            bullets: e.bullets || [],
        })),
        skills,
    };
}
async function collectPageFieldsFromFrame(frame) {
    return frame.evaluate(() => {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
        const textOf = (el) => norm(el?.textContent || el?.innerText || '');
        const isVisible = (el) => {
            const cs = window.getComputedStyle(el);
            if (!cs || cs.display === 'none' || cs.visibility === 'hidden')
                return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        };
        const esc = (v) => (window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));
        const getLabelText = (el) => {
            try {
                const labels = el.labels;
                if (labels && labels.length) {
                    const t = Array.from(labels)
                        .map((n) => textOf(n))
                        .filter(Boolean);
                    if (t.length)
                        return t.join(' ');
                }
            }
            catch {
                /* ignore */
            }
            const id = el.getAttribute('id');
            if (id) {
                const lab = document.querySelector(`label[for="${esc(id)}"]`);
                const t = textOf(lab);
                if (t)
                    return t;
            }
            const wrap = el.closest('label');
            const t2 = textOf(wrap);
            return t2 || '';
        };
        const getAriaName = (el) => {
            const direct = norm(el.getAttribute('aria-label'));
            if (direct)
                return direct;
            const labelledBy = norm(el.getAttribute('aria-labelledby'));
            if (labelledBy) {
                const parts = labelledBy
                    .split(/\s+/)
                    .map((id) => textOf(document.getElementById(id)))
                    .filter(Boolean);
                return norm(parts.join(' '));
            }
            return '';
        };
        const getDescribedBy = (el) => {
            const ids = norm(el.getAttribute('aria-describedby'));
            if (!ids)
                return '';
            const parts = ids
                .split(/\s+/)
                .map((id) => textOf(document.getElementById(id)))
                .filter(Boolean);
            return norm(parts.join(' '));
        };
        const findFieldContainer = (el) => el.closest("fieldset, [role='group'], .form-group, .field, .input-group, .question, .formField, section, article, li, div") || el.parentElement;
        const collectNearbyPrompts = (el) => {
            const container = findFieldContainer(el);
            if (!container)
                return [];
            const prompts = [];
            const fieldset = el.closest('fieldset');
            if (fieldset) {
                const legend = fieldset.querySelector('legend');
                const t = textOf(legend);
                if (t)
                    prompts.push({ source: 'legend', text: t });
            }
            const candidates = container.querySelectorAll("h1,h2,h3,h4,h5,h6,p,.help,.hint,.description,[data-help],[data-testid*='help']");
            candidates.forEach((n) => {
                const t = textOf(n);
                if (t && t.length <= 350)
                    prompts.push({ source: 'container_text', text: t });
            });
            let sib = el.previousElementSibling;
            let steps = 0;
            while (sib && steps < 4) {
                const tag = sib.tagName.toLowerCase();
                if (['div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'].includes(tag)) {
                    const t = textOf(sib);
                    if (t && t.length <= 350)
                        prompts.push({ source: 'prev_sibling', text: t });
                }
                sib = sib.previousElementSibling;
                steps += 1;
            }
            return prompts;
        };
        const looksBoilerplate = (t) => {
            const s = t.toLowerCase();
            return (s.includes('privacy') ||
                s.includes('terms') ||
                s.includes('cookies') ||
                s.includes('equal opportunity') ||
                s.includes('eeo') ||
                s.includes('gdpr'));
        };
        const scorePrompt = (text, source) => {
            const s = text.toLowerCase();
            let score = 0;
            if (text.includes('?'))
                score += 6;
            if (/^(why|how|what|describe|explain|tell us|please describe|please explain)\b/i.test(text))
                score += 4;
            if (/(position|role|motivation|interested|interest|experience|background|cover letter)/i.test(text))
                score += 2;
            if (text.length >= 20 && text.length <= 220)
                score += 3;
            if (source === 'label' || source === 'aria')
                score += 5;
            if (source === 'describedby')
                score += 3;
            if (text.length > 350)
                score -= 4;
            if (looksBoilerplate(text))
                score -= 6;
            if (/^(optional|required)\b/i.test(text))
                score -= 5;
            if (s === 'optional' || s === 'required')
                score -= 5;
            return score;
        };
        const parseTextConstraints = (text) => {
            const t = text.toLowerCase();
            const out = {};
            const words = t.match(/max(?:imum)?\s*(\d+)\s*words?/);
            if (words)
                out.max_words = parseInt(words[1], 10);
            const chars = t.match(/max(?:imum)?\s*(\d+)\s*(characters|chars)/);
            if (chars)
                out.max_chars = parseInt(chars[1], 10);
            const minChars = t.match(/min(?:imum)?\s*(\d+)\s*(characters|chars)/);
            if (minChars)
                out.min_chars = parseInt(minChars[1], 10);
            return out;
        };
        const recommendedLocators = (el, bestLabel) => {
            const tag = el.tagName.toLowerCase();
            const id = el.getAttribute('id');
            const name = el.getAttribute('name');
            const placeholder = el.getAttribute('placeholder');
            const locators = {};
            if (id)
                locators.css = `#${esc(id)}`;
            else if (name)
                locators.css = `${tag}[name="${esc(name)}"]`;
            else
                locators.css = tag;
            if (bestLabel)
                locators.playwright = `getByLabel(${JSON.stringify(bestLabel)})`;
            else if (placeholder)
                locators.playwright = `getByPlaceholder(${JSON.stringify(placeholder)})`;
            else
                locators.playwright = `locator(${JSON.stringify(locators.css)})`;
            return locators;
        };
        const slug = (v) => norm(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const controls = Array.from(document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]')).slice(0, 150);
        const fields = [];
        controls.forEach((el, idx) => {
            const tag = el.tagName.toLowerCase();
            if (tag === 'input') {
                const t = (el.type || el.getAttribute('type') || 'text').toLowerCase();
                if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t))
                    return;
            }
            if (!isVisible(el))
                return;
            const label = norm(getLabelText(el));
            const ariaName = norm(getAriaName(el));
            const describedBy = norm(getDescribedBy(el));
            const placeholder = norm(el.getAttribute('placeholder'));
            const autocomplete = norm(el.getAttribute('autocomplete'));
            const name = norm(el.getAttribute('name'));
            const id = norm(el.getAttribute('id'));
            const required = Boolean(el.required);
            const type = tag === 'input'
                ? (norm(el.type || el.getAttribute('type')) || 'text').toLowerCase()
                : tag === 'textarea'
                    ? 'textarea'
                    : tag === 'select'
                        ? 'select'
                        : (el.getAttribute('role') === 'textbox' || el.getAttribute('contenteditable') === 'true')
                            ? 'richtext'
                            : tag;
            const promptCandidates = [];
            if (label)
                promptCandidates.push({ source: 'label', text: label, score: scorePrompt(label, 'label') });
            if (ariaName)
                promptCandidates.push({ source: 'aria', text: ariaName, score: scorePrompt(ariaName, 'aria') });
            if (placeholder) {
                promptCandidates.push({
                    source: 'placeholder',
                    text: placeholder,
                    score: scorePrompt(placeholder, 'placeholder'),
                });
            }
            if (describedBy) {
                promptCandidates.push({
                    source: 'describedby',
                    text: describedBy,
                    score: scorePrompt(describedBy, 'describedby'),
                });
            }
            const nearbyPrompts = collectNearbyPrompts(el);
            nearbyPrompts.forEach((p) => {
                promptCandidates.push({ ...p, score: scorePrompt(p.text, p.source) });
            });
            const best = promptCandidates
                .filter((p) => p.text)
                .sort((a, b) => b.score - a.score)[0];
            const questionText = best?.text || '';
            const locators = recommendedLocators(el, label || ariaName || questionText || placeholder);
            const constraints = {};
            const maxlen = el.getAttribute('maxlength');
            const minlen = el.getAttribute('minlength');
            if (maxlen)
                constraints.maxlength = parseInt(maxlen, 10);
            if (minlen)
                constraints.minlength = parseInt(minlen, 10);
            Object.assign(constraints, parseTextConstraints(`${questionText} ${describedBy}`));
            const textForEssay = `${questionText} ${label} ${describedBy}`.toLowerCase();
            const likelyEssay = type === 'textarea' ||
                type === 'richtext' ||
                Boolean(constraints.max_words) ||
                Boolean(constraints.max_chars && constraints.max_chars > 180) ||
                (/why|tell us|describe|explain|motivation|interest|cover letter|statement/.test(textForEssay) &&
                    (questionText.length > 0 || label.length > 0));
            const fallbackId = slug(label || ariaName || questionText || placeholder || name || '') || `field_${idx}`;
            const fieldId = id || name || fallbackId;
            fields.push({
                index: fields.length,
                field_id: fieldId,
                tag,
                type,
                id: id || null,
                name: name || null,
                label: label || null,
                ariaName: ariaName || null,
                placeholder: placeholder || null,
                describedBy: describedBy || null,
                autocomplete: autocomplete || null,
                required,
                visible: true,
                questionText: questionText || null,
                questionCandidates: promptCandidates
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 5),
                constraints,
                locators: {
                    css: locators.css,
                    playwright: locators.playwright,
                },
                selector: locators.css,
                likelyEssay,
                containerPrompts: nearbyPrompts,
            });
        });
        return fields;
    });
}
async function collectPageFields(page) {
    const frames = page.frames();
    const results = await Promise.all(frames.map(async (frame) => {
        try {
            return await collectPageFieldsFromFrame(frame);
        }
        catch (err) {
            console.error('collectPageFields frame failed', err);
            return [];
        }
    }));
    const merged = results.flat();
    if (merged.length)
        return merged.slice(0, 300);
    // fallback to main frame attempt
    try {
        return await collectPageFieldsFromFrame(page.mainFrame());
    }
    catch {
        return [];
    }
}
async function applyFillPlan(page, plan) {
    const filled = [];
    const suggestions = [];
    const blocked = [];
    for (const f of plan) {
        const action = f.action;
        const value = f.value;
        const selector = f.selector ||
            (f.field_id ? `[name="${f.field_id}"], #${f.field_id}, [id*="${f.field_id}"]` : undefined);
        if (!selector) {
            blocked.push(f.field_id ?? 'field');
            continue;
        }
        try {
            if (action === 'fill') {
                await page.fill(selector, typeof value === 'string' ? value : String(value ?? ''));
                filled.push({
                    field: f.field_id ?? selector,
                    value: typeof value === 'string' ? value : JSON.stringify(value ?? ''),
                    confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
                });
            }
            else if (action === 'select') {
                await page.selectOption(selector, { label: String(value ?? '') });
                filled.push({
                    field: f.field_id ?? selector,
                    value: String(value ?? ''),
                    confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
                });
            }
            else if (action === 'check' || action === 'uncheck') {
                if (action === 'check')
                    await page.check(selector);
                else
                    await page.uncheck(selector);
                filled.push({ field: f.field_id ?? selector, value: action });
            }
            else if (f.requires_user_review) {
                blocked.push(f.field_id ?? selector);
            }
        }
        catch {
            blocked.push(f.field_id ?? selector);
        }
    }
    return { filled, suggestions, blocked };
}
async function simplePageFill(page, baseInfo, parsedResume) {
    const fullName = [baseInfo?.name?.first, baseInfo?.name?.last].filter(Boolean).join(' ').trim();
    const email = baseInfo?.contact?.email;
    const phone = baseInfo?.contact?.phone;
    const city = baseInfo?.location?.city;
    const country = baseInfo?.location?.country;
    const linkedin = baseInfo?.links?.linkedin || parsedResume?.contact_info?.links?.linkedin;
    const company = parsedResume?.experience?.[0]?.company;
    const title = parsedResume?.experience?.[0]?.title;
    const filled = [];
    const targets = [
        { key: 'full_name', match: /full\s*name/i, value: fullName },
        { key: 'first', match: /first/i, value: baseInfo?.name?.first },
        { key: 'last', match: /last/i, value: baseInfo?.name?.last },
        { key: 'email', match: /email/i, value: email },
        { key: 'phone', match: /phone|tel/i, value: phone },
        { key: 'city', match: /city/i, value: city },
        { key: 'country', match: /country|nation/i, value: country },
        { key: 'company', match: /company|employer/i, value: company },
        { key: 'title', match: /title|position|role/i, value: title },
        { key: 'linkedin', match: /linkedin|linked\s*in/i, value: linkedin },
    ].filter((t) => t.value);
    const inputs = await page.$$('input, textarea, select');
    for (const el of inputs) {
        const props = await el.evaluate((node) => {
            const lbl = node.labels?.[0]?.innerText || '';
            return {
                tag: node.tagName.toLowerCase(),
                type: node.type || node.getAttribute('type') || 'text',
                name: node.getAttribute('name') || '',
                id: node.id || '',
                placeholder: node.getAttribute('placeholder') || '',
                label: lbl,
            };
        });
        if (props.type === 'checkbox' || props.type === 'radio' || props.type === 'file')
            continue;
        const haystack = `${props.label} ${props.name} ${props.id} ${props.placeholder}`.toLowerCase();
        const match = targets.find((t) => t.match.test(haystack));
        if (match) {
            const val = String(match.value ?? '');
            try {
                if (props.tag === 'select') {
                    await el.selectOption({ label: val });
                }
                else {
                    await el.fill(val);
                }
                filled.push({ field: props.name || props.id || match.key, value: val });
            }
            catch {
                // ignore failed fills
            }
        }
    }
    return { filled, suggestions: [], blocked: [] };
}
async function hydrateResume(resume, baseProfile) {
    let resumeText = resume.resumeText ?? '';
    if (!resumeText && resume.filePath) {
        const resolved = resolveResumePath(resume.filePath);
        resumeText = await extractResumeTextFromFile(resolved, path_1.default.basename(resume.filePath));
    }
    resumeText = sanitizeText(resumeText);
    const parsedResume = await tryParseResumeText(resume.id, resumeText, baseProfile);
    return { ...resume, resumeText, parsedResume };
}
const DEFAULT_AUTOFILL_FIELDS = [
    { field_id: 'first_name', label: 'First name', type: 'text', required: true },
    { field_id: 'last_name', label: 'Last name', type: 'text', required: true },
    { field_id: 'email', label: 'Email', type: 'text', required: true },
    { field_id: 'phone', label: 'Phone', type: 'text', required: false },
    { field_id: 'city', label: 'City', type: 'text', required: false },
    { field_id: 'country', label: 'Country', type: 'text', required: false },
    { field_id: 'work_auth', label: 'Authorized to work?', type: 'checkbox', required: false },
    {
        field_id: 'cover_letter',
        label: 'Why are you a fit?',
        type: 'textarea',
        required: false,
        surrounding_text: 'brief pitch/cover letter, keep to 2-3 sentences',
    },
];
// initDb, auth guard, signToken live in dedicated modules
async function bootstrap() {
    await app.register(auth_1.authGuard);
    await app.register(cors_1.default, { origin: true });
    await app.register(websocket_1.default);
    await (0, db_1.initDb)();
    await fs_1.promises.mkdir(RESUME_DIR, { recursive: true });
    app.get('/health', async () => ({ status: 'ok' }));
    app.get('/sessions/:id/top-resumes', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        const jdText = String(session.jobContext?.job_description_text ?? '').trim();
        if (!jdText) {
            return reply.status(400).send({ message: 'Job description missing for this session' });
        }
        try {
            const top = await getTopMatchedResumesFromSession(session, jdText, request.log);
            return top;
        }
        catch (err) {
            request.log.error({ err }, 'failed to score resumes');
            return reply.status(500).send({ message: 'Failed to score resumes' });
        }
    });
    app.post('/auth/login', async (request, reply) => {
        const schema = zod_1.z.object({ email: zod_1.z.string().email(), password: zod_1.z.string().optional() });
        const body = schema.parse(request.body);
        const user = await (0, db_1.findUserByEmail)(body.email);
        if (!user) {
            return reply.status(401).send({ message: 'Invalid credentials' });
        }
        if (user.password && body.password && !(await bcryptjs_1.default.compare(body.password, user.password))) {
            return reply.status(401).send({ message: 'Invalid credentials' });
        }
        const token = (0, auth_1.signToken)(user);
        return { token, user };
    });
    app.post('/auth/signup', async (request, reply) => {
        const schema = zod_1.z.object({
            email: zod_1.z.string().email(),
            password: zod_1.z.string().min(3),
            name: zod_1.z.string().min(2),
        });
        const body = schema.parse(request.body);
        const exists = await (0, db_1.findUserByEmail)(body.email);
        if (exists) {
            return reply.status(409).send({ message: 'Email already registered' });
        }
        const hashed = await bcryptjs_1.default.hash(body.password, 8);
        const user = {
            id: (0, crypto_1.randomUUID)(),
            email: body.email,
            role: 'OBSERVER',
            name: body.name,
            isActive: true,
            password: hashed,
        };
        await (0, db_1.insertUser)(user);
        const token = (0, auth_1.signToken)(user);
        return { token, user };
    });
    app.get('/profiles', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || actor.isActive === false) {
            return reply.status(401).send({ message: 'Unauthorized' });
        }
        const { userId } = request.query;
        if (actor.role === 'ADMIN' || actor.role === 'MANAGER') {
            if (userId) {
                const target = await (0, db_1.findUserById)(userId);
                if ((target === null || target === void 0 ? void 0 : target.role) === 'BIDDER' && target.isActive !== false) {
                    return (0, db_1.listProfilesForBidder)(target.id);
                }
            }
            return (0, db_1.listProfiles)();
        }
        if (actor.role === 'BIDDER') {
            return (0, db_1.listProfilesForBidder)(actor.id);
        }
        return reply.status(403).send({ message: 'Forbidden' });
    });
    app.post('/profiles', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can create profiles' });
        }
        const schema = zod_1.z.object({
            displayName: zod_1.z.string().min(2),
            firstName: zod_1.z.string().optional(),
            lastName: zod_1.z.string().optional(),
            email: zod_1.z.string().email().optional(),
        });
        const body = schema.parse(request.body);
        const profileId = (0, crypto_1.randomUUID)();
        const now = new Date().toISOString();
        const baseInfo = {
            name: { first: body.firstName ?? '', last: body.lastName ?? '' },
            contact: { email: body.email ?? '' },
        };
        const profile = {
            id: profileId,
            displayName: body.displayName,
            baseInfo,
            createdBy: actor.id,
            createdAt: now,
            updatedAt: now,
        };
        await (0, db_1.insertProfile)(profile);
        return profile;
    });
    app.patch('/profiles/:id', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can update profiles' });
        }
        const { id } = request.params;
        const existing = await (0, db_1.findProfileById)(id);
        if (!existing)
            return reply.status(404).send({ message: 'Profile not found' });
        const schema = zod_1.z.object({
            displayName: zod_1.z.string().min(2).optional(),
            baseInfo: zod_1.z.record(zod_1.z.any()).optional(),
        });
        const body = schema.parse(request.body ?? {});
        const incomingBase = (body.baseInfo ?? {});
        const mergedBase = {
            ...(existing.baseInfo ?? {}),
            ...(incomingBase || {}),
            name: { ...(existing.baseInfo?.name ?? {}), ...(incomingBase?.name ?? {}) },
            contact: { ...(existing.baseInfo?.contact ?? {}), ...(incomingBase?.contact ?? {}) },
            location: { ...(existing.baseInfo?.location ?? {}), ...(incomingBase?.location ?? {}) },
            workAuth: { ...(existing.baseInfo?.workAuth ?? {}), ...(incomingBase?.workAuth ?? {}) },
            links: { ...(existing.baseInfo?.links ?? {}), ...(incomingBase?.links ?? {}) },
            defaultAnswers: {
                ...(existing.baseInfo?.defaultAnswers ?? {}),
                ...(incomingBase?.defaultAnswers ?? {}),
            },
        };
        const updatedProfile = {
            ...existing,
            displayName: body.displayName ?? existing.displayName,
            baseInfo: mergedBase,
            updatedAt: new Date().toISOString(),
        };
        await (0, db_1.updateProfileRecord)({
            id: updatedProfile.id,
            displayName: updatedProfile.displayName,
            baseInfo: updatedProfile.baseInfo,
        });
        return updatedProfile;
    });
    app.get('/profiles/:id/resumes', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const profile = await (0, db_1.findProfileById)(id);
        if (!profile)
            return reply.status(404).send({ message: 'Profile not found' });
        return (0, db_1.listResumesByProfile)(id);
    });
    app.post('/profiles/:id/resumes', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can add resumes' });
        }
        const { id } = request.params;
        const profile = await (0, db_1.findProfileById)(id);
        if (!profile)
            return reply.status(404).send({ message: 'Profile not found' });
        const schema = zod_1.z.object({
            label: zod_1.z.string().optional(),
            filePath: zod_1.z.string().optional(),
            fileData: zod_1.z.string().optional(),
            fileName: zod_1.z.string().optional(),
            description: zod_1.z.string().optional(),
        });
        const body = schema.parse(request.body ?? {});
        const baseLabel = body.label?.trim() ||
            (body.fileName ? body.fileName.replace(/\.[^/.]+$/, '').trim() : '') ||
            '';
        if (baseLabel.length < 2) {
            return reply.status(400).send({ message: 'Label is required (min 2 chars)' });
        }
        if (!body.fileData && !body.filePath) {
            return reply.status(400).send({ message: 'Resume file is required' });
        }
        const resumeId = (0, crypto_1.randomUUID)();
        let filePath = body.filePath ?? '';
        let resumeText = '';
        let resumeJson;
        let resolvedPath = '';
        if (body.fileData) {
            const buffer = Buffer.from(body.fileData, 'base64');
            const ext = body.fileName && path_1.default.extname(body.fileName) ? path_1.default.extname(body.fileName) : '.pdf';
            const fileName = `${resumeId}${ext}`;
            const targetPath = path_1.default.join(RESUME_DIR, fileName);
            await fs_1.promises.writeFile(targetPath, buffer);
            filePath = `/data/resumes/${fileName}`;
            resolvedPath = targetPath;
        }
        else if (filePath) {
            resolvedPath = resolveResumePath(filePath);
        }
        if (resolvedPath) {
            resumeText = await extractResumeTextFromFile(resolvedPath, body.fileName ?? path_1.default.basename(resolvedPath));
            resumeJson = await tryParseResumeText(resumeId, resumeText, profile.baseInfo);
        }
        resumeText = sanitizeText(resumeText);
        const resumeDescription = body.description?.trim() || undefined;
        const resume = {
            id: resumeId,
            profileId: id,
            label: baseLabel,
            filePath,
            resumeText,
            resumeDescription,
            resumeJson,
            createdAt: new Date().toISOString(),
        };
        await (0, db_1.insertResumeRecord)(resume);
        return { ...resume, resumeJson };
    });
    app.delete('/profiles/:profileId/resumes/:resumeId', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can remove resumes' });
        }
        const { profileId, resumeId } = request.params;
        const profile = await (0, db_1.findProfileById)(profileId);
        if (!profile)
            return reply.status(404).send({ message: 'Profile not found' });
        const resume = await (0, db_1.findResumeById)(resumeId);
        if (!resume || resume.profileId !== profileId) {
            return reply.status(404).send({ message: 'Resume not found' });
        }
        if (resume.filePath) {
            try {
                const resolved = resolveResumePath(resume.filePath);
                if (resolved)
                    await fs_1.promises.unlink(resolved);
            }
            catch {
                // ignore missing files
            }
        }
        await (0, db_1.deleteResumeById)(resumeId);
        return { ok: true };
    });
    app.get('/resumes/:id/file', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can view resumes' });
        }
        const { id } = request.params;
        const resume = await (0, db_1.findResumeById)(id);
        if (!resume || !resume.filePath)
            return reply.status(404).send({ message: 'Resume not found' });
        const resolvedPath = resolveResumePath(resume.filePath);
        if (!resolvedPath || !fs_2.default.existsSync(resolvedPath)) {
            return reply.status(404).send({ message: 'File missing' });
        }
        reply.header('Content-Type', 'application/pdf');
        const stream = fs_2.default.createReadStream(resolvedPath);
        return reply.send(stream);
    });
    app.get('/assignments', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        return (0, db_1.listAssignments)();
    });
    app.post('/assignments', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can assign profiles' });
        }
        const schema = zod_1.z.object({
            profileId: zod_1.z.string(),
            bidderUserId: zod_1.z.string(),
            assignedBy: zod_1.z.string().optional(),
        });
        const body = schema.parse(request.body);
        const profile = await (0, db_1.findProfileById)(body.profileId);
        const bidder = await (0, db_1.findUserById)(body.bidderUserId);
        if (!profile || !bidder || bidder.role !== 'BIDDER') {
            return reply.status(400).send({ message: 'Invalid profile or bidder' });
        }
        const existing = await (0, db_1.findActiveAssignmentByProfile)(body.profileId);
        if (existing) {
            return reply
                .status(409)
                .send({ message: 'Profile already assigned', assignmentId: existing.id });
        }
        const newAssignment = {
            id: body.profileId,
            profileId: body.profileId,
            bidderUserId: body.bidderUserId,
            assignedBy: actor.id ?? body.assignedBy ?? body.bidderUserId,
            assignedAt: new Date().toISOString(),
            unassignedAt: null,
        };
        await (0, db_1.insertAssignmentRecord)(newAssignment);
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: 'admin-event',
            eventType: 'ASSIGNED',
            payload: { profileId: body.profileId, bidderUserId: body.bidderUserId },
            createdAt: new Date().toISOString(),
        });
        return newAssignment;
    });
    app.post('/assignments/:id/unassign', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const assignment = await (0, db_1.closeAssignmentById)(id);
        if (!assignment)
            return reply.status(404).send({ message: 'Assignment not found' });
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: 'admin-event',
            eventType: 'UNASSIGNED',
            payload: { profileId: assignment.profileId, bidderUserId: assignment.bidderUserId },
            createdAt: new Date().toISOString(),
        });
        return assignment;
    });
    app.get('/sessions/:id', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        return session;
    });
    app.post('/sessions', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || actor.isActive === false) {
            return reply.status(401).send({ message: 'Unauthorized' });
        }
        const schema = zod_1.z.object({
            bidderUserId: zod_1.z.string(),
            profileId: zod_1.z.string(),
            url: zod_1.z.string(),
            selectedResumeId: zod_1.z.string().optional(),
        });
        const body = schema.parse(request.body);
        const profileAssignment = await (0, db_1.findActiveAssignmentByProfile)(body.profileId);
        let bidderUserId = body.bidderUserId;
        if (actor.role === 'BIDDER') {
            bidderUserId = actor.id;
            if (profileAssignment && profileAssignment.bidderUserId !== actor.id) {
                return reply.status(403).send({ message: 'Profile not assigned to bidder' });
            }
        }
        else if (actor.role === 'MANAGER' || actor.role === 'ADMIN') {
            if (!bidderUserId && profileAssignment)
                bidderUserId = profileAssignment.bidderUserId;
            if (!bidderUserId)
                bidderUserId = actor.id;
        }
        else {
            return reply.status(403).send({ message: 'Forbidden' });
        }
        const session = {
            id: (0, crypto_1.randomUUID)(),
            bidderUserId,
            profileId: body.profileId,
            url: body.url,
            domain: tryExtractDomain(body.url),
            status: 'OPEN',
            selectedResumeId: body.selectedResumeId,
            startedAt: new Date().toISOString(),
        };
        data_1.sessions.unshift(session);
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: session.id,
            eventType: 'SESSION_CREATED',
            payload: { url: session.url },
            createdAt: new Date().toISOString(),
        });
        return session;
    });
    app.post('/sessions/:id/go', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        session.status = 'OPEN';
        try {
            await startBrowserSession(session);
        }
        catch (err) {
            app.log.error({ err }, 'failed to start browser session');
        }
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: id,
            eventType: 'GO_CLICKED',
            payload: { url: session.url },
            createdAt: new Date().toISOString(),
        });
        return { ok: true };
    });
    app.post('/sessions/:id/analyze', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        const body = request.body ?? {};
        const useAi = Boolean(body.useAi);
        const analysis = await (0, resumeClassifier_1.analyzeJobFromUrl)(session.url);
        session.status = 'ANALYZED';
        session.jobContext = {
            title: analysis.title || 'Job',
            company: 'N/A',
            summary: 'Analysis from job description',
            job_description_text: analysis.jobText ?? '',
        };
        if (!useAi) {
            const topTech = (analysis.ranked ?? []).slice(0, 4);
            data_1.events.push({
                id: (0, crypto_1.randomUUID)(),
                sessionId: id,
                eventType: 'ANALYZE_DONE',
                payload: {
                    recommendedLabel: analysis.recommendedLabel,
                },
                createdAt: new Date().toISOString(),
            });
            return {
                mode: 'tech',
                recommendedLabel: analysis.recommendedLabel,
                ranked: topTech.map((t, idx) => ({
                    id: t.id ?? t.label ?? `tech-${idx}`,
                    label: t.label,
                    rank: idx + 1,
                    score: t.score,
                })),
                scores: analysis.rawScores,
                jobContext: session.jobContext,
            };
        }
        const jdText = String(session.jobContext?.job_description_text ?? '');
        const topResumes = jdText ? await getTopMatchedResumesFromSession(session, jdText, request.log) : [];
        session.recommendedResumeId = topResumes[0]?.id ?? analysis.recommendedResumeId;
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: id,
            eventType: 'ANALYZE_DONE',
            payload: {
                recommendedLabel: topResumes[0]?.title ?? analysis.recommendedLabel,
                recommendedResumeId: topResumes[0]?.id ?? analysis.recommendedResumeId,
            },
            createdAt: new Date().toISOString(),
        });
        return {
            mode: 'resume',
            recommendedResumeId: topResumes[0]?.id ?? analysis.recommendedResumeId,
            recommendedLabel: topResumes[0]?.title ?? analysis.recommendedLabel,
            ranked: topResumes.map((r, idx) => ({ id: r.id, label: r.title, rank: idx + 1, score: r.score })),
            scores: {},
            jobContext: session.jobContext,
        };
    });
    // Prompt-pack endpoints (HF-backed)
    app.post('/llm/resume-parse', async (request, reply) => {
        const { resumeText, resumeId, filename, baseProfile } = request.body;
        if (!resumeText || !resumeId)
            return reply.status(400).send({ message: 'resumeText and resumeId are required' });
        const prompt = resumeClassifier_1.promptBuilders.buildResumeParsePrompt({
            resumeId,
            filename,
            resumeText,
            baseProfile,
        });
        const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
        if (!parsed)
            return reply.status(502).send({ message: 'LLM parse failed' });
        return parsed;
    });
    app.post('/llm/job-analyze', async (request, reply) => {
        const { job, baseProfile, prefs } = request.body;
        if (!job?.job_description_text)
            return reply.status(400).send({ message: 'job_description_text required' });
        const prompt = resumeClassifier_1.promptBuilders.buildJobAnalyzePrompt({
            job,
            baseProfile,
            prefs,
        });
        const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
        if (!parsed)
            return reply.status(502).send({ message: 'LLM analyze failed' });
        return parsed;
    });
    app.post('/llm/rank-resumes', async (request, reply) => {
        const { job, resumes, baseProfile, prefs } = request.body;
        if (!job?.job_description_text || !Array.isArray(resumes)) {
            return reply.status(400).send({ message: 'job_description_text and resumes[] required' });
        }
        const prompt = resumeClassifier_1.promptBuilders.buildRankResumesPrompt({
            job,
            resumes,
            baseProfile,
            prefs,
        });
        const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
        if (!parsed)
            return reply.status(502).send({ message: 'LLM rank failed' });
        return parsed;
    });
    app.post('/llm/autofill-plan', async (request, reply) => {
        const { pageFields, baseProfile, prefs, jobContext, selectedResume, pageContext } = request.body;
        if (!Array.isArray(pageFields))
            return reply.status(400).send({ message: 'pageFields[] required' });
        const prompt = resumeClassifier_1.promptBuilders.buildAutofillPlanPrompt({
            pageFields,
            baseProfile,
            prefs,
            jobContext,
            selectedResume,
            pageContext,
        });
        const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
        if (!parsed)
            return reply.status(502).send({ message: 'LLM autofill failed' });
        return parsed;
    });
    app.post('/sessions/:id/autofill', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const body = request.body ?? {};
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        const profile = await (0, db_1.findProfileById)(session.profileId);
        if (!profile)
            return reply.status(404).send({ message: 'Profile not found' });
        if (body.selectedResumeId) {
            session.selectedResumeId = body.selectedResumeId;
        }
        const profileResumes = await (0, db_1.listResumesByProfile)(session.profileId);
        const resumeId = session.selectedResumeId ?? session.recommendedResumeId ?? body.selectedResumeId ?? profileResumes[0]?.id;
        const resumeRecord = resumeId ? await (0, db_1.findResumeById)(resumeId) : undefined;
        const hydratedResume = resumeRecord ? await hydrateResume(resumeRecord, profile.baseInfo) : undefined;
        const live = livePages.get(id);
        const page = live?.page;
        let pageFields = [];
        if (page) {
            try {
                pageFields = await collectPageFields(page);
            }
            catch (err) {
                request.log.error({ err }, 'collectPageFields failed');
            }
        }
        // Fallback: if no live page or nothing detected, spin up a fresh headless page to capture fields.
        if ((!page || pageFields.length === 0) && session.url) {
            try {
                const browser = await playwright_1.chromium.launch({ headless: true });
                const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
                const tmpPage = await context.newPage();
                await tmpPage.goto(session.url, { waitUntil: 'domcontentloaded', timeout: 20000 });
                // small settle time for dynamic renderers
                await tmpPage.waitForTimeout(800);
                await tmpPage
                    .waitForSelector('input, textarea, select, [contenteditable="true"], [role="textbox"]', { timeout: 5000 })
                    .catch(() => { });
                pageFields = await collectPageFields(tmpPage);
                await browser.close();
            }
            catch (err) {
                request.log.error({ err }, 'collectPageFields headless fallback failed');
            }
        }
        let candidateFields = Array.isArray(body.pageFields) && body.pageFields.length > 0
            ? body.pageFields
            : pageFields.length
                ? pageFields
                : DEFAULT_AUTOFILL_FIELDS;
        let fillPlan = buildDemoFillPlan(profile.baseInfo);
        try {
            if (hydratedResume?.resumeText) {
                const prompt = resumeClassifier_1.promptBuilders.buildAutofillPlanPrompt({
                    pageFields: candidateFields,
                    baseProfile: profile.baseInfo ?? {},
                    prefs: {},
                    jobContext: session.jobContext ?? {},
                    selectedResume: {
                        resume_id: hydratedResume.id,
                        label: hydratedResume.label,
                        parsed_resume_json: hydratedResume.parsedResume ?? {},
                        resume_text: hydratedResume.resumeText,
                    },
                    pageContext: { url: session.url },
                });
                const parsed = await (0, resumeClassifier_1.callPromptPack)(prompt);
                const llmPlan = parsed?.result?.fill_plan;
                if (Array.isArray(llmPlan)) {
                    const applied = page ? await applyFillPlan(page, llmPlan) : { filled: [], blocked: [], suggestions: [] };
                    const filledFromPlan = llmPlan
                        .filter((f) => (f.action === 'fill' || f.action === 'select') && f.value)
                        .map((f) => ({
                        field: f.field_id ?? f.selector ?? f.label ?? 'field',
                        value: typeof f.value === 'string' ? f.value : JSON.stringify(f.value ?? ''),
                        confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
                    }));
                    const suggestions = (Array.isArray(parsed?.warnings) ? parsed?.warnings : []).map((w) => ({
                        field: 'note',
                        suggestion: String(w),
                    })) ?? [];
                    const blocked = llmPlan
                        .filter((f) => f.requires_user_review)
                        .map((f) => f.field_id ?? f.selector ?? 'field');
                    fillPlan = {
                        filled: [...filledFromPlan, ...(applied.filled ?? [])],
                        suggestions: [...suggestions, ...(applied.suggestions ?? [])],
                        blocked: [...blocked, ...(applied.blocked ?? [])],
                    };
                    if ((!fillPlan.filled || fillPlan.filled.length === 0) && page) {
                        const simple = await simplePageFill(page, profile.baseInfo, hydratedResume.parsedResume);
                        fillPlan = {
                            filled: [...(fillPlan.filled ?? []), ...(simple.filled ?? [])],
                            suggestions: [...(fillPlan.suggestions ?? []), ...(simple.suggestions ?? [])],
                            blocked: [...(fillPlan.blocked ?? []), ...(simple.blocked ?? [])],
                        };
                    }
                }
            }
        }
        catch (err) {
            request.log.error({ err }, 'LLM autofill failed, using demo plan');
            if (page) {
                try {
                    fillPlan = await simplePageFill(page, profile.baseInfo, hydratedResume?.parsedResume);
                }
                catch (e) {
                    request.log.error({ err: e }, 'simplePageFill failed');
                }
            }
        }
        session.status = 'FILLED';
        session.selectedResumeId = resumeId ?? session.selectedResumeId;
        session.fillPlan = fillPlan;
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: id,
            eventType: 'AUTOFILL_DONE',
            payload: session.fillPlan,
            createdAt: new Date().toISOString(),
        });
        return { fillPlan: session.fillPlan, pageFields, candidateFields };
    });
    app.post('/sessions/:id/mark-submitted', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { id } = request.params;
        const session = data_1.sessions.find((s) => s.id === id);
        if (!session)
            return reply.status(404).send({ message: 'Session not found' });
        session.status = 'SUBMITTED';
        session.endedAt = new Date().toISOString();
        await stopBrowserSession(id);
        data_1.events.push({
            id: (0, crypto_1.randomUUID)(),
            sessionId: id,
            eventType: 'SUBMITTED',
            createdAt: new Date().toISOString(),
        });
        return { status: session.status };
    });
    app.get('/sessions', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const bidderUserId = request.query.bidderUserId;
        const filtered = bidderUserId
            ? data_1.sessions.filter((s) => s.bidderUserId === bidderUserId)
            : data_1.sessions;
        return filtered;
    });
    app.get('/users', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const { role } = request.query;
        const roleFilter = role ? role.toUpperCase() : null;
        const baseSql = `
      SELECT id, email, name, role, is_active as "isActive"
      FROM users
      WHERE is_active = TRUE
    `;
        const sql = roleFilter
            ? `${baseSql} AND role = $1 ORDER BY created_at ASC`
            : `${baseSql} AND role <> 'OBSERVER' ORDER BY created_at ASC`;
        const params = roleFilter ? [roleFilter] : [];
        const { rows } = await db_1.pool.query(sql, params);
        return rows;
    });
    app.patch('/users/:id/role', async (request, reply) => {
        const actor = request.authUser;
        if (!actor || actor.role !== 'ADMIN') {
            return reply.status(403).send({ message: 'Only admins can update roles' });
        }
        const { id } = request.params;
        const schema = zod_1.z.object({ role: zod_1.z.enum(['ADMIN', 'MANAGER', 'BIDDER', 'OBSERVER']) });
        const body = schema.parse(request.body);
        await db_1.pool.query('UPDATE users SET role = $1 WHERE id = $2', [body.role, id]);
        const updated = await (0, db_1.findUserById)(id);
        return updated;
    });
    app.get('/metrics/my', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const bidderUserId = request.query.bidderUserId;
        const userSessions = bidderUserId
            ? data_1.sessions.filter((s) => s.bidderUserId === bidderUserId)
            : data_1.sessions;
        const tried = userSessions.length;
        const submitted = userSessions.filter((s) => s.status === 'SUBMITTED').length;
        const percentage = tried === 0 ? 0 : Math.round((submitted / tried) * 100);
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const monthlyApplied = userSessions.filter((s) => s.status === 'SUBMITTED' &&
            s.startedAt &&
            new Date(s.startedAt).getTime() >= monthStart.getTime()).length;
        return {
            tried,
            submitted,
            appliedPercentage: percentage,
            monthlyApplied,
            recent: userSessions.slice(0, 5),
        };
    });
    app.get('/settings/llm', async () => data_1.llmSettings[0]);
    app.post('/settings/llm', async (request) => {
        const schema = zod_1.z.object({
            provider: zod_1.z.enum(['OPENAI', 'HUGGINGFACE']),
            chatModel: zod_1.z.string(),
            embedModel: zod_1.z.string(),
            encryptedApiKey: zod_1.z.string(),
        });
        const body = schema.parse(request.body);
        const current = data_1.llmSettings[0];
        data_1.llmSettings[0] = {
            ...current,
            ...body,
            updatedAt: new Date().toISOString(),
        };
        return data_1.llmSettings[0];
    });
    app.get('/manager/bidders/summary', async (request, reply) => {
        if ((0, auth_1.forbidObserver)(reply, request.authUser))
            return;
        const actor = request.authUser;
        if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
            return reply.status(403).send({ message: 'Only managers or admins can view bidders' });
        }
        const rows = await (0, db_1.listBidderSummaries)();
        return rows;
    });
    app.ready((err) => {
        if (err)
            app.log.error(err);
    });
    app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
        if (err) {
            app.log.error(err);
            process.exit(1);
        }
        app.log.info(`API running on http://localhost:${PORT}`);
    });
    app.get('/ws/browser/:sessionId', { websocket: true }, async (connection, req) => {
        // Allow ws without auth for now to keep demo functional
        const { sessionId } = req.params;
        const live = livePages.get(sessionId);
        if (!live) {
            connection.socket.send(JSON.stringify({ type: 'error', message: 'No live browser' }));
            connection.socket.close();
            return;
        }
        const { page } = live;
        const sendFrame = async () => {
            try {
                const buf = await page.screenshot({ fullPage: true });
                connection.socket.send(JSON.stringify({ type: 'frame', data: buf.toString('base64') }));
            }
            catch (err) {
                connection.socket.send(JSON.stringify({ type: 'error', message: 'Could not capture frame' }));
            }
        };
        // Send frames every second
        const interval = setInterval(sendFrame, 1000);
        livePages.set(sessionId, { ...live, interval });
        connection.socket.on('close', () => {
            clearInterval(interval);
            const current = livePages.get(sessionId);
            if (current) {
                livePages.set(sessionId, { browser: current.browser, page: current.page });
            }
        });
    });
}
function tryExtractDomain(url) {
    try {
        const u = new URL(url);
        return u.hostname;
    }
    catch {
        return undefined;
    }
}
function buildDemoFillPlan(baseInfo) {
    const safeFields = [
        { field: 'first_name', value: baseInfo?.name?.first, confidence: 0.98 },
        { field: 'last_name', value: baseInfo?.name?.last, confidence: 0.98 },
        { field: 'email', value: baseInfo?.contact?.email, confidence: 0.97 },
        { field: 'phone', value: baseInfo?.contact?.phone, confidence: 0.8 },
    ];
    const filled = safeFields
        .filter((f) => Boolean(f.value))
        .map((f) => ({ field: f.field, value: String(f.value ?? ''), confidence: f.confidence }));
    return {
        filled,
        suggestions: [{ field: 'cover_letter', suggestion: 'Short note about relevant skills' }],
        blocked: ['EEO', 'veteran_status', 'disability'],
    };
}
function resolveResumePath(p) {
    if (!p)
        return '';
    if (path_1.default.isAbsolute(p)) {
        // If an absolute path was previously stored, fall back to the shared resumes directory using the filename.
        const fileName = path_1.default.basename(p);
        return path_1.default.join(RESUME_DIR, fileName);
    }
    const normalized = p.replace(/\\/g, '/');
    if (normalized.startsWith('/data/resumes/')) {
        const fileName = normalized.split('/').pop() ?? '';
        return path_1.default.join(RESUME_DIR, fileName);
    }
    if (normalized.startsWith('/resumes/')) {
        const fileName = normalized.split('/').pop() ?? '';
        return path_1.default.join(RESUME_DIR, fileName);
    }
    const trimmed = normalized.replace(/^\.?\\?\//, '');
    return path_1.default.join(PROJECT_ROOT, trimmed);
}
bootstrap();
function normalizeScore(parsed) {
    const val = typeof parsed === 'number'
        ? parsed
        : typeof parsed === 'string'
            ? Number(parsed)
            : typeof parsed?.score === 'number'
                ? parsed.score
                : typeof parsed?.result?.score === 'number'
                    ? parsed.result.score
                    : undefined;
    if (typeof val === 'number' && !Number.isNaN(val) && val >= 0 && val <= 100) {
        return val;
    }
    return undefined;
}
const STOP_WORDS = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'this',
    'that',
    'you',
    'your',
    'are',
    'will',
    'have',
    'our',
    'we',
    'they',
    'their',
    'about',
    'into',
    'what',
    'when',
    'where',
    'which',
    'while',
    'without',
    'within',
    'such',
    'using',
    'used',
    'use',
    'role',
    'team',
    'work',
    'experience',
    'skills',
    'ability',
    'strong',
    'including',
    'include',
]);
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/[^a-z0-9+\.#]+/g)
        .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}
function topKeywordsFromJd(jdText, limit = 12) {
    const counts = new Map();
    for (const token of tokenize(jdText)) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([k]) => k);
}
function overlapCount(tokens, keywords) {
    let count = 0;
    for (const k of keywords) {
        if (tokens.has(k))
            count += 1;
    }
    return count;
}
async function callHfScore(prompt, logger, resumeId) {
    if (!HF_TOKEN) {
        logger?.warn({ resumeId }, 'hf-score-skip-no-token');
        return undefined;
    }
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
                max_tokens: 128,
                temperature: 0.1,
                top_p: 0.9,
                n: 1,
            }),
        });
        const data = (await res.json());
        const choiceContent = data?.choices?.[0]?.message?.content ||
            (Array.isArray(data) && data[0]?.generated_text) ||
            data?.generated_text ||
            data?.text;
        const text = typeof choiceContent === 'string' ? choiceContent.trim() : undefined;
        if (text) {
            try {
                return JSON.parse(text);
            }
            catch {
                logger?.warn({ resumeId }, 'hf-score-parse-text-failed');
            }
        }
        if (data && typeof data === 'object' && !data.error)
            return data;
        logger?.warn({ resumeId, data }, 'hf-score-unexpected-response');
    }
    catch (err) {
        logger?.error({ resumeId }, 'hf-score-call-failed');
    }
    return undefined;
}
async function scoreResumeWithHf(jdText, resumeText, logger, resumeId, opts) {
    if (!jdText.trim() || !resumeText.trim()) {
        logger?.warn({ resumeId }, 'hf-score-skip-empty');
        return undefined;
    }
    const prompt = `You are a resume matcher. Score how well the resume fits the job.
Return ONLY valid JSON: {"score": number_between_0_and_100}
- 100 = perfect fit, 0 = not a fit.
- Emphasize required skills, title fit, and domain.
- Ignore formatting; be concise.
Job Title: ${opts?.title ?? 'Unknown'}
Key skills to emphasize: ${opts?.keywords?.join(', ') || 'n/a'}
Job Description (truncated):
${jdText.slice(0, 3000)}

Resume (truncated):
${resumeText.slice(0, 6000)}
`;
    try {
        const parsed = (await callHfScore(prompt, logger, resumeId)) ?? (await (0, resumeClassifier_1.callPromptPack)(prompt));
        const scoreVal = normalizeScore(parsed);
        if (typeof scoreVal === 'number')
            return Math.round(scoreVal);
        logger?.warn({ resumeId, parsed }, 'hf-score-parse-failed');
    }
    catch {
        logger?.error({ resumeId }, 'hf-score-exception');
    }
}
async function getTopMatchedResumesFromSession(session, jdText, logger) {
    const profile = await (0, db_1.findProfileById)(session.profileId);
    const resumesForProfile = await (0, db_1.listResumesByProfile)(session.profileId);
    const limited = resumesForProfile.slice(0, 200);
    const keywords = topKeywordsFromJd(jdText);
    const keywordSet = new Set(keywords);
    const title = session.jobContext?.title;
    const scored = [];
    for (const r of limited) {
        let hydrated = r;
        try {
            hydrated = await hydrateResume(r, profile?.baseInfo);
        }
        catch {
            // ignore hydrate errors, fall back to DB text
        }
        const resumeText = hydrated.resumeText ?? '';
        const hfScore = await scoreResumeWithHf(jdText, resumeText, logger, r.id, { title, keywords });
        const finalScore = typeof hfScore === 'number' ? hfScore : 0;
        const resumeTokens = new Set(tokenize(resumeText));
        const tie = overlapCount(resumeTokens, keywordSet);
        logger.info({ resumeId: r.id, score: finalScore, tie }, 'resume-scored');
        scored.push({ id: r.id, title: r.label, score: finalScore, tie });
    }
    return scored
        .sort((a, b) => b.score - a.score || b.tie - a.tie || a.title.localeCompare(b.title))
        .slice(0, 4);
}
async function startBrowserSession(session) {
    const existing = livePages.get(session.id);
    if (existing) {
        await existing.page.goto(session.url, { waitUntil: 'domcontentloaded' });
        await focusFirstField(existing.page);
        return;
    }
    const browser = await playwright_1.chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
    await page.goto(session.url, { waitUntil: 'domcontentloaded' });
    await focusFirstField(page);
    livePages.set(session.id, { browser, page });
}
async function stopBrowserSession(sessionId) {
    const live = livePages.get(sessionId);
    if (!live)
        return;
    if (live.interval)
        clearInterval(live.interval);
    await live.page.close().catch(() => undefined);
    await live.browser.close().catch(() => undefined);
    livePages.delete(sessionId);
}
async function focusFirstField(page) {
    try {
        const locator = page.locator('input, textarea, select').first();
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
    }
    catch {
        // ignore
    }
}
