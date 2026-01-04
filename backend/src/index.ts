import 'dotenv/config';
import fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import fsSync from 'fs';
import { z } from 'zod';
import { chromium, Browser, Page, Frame } from 'playwright';
import bcrypt from 'bcryptjs';
import pdfParse from 'pdf-parse';
import { extractRawText } from 'mammoth';
import { events, llmSettings, sessions } from './data';
import {
  ApplicationRecord,
  ApplicationSession,
  Assignment,
  BaseInfo,
  LabelAlias,
  Resume,
  SessionStatus,
  User,
  UserRole,
} from './types';
import { authGuard, forbidObserver, signToken } from './auth';
import {
  closeAssignmentById,
  deleteResumeById,
  findActiveAssignmentByProfile,
  deleteLabelAlias,
  findLabelAliasById,
  findLabelAliasByNormalized,
  findProfileById,
  findResumeById,
  findUserByEmail,
  findUserById,
  initDb,
  insertProfile,
  findProfileAccountById,
  listProfileAccountsForUser,
  upsertProfileAccount,
  touchProfileAccount,
  insertLabelAlias,
  insertApplication,
  insertAssignmentRecord,
  insertResumeRecord,
  insertUser,
  listApplications,
  listAssignments,
  listBidderSummaries,
  listLabelAliases,
  listProfiles,
  listProfilesForBidder,
  listResumesByProfile,
  pool,
  updateProfileRecord,
  updateLabelAliasRecord,
} from './db';
import {
  CANONICAL_LABEL_KEYS,
  DEFAULT_LABEL_ALIASES,
  buildAliasIndex,
  buildApplicationSuccessPhrases,
  matchLabelToCanonical,
  normalizeLabelAlias,
} from './labelAliases';
import { analyzeJobFromHtml, callPromptPack, promptBuilders } from './resumeClassifier';
import { loadOutlookEvents } from './msGraph';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
const app = fastify({ logger: true });
const PROJECT_ROOT = path.join(__dirname, '..');
const RESUME_DIR = process.env.RESUME_DIR ?? path.join(PROJECT_ROOT, 'data', 'resumes');
const HF_TOKEN =
  process.env.HF_TOKEN || process.env.HUGGINGFACEHUB_API_TOKEN || process.env.HUGGING_FACE_TOKEN || '';
const HF_MODEL = process.env.HF_MODEL || 'meta-llama/Meta-Llama-3-8B-Instruct';

const livePages = new Map<
  string,
  { browser: Browser; page: Page; interval?: NodeJS.Timeout }
>();

type FillPlanResult = {
  filled?: { field: string; value: string; confidence?: number }[];
  suggestions?: { field: string; suggestion: string }[];
  blocked?: string[];
  actions?: FillPlanAction[];
};

type FillPlanAction = {
  field: string;
  field_id?: string;
  label?: string;
  selector?: string;
  action: 'fill' | 'select' | 'check' | 'uncheck' | 'click' | 'upload' | 'skip';
  value?: string;
  confidence?: number;
};

function trimString(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (typeof val === 'number') return String(val);
  return '';
}

function formatPhone(contact?: BaseInfo['contact']) {
  if (!contact) return '';
  const parts = [contact.phoneCode, contact.phoneNumber].map(trimString).filter(Boolean);
  const combined = parts.join(' ').trim();
  const fallback = trimString(contact.phone);
  return combined || fallback;
}

function mergeBaseInfo(existing?: BaseInfo, incoming?: Partial<BaseInfo>): BaseInfo {
  const current = existing ?? {};
  const next = incoming ?? {};
  const merged: BaseInfo = {
    ...current,
    ...next,
    name: { ...(current.name ?? {}), ...(next.name ?? {}) },
    contact: { ...(current.contact ?? {}), ...(next.contact ?? {}) },
    location: { ...(current.location ?? {}), ...(next.location ?? {}) },
    workAuth: { ...(current.workAuth ?? {}), ...(next.workAuth ?? {}) },
    links: { ...(current.links ?? {}), ...(next.links ?? {}) },
    career: { ...(current.career ?? {}), ...(next.career ?? {}) },
    education: { ...(current.education ?? {}), ...(next.education ?? {}) },
    preferences: { ...(current.preferences ?? {}), ...(next.preferences ?? {}) },
    defaultAnswers: { ...(current.defaultAnswers ?? {}), ...(next.defaultAnswers ?? {}) },
  };
  const phone = formatPhone(merged.contact);
  if (phone) {
    merged.contact = { ...(merged.contact ?? {}), phone };
  }
  return merged;
}

function parseSalaryNumber(input?: string | number | null) {
  if (typeof input === 'number' && Number.isFinite(input)) return input;
  if (typeof input !== 'string') return undefined;
  const cleaned = input.replace(/[, ]+/g, '').replace(/[^0-9.]/g, '');
  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function computeHourlyRate(desiredSalary?: string | number | null) {
  const annual = parseSalaryNumber(desiredSalary);
  if (!annual || annual <= 0) return undefined;
  return Math.floor(annual / 12 / 160);
}

function buildAutofillValueMap(
  baseInfo: BaseInfo,
  jobContext?: Record<string, unknown>,
): Record<string, string> {
  const firstName = trimString(baseInfo?.name?.first);
  const lastName = trimString(baseInfo?.name?.last);
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const email = trimString(baseInfo?.contact?.email);
  const phoneCode = trimString(baseInfo?.contact?.phoneCode);
  const phoneNumber = trimString(baseInfo?.contact?.phoneNumber);
  const formattedPhone = phoneCode && phoneNumber ? `${phoneCode} ${phoneNumber}`.trim() : formatPhone(baseInfo?.contact);
  const address = trimString(baseInfo?.location?.address);
  const city = trimString(baseInfo?.location?.city);
  const state = trimString(baseInfo?.location?.state);
  const country = trimString(baseInfo?.location?.country);
  const postalCode = trimString(baseInfo?.location?.postalCode);
  const linkedin = trimString(baseInfo?.links?.linkedin);
  const jobTitle = trimString(baseInfo?.career?.jobTitle) || trimString((jobContext as any)?.job_title);
  const currentCompany =
    trimString(baseInfo?.career?.currentCompany) || trimString((jobContext as any)?.company) || trimString((jobContext as any)?.employer);
  const yearsExp = trimString(baseInfo?.career?.yearsExp);
  const desiredSalary = trimString(baseInfo?.career?.desiredSalary);
  const hourlyRate = computeHourlyRate(desiredSalary);
  const school = trimString(baseInfo?.education?.school);
  const degree = trimString(baseInfo?.education?.degree);
  const majorField = trimString(baseInfo?.education?.majorField);
  const graduationDate = trimString(baseInfo?.education?.graduationAt);
  const currentLocation = [city, state, country].filter(Boolean).join(', ');
  const phoneCountryCode =
    phoneCode || (formattedPhone.startsWith('+') ? formattedPhone.split(/\s+/)[0] : trimString(baseInfo?.contact?.phone));

  const values: Record<string, string> = {
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    preferred_name: firstName || fullName,
    pronouns: 'Mr',
    email,
    phone: formattedPhone,
    phone_country_code: phoneCountryCode,
    address_line1: address,
    city,
    state_province_region: state,
    postal_code: postalCode,
    country,
    current_location: currentLocation,
    linkedin_url: linkedin,
    job_title: jobTitle,
    current_company: currentCompany,
    years_experience: yearsExp,
    desired_salary: desiredSalary,
    hourly_rate: hourlyRate !== undefined ? String(hourlyRate) : '',
    start_date: 'immediately',
    notice_period: '0',
    school,
    degree,
    major_field: majorField,
    graduation_date: graduationDate,
    eeo_gender: 'man',
    eeo_race_ethnicity: 'white',
    eeo_veteran: 'no veteran',
    eeo_disability: 'no disability',
  };
  return values;
}

function sanitizeText(input: string | undefined | null) {
  if (!input) return '';
  return input.replace(/\u0000/g, '');
}

function looksBinary(buf: Buffer) {
  if (!buf || !buf.length) return false;
  const sample = buf.subarray(0, Math.min(buf.length, 1024));
  let nonText = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    // allow tab/newline/carriage return and basic printable range
    if (byte < 9 || (byte > 13 && byte < 32) || byte > 126) {
      nonText += 1;
    }
  }
  return nonText / sample.length > 0.3;
}

async function extractResumeTextFromFile(filePath: string, fileName?: string) {
  try {
    const ext = (fileName ?? path.extname(filePath)).toLowerCase();
    const buf = await fs.readFile(filePath);

    // Try magic-header detection for PDF when extension is missing/misleading.
    if (buf.subarray(0, 4).toString() === '%PDF') {
      try {
        const parsed = await pdfParse(buf);
        if (parsed.text?.trim()) return sanitizeText(parsed.text);
      } catch {
        // fall through
      }
    }

    if (ext === '.txt') {
      return sanitizeText(buf.toString('utf8'));
    }
    if (ext === '.docx') {
      const res = await extractRawText({ path: filePath });
      return sanitizeText(res.value ?? '');
    }
    if (ext === '.pdf') {
      const parsed = await pdfParse(buf);
      return sanitizeText(parsed.text ?? '');
    }
    if (looksBinary(buf)) {
      return '';
    }
    return sanitizeText(buf.toString('utf8'));
  } catch (err) {
    console.error('extractResumeTextFromFile failed', err);
    return '';
  }
}

async function saveParsedResumeJson(resumeId: string, parsed: unknown) {
}

async function tryParseResumeText(resumeId: string, resumeText: string, baseProfile?: BaseInfo) {
  if (!resumeText?.trim()) return undefined;
  try {
    const prompt = promptBuilders.buildResumeParsePrompt({
      resumeId,
      resumeText,
      baseProfile,
    });
    const parsed = await callPromptPack(prompt);
    if (parsed?.result) return parsed.result;
    if (parsed) return parsed;
  } catch (err) {
    console.error('LLM resume parse failed', err);
  }
  return simpleParseResume(resumeText);
}

function simpleParseResume(resumeText: string) {
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
  const endIdx = (idx: number) => {
    const cutoffs = [workIdx, eduIdx].filter((n) => n >= 0 && n > idx);
    return cutoffs.length ? Math.min(...cutoffs) : lines.length;
  };

  function sliceSection(idx: number) {
    if (idx < 0) return [];
    return lines.slice(idx + 1, endIdx(idx));
  }

  const workLines = sliceSection(workIdx);
  const educationLines = sliceSection(eduIdx);

  function parseWork(blocks: string[]) {
    const items: any[] = [];
    let current: any | null = null;
    const datePattern = /(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s*\d{4})/i;
    const rangePattern = /(\d{4})\s*[–-]\s*(Present|\d{4})/i;
    const bulletPattern = /^[\u2022*\-•]+\s*/;
    for (const l of blocks) {
      const isBullet = bulletPattern.test(l);
      if (!isBullet) {
        // treat as new role/company line when it looks like a heading
        const looksLikeRole =
          /engineer|developer|manager|lead|architect|consultant|specialist|director/i.test(l) ||
          rangePattern.test(l) ||
          datePattern.test(l);
        if (current) items.push(current);
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
            bullets: [] as string[],
          };
        } else if (current) {
          current.company = `${current.company} ${l}`.trim();
        } else {
          current = { company: l, title: '', start_date: '', end_date: '', location: '', bullets: [] as string[] };
        }
      } else if (current) {
        current.bullets.push(l.replace(bulletPattern, '').trim());
      }
    }
    if (current) items.push(current);
    return items.slice(0, 6);
  }

  function parseEducation(blocks: string[]) {
    const edu: any[] = [];
    const degreePattern = /(bachelor|master|mba|phd|b\.sc|m\.sc|bachelor’s|master’s)/i;
    for (const l of blocks) {
      if (!l) continue;
      const degree = (l.match(degreePattern) || [])[0] ?? '';
      edu.push({
        degree: degree || '',
        field: '',
        start_date: '',
        end_date: '',
        details: [l],
      });
      if (edu.length >= 4) break;
    }
    return edu;
  }

  const experience = parseWork(workLines.length ? workLines : lines).map((e) => ({
    company: e.company || null,
    title: e.title || null,
    start_date: e.start_date || null,
    end_date: e.end_date || null,
    location: e.location || null,
    bullets: (e.bullets || []).filter((b: string) => b),
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

async function collectPageFieldsFromFrame(frame: Frame, meta: { frameUrl: string; frameName: string }) {
  return frame.evaluate(
    (frameInfo) => {
    const norm = (s?: string | null) => (s || '').replace(/\s+/g, ' ').trim();
    const textOf = (el?: Element | null) => norm(el?.textContent || (el as HTMLElement | null)?.innerText || '');
    const isVisible = (el: Element) => {
      const cs = window.getComputedStyle(el);
      if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const esc = (v: string) =>
      (window.CSS && CSS.escape ? CSS.escape(v) : v.replace(/[^a-zA-Z0-9_-]/g, '\\$&'));

    const getLabelText = (el: Element) => {
      try {
        const labels = (el as HTMLInputElement).labels;
        if (labels && labels.length) {
          const t = Array.from(labels)
            .map((n) => textOf(n))
            .filter(Boolean);
          if (t.length) return t.join(' ');
        }
      } catch {
        /* ignore */
      }
      const id = el.getAttribute('id');
      if (id) {
        const lab = document.querySelector(`label[for="${esc(id)}"]`);
        const t = textOf(lab);
        if (t) return t;
      }
      const wrap = el.closest('label');
      const t2 = textOf(wrap);
      return t2 || '';
    };

    const getAriaName = (el: Element) => {
      const direct = norm(el.getAttribute('aria-label'));
      if (direct) return direct;
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

    const getDescribedBy = (el: Element) => {
      const ids = norm(el.getAttribute('aria-describedby'));
      if (!ids) return '';
      const parts = ids
        .split(/\s+/)
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean);
      return norm(parts.join(' '));
    };

    const findFieldContainer = (el: Element) =>
      el.closest(
        "fieldset, [role='group'], .form-group, .field, .input-group, .question, .formField, section, article, li, div"
      ) || el.parentElement;

    const collectNearbyPrompts = (el: Element) => {
      const container = findFieldContainer(el);
      if (!container) return [];

      const prompts: { source: string; text: string }[] = [];

      const fieldset = el.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        const t = textOf(legend);
        if (t) prompts.push({ source: 'legend', text: t });
      }

      const candidates = container.querySelectorAll(
        "h1,h2,h3,h4,h5,h6,p,.help,.hint,.description,[data-help],[data-testid*='help']"
      );
      candidates.forEach((n) => {
        const t = textOf(n);
        if (t && t.length <= 350) prompts.push({ source: 'container_text', text: t });
      });

      let sib: Element | null = el.previousElementSibling;
      let steps = 0;
      while (sib && steps < 4) {
        const tag = sib.tagName.toLowerCase();
        if (['div', 'p', 'span', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'label'].includes(tag)) {
          const t = textOf(sib);
          if (t && t.length <= 350) prompts.push({ source: 'prev_sibling', text: t });
        }
        sib = sib.previousElementSibling;
        steps += 1;
      }

      return prompts;
    };

    const looksBoilerplate = (t: string) => {
      const s = t.toLowerCase();
      return (
        s.includes('privacy') ||
        s.includes('terms') ||
        s.includes('cookies') ||
        s.includes('equal opportunity') ||
        s.includes('eeo') ||
        s.includes('gdpr')
      );
    };

    const scorePrompt = (text: string, source: string) => {
      const s = text.toLowerCase();
      let score = 0;
      if (text.includes('?')) score += 6;
      if (/^(why|how|what|describe|explain|tell us|please describe|please explain)\b/i.test(text)) score += 4;
      if (/(position|role|motivation|interested|interest|experience|background|cover letter)/i.test(text)) score += 2;
      if (text.length >= 20 && text.length <= 220) score += 3;
      if (source === 'label' || source === 'aria') score += 5;
      if (source === 'describedby') score += 3;
      if (text.length > 350) score -= 4;
      if (looksBoilerplate(text)) score -= 6;
      if (/^(optional|required)\b/i.test(text)) score -= 5;
      if (s === 'optional' || s === 'required') score -= 5;
      return score;
    };

    const parseTextConstraints = (text: string) => {
      const t = text.toLowerCase();
      const out: Record<string, number> = {};
      const words = t.match(/max(?:imum)?\s*(\d+)\s*words?/);
      if (words) out.max_words = parseInt(words[1], 10);
      const chars = t.match(/max(?:imum)?\s*(\d+)\s*(characters|chars)/);
      if (chars) out.max_chars = parseInt(chars[1], 10);
      const minChars = t.match(/min(?:imum)?\s*(\d+)\s*(characters|chars)/);
      if (minChars) out.min_chars = parseInt(minChars[1], 10);
      return out;
    };

    const recommendedLocators = (el: Element, bestLabel?: string | null) => {
      const tag = el.tagName.toLowerCase();
      const id = el.getAttribute('id');
      const name = el.getAttribute('name');
      const placeholder = el.getAttribute('placeholder');
      const locators: Record<string, string> = {};
      if (id) locators.css = `#${esc(id)}`;
      else if (name) locators.css = `${tag}[name="${esc(name)}"]`;
      else locators.css = tag;

      if (bestLabel) locators.playwright = `getByLabel(${JSON.stringify(bestLabel)})`;
      else if (placeholder) locators.playwright = `getByPlaceholder(${JSON.stringify(placeholder)})`;
      else locators.playwright = `locator(${JSON.stringify(locators.css)})`;
      return locators;
    };

    const slug = (v: string) => norm(v).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

    const controls = Array.from(
      document.querySelectorAll('input, textarea, select, [contenteditable="true"], [role="textbox"]')
    ).slice(0, 80);

    const fields: any[] = [];
    controls.forEach((el, idx) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'input') {
        const t = ((el as HTMLInputElement).type || el.getAttribute('type') || 'text').toLowerCase();
        if (['hidden', 'submit', 'button', 'image', 'reset'].includes(t)) return;
      }
      if (!isVisible(el)) return;

      const label = norm(getLabelText(el));
      const ariaName = norm(getAriaName(el));
      const describedBy = norm(getDescribedBy(el));
      const placeholder = norm(el.getAttribute('placeholder'));
      const autocomplete = norm(el.getAttribute('autocomplete'));
      const name = norm(el.getAttribute('name'));
      const id = norm(el.getAttribute('id'));
      const required = Boolean((el as HTMLInputElement).required);

      const type =
        tag === 'input'
          ? (norm((el as HTMLInputElement).type || el.getAttribute('type')) || 'text').toLowerCase()
          : tag === 'textarea'
            ? 'textarea'
            : tag === 'select'
              ? 'select'
              : (el.getAttribute('role') === 'textbox' || el.getAttribute('contenteditable') === 'true')
                ? 'richtext'
                : tag;

      const promptCandidates: { source: string; text: string; score: number }[] = [];
      if (label) promptCandidates.push({ source: 'label', text: label, score: scorePrompt(label, 'label') + 8 });
      if (ariaName) promptCandidates.push({ source: 'aria', text: ariaName, score: scorePrompt(ariaName, 'aria') });
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

      const best =
        label && promptCandidates.find((p) => p.source === 'label')
          ? promptCandidates.find((p) => p.source === 'label')
          : promptCandidates.filter((p) => p.text).sort((a, b) => b.score - a.score)[0];
      const questionText = best?.text || '';
      const locators = recommendedLocators(el, label || ariaName || questionText || placeholder);

      const constraints: Record<string, number> = {};
      const maxlen = el.getAttribute('maxlength');
      const minlen = el.getAttribute('minlength');
      if (maxlen) constraints.maxlength = parseInt(maxlen, 10);
      if (minlen) constraints.minlength = parseInt(minlen, 10);
      Object.assign(constraints, parseTextConstraints(`${questionText} ${describedBy}`));

      const textForEssay = `${questionText} ${label} ${describedBy}`.toLowerCase();
      const likelyEssay =
        type === 'textarea' ||
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
        frameUrl: frameInfo.frameUrl,
        frameName: frameInfo.frameName,
      });
    });

    return fields;
  },
    { frameUrl: meta.frameUrl, frameName: meta.frameName },
  );
}

async function collectPageFields(page: Page) {
  const frames = page.frames();
  const results = await Promise.all(
    frames.map(async (frame, idx) => {
      try {
        return await collectPageFieldsFromFrame(frame, {
          frameUrl: frame.url(),
          frameName: frame.name() || `frame-${idx}`,
        });
      } catch (err) {
        console.error('collectPageFields frame failed', err);
        return [];
      }
    }),
  );
  const merged = results.flat();
  if (merged.length) return merged.slice(0, 300);

  // fallback to main frame attempt
  try {
    return await collectPageFieldsFromFrame(page.mainFrame(), {
      frameUrl: page.mainFrame().url(),
      frameName: page.mainFrame().name() || 'main',
    });
  } catch {
    return [];
  }
}

async function applyFillPlan(page: Page, plan: any[]): Promise<FillPlanResult> {
  const filled: { field: string; value: string; confidence?: number }[] = [];
  const suggestions: { field: string; suggestion: string }[] = [];
  const blocked: string[] = [];

  for (const f of plan) {
    const action = f.action;
    const value = f.value;
    const selector =
      f.selector ||
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
      } else if (action === 'select') {
        await page.selectOption(selector, { label: String(value ?? '') });
        filled.push({
          field: f.field_id ?? selector,
          value: String(value ?? ''),
          confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
        });
      } else if (action === 'check' || action === 'uncheck') {
        if (action === 'check') await page.check(selector);
        else await page.uncheck(selector);
        filled.push({ field: f.field_id ?? selector, value: action });
      } else if (f.requires_user_review) {
        blocked.push(f.field_id ?? selector);
      }
    } catch {
      blocked.push(f.field_id ?? selector);
    }
  }
  return { filled, suggestions, blocked };
}

function collectLabelCandidates(field: any): string[] {
  const candidates: string[] = [];
  const primaryPrompt = Array.isArray(field?.questionCandidates) && field.questionCandidates.length > 0
    ? field.questionCandidates[0].text
    : undefined;
  [primaryPrompt, field?.questionText, field?.label, field?.ariaName, field?.placeholder, field?.describedBy, field?.field_id, field?.name, field?.id]
    .forEach((t) => {
      if (typeof t === 'string' && t.trim()) candidates.push(t);
    });
  if (Array.isArray(field?.containerPrompts)) {
    field.containerPrompts.forEach((p: any) => {
      if (p?.text && typeof p.text === 'string' && p.text.trim()) candidates.push(p.text);
    });
  }
  return candidates;
}

function escapeCssValue(value: string) {
  return value.replace(/["\\]/g, '\\$&');
}

function escapeCssIdent(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}

function buildFieldSelector(field: any): string | undefined {
  if (field?.selector && typeof field.selector === 'string') return field.selector;
  if (field?.locators?.css && typeof field.locators.css === 'string') return field.locators.css;
  if (field?.id) return `#${escapeCssIdent(String(field.id))}`;
  if (field?.field_id) return `[name="${escapeCssValue(String(field.field_id))}"]`;
  if (field?.name) return `[name="${escapeCssValue(String(field.name))}"]`;
  return undefined;
}

function inferFieldAction(field: any): FillPlanAction['action'] {
  const rawType = String(field?.type ?? '').toLowerCase();
  if (rawType === 'select') return 'select';
  return 'fill';
}

const SKIP_KEYS = new Set(['cover_letter']);

function buildAliasFillPlan(
  fields: any[],
  aliasIndex: Map<string, string>,
  valueMap: Record<string, string>,
): FillPlanResult {
  const filled: { field: string; value: string; confidence?: number }[] = [];
  const suggestions: { field: string; suggestion: string }[] = [];
  const blocked: string[] = [];
  const actions: FillPlanAction[] = [];
  const seen = new Set<string>();

  for (const field of fields ?? []) {
    const candidates = collectLabelCandidates(field);
    let matchedKey: string | undefined;
    let matchedLabel = '';
    for (const c of candidates) {
      const match = matchLabelToCanonical(c, aliasIndex);
      if (match) {
        matchedKey = match;
        matchedLabel = c;
        break;
      }
    }
    if (!matchedKey) continue;
    if (SKIP_KEYS.has(matchedKey)) continue;

    const value = trimString(valueMap[matchedKey]);
    const fieldName = trimString(field?.field_id || field?.name || field?.id || matchedLabel || matchedKey) || matchedKey;
    if (seen.has(fieldName)) continue;
    seen.add(fieldName);

    if (!value) {
      suggestions.push({ field: fieldName, suggestion: `No data available for ${matchedKey}` });
      continue;
    }

    const selector = buildFieldSelector(field);
    const fieldId = trimString(field?.field_id || field?.name || field?.id);
    const fieldLabel = trimString(
      matchedLabel || field?.label || field?.questionText || field?.ariaName || fieldName,
    );
    if (!selector) {
      blocked.push(fieldName);
      continue;
    }
    const action = inferFieldAction(field);
    actions.push({
      field: fieldName,
      field_id: fieldId || undefined,
      label: fieldLabel || undefined,
      selector,
      action,
      value,
      confidence: 0.75,
    });
    filled.push({ field: fieldName, value, confidence: 0.75 });
  }

  return { filled, suggestions, blocked, actions };
}

function shouldSkipPlanField(field: any, aliasIndex: Map<string, string>) {
  const candidates = [field?.field_id, field?.label, field?.selector].filter((c) => typeof c === 'string' && c.trim());
  for (const c of candidates) {
    const match = matchLabelToCanonical(String(c), aliasIndex);
    if (match && SKIP_KEYS.has(match)) return true;
  }
  return false;
}

async function simplePageFill(page: Page, baseInfo: BaseInfo): Promise<FillPlanResult> {
  const fullName = [baseInfo?.name?.first, baseInfo?.name?.last].filter(Boolean).join(' ').trim();
  const email = trimString(baseInfo?.contact?.email);
  const phoneCode = trimString(baseInfo?.contact?.phoneCode);
  const phoneNumber = trimString(baseInfo?.contact?.phoneNumber);
  const phone = formatPhone(baseInfo?.contact);
  const address = trimString(baseInfo?.location?.address);
  const city = trimString(baseInfo?.location?.city);
  const state = trimString(baseInfo?.location?.state);
  const country = trimString(baseInfo?.location?.country);
  const postalCode = trimString(baseInfo?.location?.postalCode);
  const linkedin = trimString(baseInfo?.links?.linkedin);
  const company = trimString(baseInfo?.career?.currentCompany);
  const title = trimString(baseInfo?.career?.jobTitle);
  const yearsExp = trimString(baseInfo?.career?.yearsExp);
  const desiredSalary = trimString(baseInfo?.career?.desiredSalary);
  const school = trimString(baseInfo?.education?.school);
  const degree = trimString(baseInfo?.education?.degree);
  const majorField = trimString(baseInfo?.education?.majorField);
  const graduationAt = trimString(baseInfo?.education?.graduationAt);

  const filled: { field: string; value: string; confidence?: number }[] = [];
  const targets = [
    { key: 'full_name', match: /full\s*name/i, value: fullName },
    { key: 'first', match: /first/i, value: baseInfo?.name?.first },
    { key: 'last', match: /last/i, value: baseInfo?.name?.last },
    { key: 'email', match: /email/i, value: email },
    { key: 'phone_code', match: /(phone|mobile).*(code)|country\s*code|dial\s*code/i, value: phoneCode },
    { key: 'phone_number', match: /(phone|mobile).*(number|no\.)/i, value: phoneNumber },
    { key: 'phone', match: /phone|tel/i, value: phone },
    { key: 'address', match: /address/i, value: address },
    { key: 'city', match: /city/i, value: city },
    { key: 'state', match: /state|province|region/i, value: state },
    { key: 'country', match: /country|nation/i, value: country },
    { key: 'postal_code', match: /postal|zip/i, value: postalCode },
    { key: 'company', match: /company|employer/i, value: company },
    { key: 'title', match: /title|position|role/i, value: title },
    { key: 'years_experience', match: /years?.*experience|experience.*years|yrs/i, value: yearsExp },
    { key: 'desired_salary', match: /salary|compensation|pay|rate/i, value: desiredSalary },
    { key: 'linkedin', match: /linkedin|linked\s*in/i, value: linkedin },
    { key: 'school', match: /school|university|college/i, value: school },
    { key: 'degree', match: /degree|diploma/i, value: degree },
    { key: 'major_field', match: /major|field\s*of\s*study/i, value: majorField },
    { key: 'graduation_at', match: /grad/i, value: graduationAt },
  ].filter((t) => t.value);

  const inputs = await page.$$('input, textarea, select');
  for (const el of inputs) {
    const props = await el.evaluate((node) => {
      const lbl = (node as HTMLInputElement).labels?.[0]?.innerText || '';
      return {
        tag: node.tagName.toLowerCase(),
        type: (node as HTMLInputElement).type || node.getAttribute('type') || 'text',
        name: node.getAttribute('name') || '',
        id: node.id || '',
        placeholder: node.getAttribute('placeholder') || '',
        label: lbl,
      };
    });
    if (props.type === 'checkbox' || props.type === 'radio' || props.type === 'file') continue;
    const haystack = `${props.label} ${props.name} ${props.id} ${props.placeholder}`.toLowerCase();
    const match = targets.find((t) => t.match.test(haystack));
    if (match) {
      const val = String(match.value ?? '');
      try {
        if (props.tag === 'select') {
          await el.selectOption({ label: val });
        } else {
          await el.fill(val);
        }
        filled.push({ field: props.name || props.id || match.key, value: val });
      } catch {
        // ignore failed fills
      }
    }
  }
  return { filled, suggestions: [], blocked: [] };
}

async function hydrateResume(resume: Resume, baseProfile?: BaseInfo) {
  let resumeText = resume.resumeText ?? '';
  if (!resumeText && resume.filePath) {
    const resolved = resolveResumePath(resume.filePath);
    resumeText = await extractResumeTextFromFile(resolved, path.basename(resume.filePath));
  }
  resumeText = sanitizeText(resumeText);
  const parsedResume = await tryParseResumeText(resume.id, resumeText, baseProfile);
  return { ...resume, resumeText, parsedResume };
}

const DEFAULT_AUTOFILL_FIELDS = [
  { field_id: 'first_name', label: 'First name', type: 'text', required: true },
  { field_id: 'last_name', label: 'Last name', type: 'text', required: true },
  { field_id: 'email', label: 'Email', type: 'text', required: true },
  { field_id: 'phone_code', label: 'Phone code', type: 'text', required: false },
  { field_id: 'phone_number', label: 'Phone number', type: 'text', required: false },
  { field_id: 'phone', label: 'Phone', type: 'text', required: false },
  { field_id: 'address', label: 'Address', type: 'text', required: false },
  { field_id: 'city', label: 'City', type: 'text', required: false },
  { field_id: 'state', label: 'State/Province', type: 'text', required: false },
  { field_id: 'country', label: 'Country', type: 'text', required: false },
  { field_id: 'postal_code', label: 'Postal code', type: 'text', required: false },
  { field_id: 'linkedin', label: 'LinkedIn', type: 'text', required: false },
  { field_id: 'job_title', label: 'Job title', type: 'text', required: false },
  { field_id: 'current_company', label: 'Current company', type: 'text', required: false },
  { field_id: 'years_exp', label: 'Years of experience', type: 'number', required: false },
  { field_id: 'desired_salary', label: 'Desired salary', type: 'text', required: false },
  { field_id: 'school', label: 'School', type: 'text', required: false },
  { field_id: 'degree', label: 'Degree', type: 'text', required: false },
  { field_id: 'major_field', label: 'Major/Field', type: 'text', required: false },
  { field_id: 'graduation_at', label: 'Graduation date', type: 'text', required: false },
  { field_id: 'work_auth', label: 'Authorized to work?', type: 'checkbox', required: false },
];

// initDb, auth guard, signToken live in dedicated modules

async function bootstrap() {
  await app.register(authGuard);
  await app.register(cors, { origin: true });
  await app.register(websocket);
  await initDb();
  await fs.mkdir(RESUME_DIR, { recursive: true });

  app.get('/health', async () => ({ status: 'ok' }));

  app.get('/sessions/:id/top-resumes', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });

    const jdText = String((session.jobContext as any)?.job_description_text ?? '').trim();
    if (!jdText) {
      return reply.status(400).send({ message: 'Job description missing for this session' });
    }

    try {
      const top = await getTopMatchedResumesFromSession(session, jdText, request.log);
      return top;
    } catch (err) {
      request.log.error({ err }, 'failed to score resumes');
      return reply.status(500).send({ message: 'Failed to score resumes' });
    }
  });

  app.post('/auth/login', async (request, reply) => {
    const schema = z.object({ email: z.string().email(), password: z.string().optional() });
    const body = schema.parse(request.body);
    const user = await findUserByEmail(body.email);
    if (!user) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }
    if (user.password && body.password && !(await bcrypt.compare(body.password, user.password))) {
      return reply.status(401).send({ message: 'Invalid credentials' });
    }
    const token = signToken(user);
    return { token, user };
  });

  app.post('/auth/signup', async (request, reply) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(3),
      name: z.string().min(2),
    });
    const body = schema.parse(request.body);
    const exists = await findUserByEmail(body.email);
    if (exists) {
      return reply.status(409).send({ message: 'Email already registered' });
    }
    const hashed = await bcrypt.hash(body.password, 8);
    const user: User = {
      id: randomUUID(),
      email: body.email,
      role: 'OBSERVER',
      name: body.name,
      isActive: true,
      password: hashed,
    };
    await insertUser(user);
    const token = signToken(user);
    return { token, user };
  });

  app.get('/profiles', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.isActive === false) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }

    const { userId } = request.query as { userId?: string };

    if (actor.role === 'ADMIN' || actor.role === 'MANAGER') {
      if (userId) {
        const target = await findUserById(userId);
        if (target?.role === 'BIDDER' && target.isActive !== false) {
          return listProfilesForBidder(target.id);
        }
      }
      return listProfiles();
    }

    if (actor.role === 'BIDDER') {
      return listProfilesForBidder(actor.id);
    }

    return reply.status(403).send({ message: 'Forbidden' });
  });

  app.post('/profiles', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can create profiles' });
    }
    const schema = z.object({
      displayName: z.string().min(2),
      baseInfo: z.record(z.any()).optional(),
      firstName: z.string().optional(),
      lastName: z.string().optional(),
      email: z.string().email().optional(),
      phoneCode: z.string().optional(),
      phoneNumber: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      postalCode: z.string().optional(),
      linkedin: z.string().optional(),
      jobTitle: z.string().optional(),
      currentCompany: z.string().optional(),
      yearsExp: z.union([z.string(), z.number()]).optional(),
      desiredSalary: z.string().optional(),
      school: z.string().optional(),
      degree: z.string().optional(),
      majorField: z.string().optional(),
      graduationAt: z.string().optional(),
    });
    const body = schema.parse(request.body);
    const profileId = randomUUID();
    const now = new Date().toISOString();
    const incomingBase = (body.baseInfo ?? {}) as BaseInfo;
    const baseInfo = mergeBaseInfo({}, {
      ...incomingBase,
      name: {
        ...(incomingBase.name ?? {}),
        first: trimString(body.firstName ?? incomingBase.name?.first),
        last: trimString(body.lastName ?? incomingBase.name?.last),
      },
      contact: {
        ...(incomingBase.contact ?? {}),
        email: trimString(body.email ?? incomingBase.contact?.email),
        phoneCode: trimString(body.phoneCode ?? incomingBase.contact?.phoneCode),
        phoneNumber: trimString(body.phoneNumber ?? incomingBase.contact?.phoneNumber),
      },
      location: {
        ...(incomingBase.location ?? {}),
        address: trimString(body.address ?? incomingBase.location?.address),
        city: trimString(body.city ?? incomingBase.location?.city),
        state: trimString(body.state ?? incomingBase.location?.state),
        country: trimString(body.country ?? incomingBase.location?.country),
        postalCode: trimString(body.postalCode ?? incomingBase.location?.postalCode),
      },
      links: { ...(incomingBase.links ?? {}), linkedin: trimString(body.linkedin ?? (incomingBase.links as any)?.linkedin) },
      career: {
        ...(incomingBase.career ?? {}),
        jobTitle: trimString(body.jobTitle ?? incomingBase.career?.jobTitle),
        currentCompany: trimString(body.currentCompany ?? incomingBase.career?.currentCompany),
        yearsExp: body.yearsExp ?? incomingBase.career?.yearsExp,
        desiredSalary: trimString(body.desiredSalary ?? incomingBase.career?.desiredSalary),
      },
      education: {
        ...(incomingBase.education ?? {}),
        school: trimString(body.school ?? incomingBase.education?.school),
        degree: trimString(body.degree ?? incomingBase.education?.degree),
        majorField: trimString(body.majorField ?? incomingBase.education?.majorField),
        graduationAt: trimString(body.graduationAt ?? incomingBase.education?.graduationAt),
      },
    });
    const profile = {
      id: profileId,
      displayName: body.displayName,
      baseInfo,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
    };
    await insertProfile(profile);
    return profile;
  });

  app.patch('/profiles/:id', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can update profiles' });
    }
    const { id } = request.params as { id: string };
    const existing = await findProfileById(id);
    if (!existing) return reply.status(404).send({ message: 'Profile not found' });

    const schema = z.object({
      displayName: z.string().min(2).optional(),
      baseInfo: z.record(z.any()).optional(),
    });
    const body = schema.parse(request.body ?? {});

    const incomingBase = (body.baseInfo ?? {}) as BaseInfo;
    const mergedBase = mergeBaseInfo(existing.baseInfo, incomingBase);

    const updatedProfile = {
      ...existing,
      displayName: body.displayName ?? existing.displayName,
      baseInfo: mergedBase,
      updatedAt: new Date().toISOString(),
    };

    await updateProfileRecord({
      id: updatedProfile.id,
      displayName: updatedProfile.displayName,
      baseInfo: updatedProfile.baseInfo,
    });
    return updatedProfile;
  });

  app.get('/profiles/:id/resumes', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const profile = await findProfileById(id);
    if (!profile) return reply.status(404).send({ message: 'Profile not found' });
    return listResumesByProfile(id);
  });

  app.post('/profiles/:id/resumes', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can add resumes' });
    }
    const { id } = request.params as { id: string };
    const profile = await findProfileById(id);
    if (!profile) return reply.status(404).send({ message: 'Profile not found' });

    const schema = z.object({
      label: z.string().optional(),
      filePath: z.string().optional(),
      fileData: z.string().optional(),
      fileName: z.string().optional(),
      description: z.string().optional(),
    });
    const body = schema.parse(request.body ?? {});
    const baseLabel =
      body.label?.trim() ||
      (body.fileName ? body.fileName.replace(/\.[^/.]+$/, '').trim() : '') ||
      '';
    if (baseLabel.length < 2) {
      return reply.status(400).send({ message: 'Label is required (min 2 chars)' });
    }
    if (!body.fileData && !body.filePath) {
      return reply.status(400).send({ message: 'Resume file is required' });
    }
    const resumeId = randomUUID();
    let filePath = body.filePath ?? '';
    let resumeText = '';
    let resumeJson: Record<string, unknown> | undefined;
    let resolvedPath = '';
    if (body.fileData) {
      const buffer = Buffer.from(body.fileData, 'base64');
      const ext =
        body.fileName && path.extname(body.fileName) ? path.extname(body.fileName) : '.pdf';
      const fileName = `${resumeId}${ext}`;
      const targetPath = path.join(RESUME_DIR, fileName);
      await fs.writeFile(targetPath, buffer);
      filePath = `/data/resumes/${fileName}`;
      resolvedPath = targetPath;
    } else if (filePath) {
      resolvedPath = resolveResumePath(filePath);
    }

    if (resolvedPath) {
      resumeText = await extractResumeTextFromFile(resolvedPath, body.fileName ?? path.basename(resolvedPath));
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
    await insertResumeRecord(resume);
    return { ...resume, resumeJson };
  });

  app.delete('/profiles/:profileId/resumes/:resumeId', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can remove resumes' });
    }
    const { profileId, resumeId } = request.params as { profileId: string; resumeId: string };
    const profile = await findProfileById(profileId);
    if (!profile) return reply.status(404).send({ message: 'Profile not found' });
    const resume = await findResumeById(resumeId);
    if (!resume || resume.profileId !== profileId) {
      return reply.status(404).send({ message: 'Resume not found' });
    }
    if (resume.filePath) {
      try {
        const resolved = resolveResumePath(resume.filePath);
        if (resolved) await fs.unlink(resolved);
      } catch {
        // ignore missing files
      }
    }
    await deleteResumeById(resumeId);
    return { ok: true };
  });

  app.get('/calendar/accounts', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }
    const parsed = z
      .object({
        profileId: z.string().uuid().optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }
    return listProfileAccountsForUser(actor, parsed.data.profileId);
  });

  app.post('/calendar/accounts', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }
    const schema = z.object({
      profileId: z.string().uuid(),
      email: z.string().email(),
      provider: z.enum(['MICROSOFT', 'GOOGLE']).default('MICROSOFT').optional(),
      displayName: z.string().min(1).optional(),
      timezone: z.string().min(2).optional(),
    });
    const body = schema.parse(request.body ?? {});
    const profile = await findProfileById(body.profileId);
    if (!profile) {
      return reply.status(404).send({ message: 'Profile not found' });
    }
    const isManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
    const isAssignedBidder = profile.assignedBidderId === actor.id;
    if (!isManager && !isAssignedBidder) {
      return reply.status(403).send({ message: 'Not allowed to manage accounts for this profile' });
    }
    const account = await upsertProfileAccount({
      id: randomUUID(),
      profileId: body.profileId,
      provider: body.provider ?? 'MICROSOFT',
      email: body.email.toLowerCase(),
      displayName: body.displayName ?? body.email,
      timezone: body.timezone ?? 'UTC',
      status: 'ACTIVE',
    });
    return account;
  });

  app.get('/calendar/events', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }
    const parsed = z
      .object({
        accountId: z.string().uuid(),
        start: z.string(),
        end: z.string(),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ message: 'Invalid query' });
    }
    const { accountId, start, end } = parsed.data;
    const account = await findProfileAccountById(accountId);
    if (!account) {
      return reply.status(404).send({ message: 'Calendar account not found' });
    }
    const isManager = actor.role === 'ADMIN' || actor.role === 'MANAGER';
    const isAssignedBidder = account.profileAssignedBidderId === actor.id;
    if (!isManager && !isAssignedBidder) {
      return reply.status(403).send({ message: 'Not allowed to view this calendar' });
    }
    const startDate = new Date(start);
    const endDate = new Date(end);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return reply.status(400).send({ message: 'Invalid date range' });
    }
    if (endDate <= startDate) {
      return reply.status(400).send({ message: 'End must be after start' });
    }
    const { events: calendarEvents, source, warning } = await loadOutlookEvents({
      email: account.email,
      rangeStart: start,
      rangeEnd: end,
      timezone: account.timezone,
      logger: request.log,
    });
    await touchProfileAccount(account.id, new Date().toISOString());
    return {
      account: {
        id: account.id,
        email: account.email,
        profileId: account.profileId,
        profileDisplayName: account.profileDisplayName,
        timezone: account.timezone,
      },
      events: calendarEvents,
      source,
      warning,
    };
  });

  app.get('/resumes/:id/file', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can view resumes' });
    }
    const { id } = request.params as { id: string };
    const resume = await findResumeById(id);
    if (!resume || !resume.filePath) return reply.status(404).send({ message: 'Resume not found' });
    const resolvedPath = resolveResumePath(resume.filePath);
    if (!resolvedPath || !fsSync.existsSync(resolvedPath)) {
      return reply.status(404).send({ message: 'File missing' });
    }
    reply.header('Content-Type', 'application/pdf');
    const stream = fsSync.createReadStream(resolvedPath);
    return reply.send(stream);
  });

  app.get('/assignments', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    return listAssignments();
  });
  app.post('/assignments', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can assign profiles' });
    }
    const schema = z.object({
      profileId: z.string(),
      bidderUserId: z.string(),
      assignedBy: z.string().optional(),
    });
    const body = schema.parse(request.body);
    const profile = await findProfileById(body.profileId);
    const bidder = await findUserById(body.bidderUserId);
    if (!profile || !bidder || bidder.role !== 'BIDDER') {
      return reply.status(400).send({ message: 'Invalid profile or bidder' });
    }

    const existing = await findActiveAssignmentByProfile(body.profileId);
    if (existing) {
      return reply
        .status(409)
        .send({ message: 'Profile already assigned', assignmentId: existing.id });
    }

    const newAssignment: Assignment = {
      id: body.profileId,
      profileId: body.profileId,
      bidderUserId: body.bidderUserId,
      assignedBy: actor.id ?? body.assignedBy ?? body.bidderUserId,
      assignedAt: new Date().toISOString(),
      unassignedAt: null as string | null,
    };
    await insertAssignmentRecord(newAssignment);
    events.push({
      id: randomUUID(),
      sessionId: 'admin-event',
      eventType: 'ASSIGNED',
      payload: { profileId: body.profileId, bidderUserId: body.bidderUserId },
      createdAt: new Date().toISOString(),
    });
    return newAssignment;
  });

  app.post('/assignments/:id/unassign', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const assignment = await closeAssignmentById(id);
    if (!assignment) return reply.status(404).send({ message: 'Assignment not found' });
    events.push({
      id: randomUUID(),
      sessionId: 'admin-event',
      eventType: 'UNASSIGNED',
      payload: { profileId: assignment.profileId, bidderUserId: assignment.bidderUserId },
      createdAt: new Date().toISOString(),
    });
    return assignment;
  });

  app.get('/sessions/:id', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });
    return session;
  });

  app.post('/sessions', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.isActive === false) {
      return reply.status(401).send({ message: 'Unauthorized' });
    }
    const schema = z.object({
      bidderUserId: z.string(),
      profileId: z.string(),
      url: z.string(),
      selectedResumeId: z.string().optional(),
    });
    const body = schema.parse(request.body);
    const profileAssignment = await findActiveAssignmentByProfile(body.profileId);

    let bidderUserId = body.bidderUserId;
    if (actor.role === 'BIDDER') {
      bidderUserId = actor.id;
      if (profileAssignment && profileAssignment.bidderUserId !== actor.id) {
        return reply.status(403).send({ message: 'Profile not assigned to bidder' });
      }
    } else if (actor.role === 'MANAGER' || actor.role === 'ADMIN') {
      if (!bidderUserId && profileAssignment) bidderUserId = profileAssignment.bidderUserId;
      if (!bidderUserId) bidderUserId = actor.id;
    } else {
      return reply.status(403).send({ message: 'Forbidden' });
    }

    const session: ApplicationSession = {
      id: randomUUID(),
      bidderUserId,
      profileId: body.profileId,
      url: body.url,
      domain: tryExtractDomain(body.url),
      status: 'OPEN',
      selectedResumeId: body.selectedResumeId,
      startedAt: new Date().toISOString(),
    };
    sessions.unshift(session);
    events.push({
      id: randomUUID(),
      sessionId: session.id,
      eventType: 'SESSION_CREATED',
      payload: { url: session.url },
      createdAt: new Date().toISOString(),
    });
    return session;
  });

  app.post('/sessions/:id/go', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });
    session.status = 'OPEN';
    try {
      await startBrowserSession(session);
    } catch (err) {
      app.log.error({ err }, 'failed to start browser session');
    }
    events.push({
      id: randomUUID(),
      sessionId: id,
      eventType: 'GO_CLICKED',
      payload: { url: session.url },
      createdAt: new Date().toISOString(),
    });
    return { ok: true };
  });

  app.post('/sessions/:id/analyze', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });
    const body = (request.body as { useAi?: boolean } | undefined) ?? {};
    const useAi = Boolean(body.useAi);

    const live = livePages.get(id);
    const page = live?.page;
    if (!page) {
      return reply.status(400).send({ message: 'Live page not available. Click Go and load the page before Analyze.' });
    }

    let pageHtml = '';
    let pageTitle = '';
    try {
      pageTitle = await page.title();
      pageHtml = await page.content();
    } catch (err) {
      request.log.error({ err }, 'failed to read live page content');
    }
    if (!pageHtml) {
      return reply.status(400).send({ message: 'No page content captured. Load the page before Analyze.' });
    }

    const analysis = await analyzeJobFromHtml(pageHtml, pageTitle);

    session.status = 'ANALYZED';
    session.jobContext = {
      title: analysis.title || 'Job',
      company: 'N/A',
      summary: 'Analysis from job description',
      job_description_text: analysis.jobText ?? '',
    };

    if (!useAi) {
      const topTech = (analysis.ranked ?? []).slice(0, 4);
      events.push({
        id: randomUUID(),
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

    const jdText = String((session.jobContext as any)?.job_description_text ?? '');
    const topResumes = jdText ? await getTopMatchedResumesFromSession(session, jdText, request.log) : [];
    session.recommendedResumeId = topResumes[0]?.id ?? analysis.recommendedResumeId;
    events.push({
      id: randomUUID(),
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
    const { resumeText, resumeId, filename, baseProfile } = request.body as any;
    if (!resumeText || !resumeId) return reply.status(400).send({ message: 'resumeText and resumeId are required' });
    const prompt = promptBuilders.buildResumeParsePrompt({
      resumeId,
      filename,
      resumeText,
      baseProfile,
    });
    const parsed = await callPromptPack(prompt);
    if (!parsed) return reply.status(502).send({ message: 'LLM parse failed' });
    return parsed;
  });

  app.post('/llm/job-analyze', async (request, reply) => {
    const { job, baseProfile, prefs } = request.body as any;
    if (!job?.job_description_text) return reply.status(400).send({ message: 'job_description_text required' });
    const prompt = promptBuilders.buildJobAnalyzePrompt({
      job,
      baseProfile,
      prefs,
    });
    const parsed = await callPromptPack(prompt);
    if (!parsed) return reply.status(502).send({ message: 'LLM analyze failed' });
    return parsed;
  });

  app.post('/llm/rank-resumes', async (request, reply) => {
    const { job, resumes, baseProfile, prefs } = request.body as any;
    if (!job?.job_description_text || !Array.isArray(resumes)) {
      return reply.status(400).send({ message: 'job_description_text and resumes[] required' });
    }
    const prompt = promptBuilders.buildRankResumesPrompt({
      job,
      resumes,
      baseProfile,
      prefs,
    });
    const parsed = await callPromptPack(prompt);
    if (!parsed) return reply.status(502).send({ message: 'LLM rank failed' });
    return parsed;
  });

  app.post('/llm/autofill-plan', async (request, reply) => {
    const { pageFields, baseProfile, prefs, jobContext, selectedResume, pageContext } = request.body as any;
    if (!Array.isArray(pageFields)) return reply.status(400).send({ message: 'pageFields[] required' });
    const prompt = promptBuilders.buildAutofillPlanPrompt({
      pageFields,
      baseProfile,
      prefs,
      jobContext,
      selectedResume,
      pageContext,
    });
    const parsed = await callPromptPack(prompt);
    if (!parsed) return reply.status(502).send({ message: 'LLM autofill failed' });
    return parsed;
  });

  app.get('/label-aliases', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Only admins can manage label aliases' });
    }
    const custom = await listLabelAliases();
    return { defaults: DEFAULT_LABEL_ALIASES, custom };
  });

  app.get('/application-phrases', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const custom = await listLabelAliases();
    const phrases = buildApplicationSuccessPhrases(custom);
    return { phrases };
  });

  app.post('/label-aliases', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Only admins can manage label aliases' });
    }
    const schema = z.object({
      canonicalKey: z.string(),
      alias: z.string().min(2),
    });
    const body = schema.parse(request.body ?? {});
    const canonicalKey = body.canonicalKey.trim();
    if (!CANONICAL_LABEL_KEYS.has(canonicalKey)) {
      return reply.status(400).send({ message: 'Unknown canonical key' });
    }
    const normalizedAlias = normalizeLabelAlias(body.alias);
    if (!normalizedAlias) {
      return reply.status(400).send({ message: 'Alias cannot be empty' });
    }
    const existing = await findLabelAliasByNormalized(normalizedAlias);
    if (existing) {
      return reply.status(409).send({ message: 'Alias already exists' });
    }
    const aliasRecord: LabelAlias = {
      id: randomUUID(),
      canonicalKey,
      alias: body.alias.trim(),
      normalizedAlias,
    };
    await insertLabelAlias(aliasRecord);
    return aliasRecord;
  });

  app.patch('/label-aliases/:id', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Only admins can manage label aliases' });
    }
    const { id } = request.params as { id: string };
    const schema = z.object({
      canonicalKey: z.string().optional(),
      alias: z.string().optional(),
    });
    const body = schema.parse(request.body ?? {});
    const existing = await findLabelAliasById(id);
    if (!existing) return reply.status(404).send({ message: 'Alias not found' });

    const canonicalKey = body.canonicalKey?.trim() || existing.canonicalKey;
    if (!CANONICAL_LABEL_KEYS.has(canonicalKey)) {
      return reply.status(400).send({ message: 'Unknown canonical key' });
    }
    const aliasText = (body.alias ?? existing.alias).trim();
    const normalizedAlias = normalizeLabelAlias(aliasText);
    if (!normalizedAlias) {
      return reply.status(400).send({ message: 'Alias cannot be empty' });
    }
    const conflict = await findLabelAliasByNormalized(normalizedAlias);
    if (conflict && conflict.id !== id) {
      return reply.status(409).send({ message: 'Alias already exists' });
    }
    const updated: LabelAlias = {
      ...existing,
      canonicalKey,
      alias: aliasText,
      normalizedAlias,
      updatedAt: new Date().toISOString(),
    };
    await updateLabelAliasRecord(updated);
    return updated;
  });

  app.delete('/label-aliases/:id', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || actor.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Only admins can manage label aliases' });
    }
    const { id } = request.params as { id: string };
    const existing = await findLabelAliasById(id);
    if (!existing) return reply.status(404).send({ message: 'Alias not found' });
    await deleteLabelAlias(id);
    return { status: 'deleted', id };
  });

  app.post('/sessions/:id/autofill', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const body = (request.body as { selectedResumeId?: string; pageFields?: any[]; useLlm?: boolean }) ?? {};
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });
    const profile = await findProfileById(session.profileId);
    if (!profile) return reply.status(404).send({ message: 'Profile not found' });
    if (body.selectedResumeId) {
      session.selectedResumeId = body.selectedResumeId;
    }

    const live = livePages.get(id);
    const page = live?.page;
    const hasClientFields = Array.isArray(body.pageFields);
    let pageFields: any[] = hasClientFields ? body.pageFields : [];
    if (!hasClientFields && page) {
      try {
        pageFields = await collectPageFields(page);
      } catch (err) {
        request.log.error({ err }, 'collectPageFields failed');
      }
    }

    const candidateFields: any[] = pageFields.length ? pageFields : DEFAULT_AUTOFILL_FIELDS;

    const autofillValues = buildAutofillValueMap(profile.baseInfo ?? {}, session.jobContext ?? {});
    const aliasIndex = buildAliasIndex(await listLabelAliases());
    const useLlm = body.useLlm !== false;

    let fillPlan: FillPlanResult = { filled: [], suggestions: [], blocked: [], actions: [] };
    if (candidateFields.length > 0) {
      try {
        fillPlan = buildAliasFillPlan(candidateFields, aliasIndex, autofillValues);
      } catch (err) {
        request.log.error({ err }, 'label-db autofill failed');
        fillPlan = { filled: [], suggestions: [], blocked: [], actions: [] };
      }
    }

    try {
      if (useLlm && (!fillPlan.filled || fillPlan.filled.length === 0) && candidateFields.length > 0) {
        const prompt = promptBuilders.buildAutofillPlanPrompt({
          pageFields: candidateFields,
          baseProfile: profile.baseInfo ?? {},
          prefs: {},
          jobContext: session.jobContext ?? {},
          pageContext: { url: session.url },
        });
        const parsed = await callPromptPack(prompt);
        const llmPlan = parsed?.result?.fill_plan;
        if (Array.isArray(llmPlan)) {
          const filteredPlan = llmPlan.filter((f: any) => !shouldSkipPlanField(f, aliasIndex));
          const actions: FillPlanAction[] = filteredPlan
            .map((f: any) => ({
              field: String(f.field_id ?? f.selector ?? f.label ?? 'field'),
              field_id: typeof f.field_id === 'string' ? f.field_id : undefined,
              label: typeof f.label === 'string' ? f.label : undefined,
              selector: typeof f.selector === 'string' ? f.selector : undefined,
              action: (f.action as FillPlanAction['action']) ?? 'fill',
              value: typeof f.value === 'string' ? f.value : JSON.stringify(f.value ?? ''),
              confidence: typeof f.confidence === 'number' ? f.confidence : undefined,
            }))
            .filter((f) => f.action !== 'skip');
          const filledFromPlan = actions
            .filter((f) => ['fill', 'select', 'check', 'uncheck'].includes(f.action))
            .map((f) => ({
              field: f.field,
              value: f.value ?? '',
              confidence: f.confidence,
            }));
          const suggestions =
            (Array.isArray(parsed?.warnings) ? parsed?.warnings : []).map((w: any) => ({
              field: 'note',
              suggestion: String(w),
            })) ?? [];
          const blocked = llmPlan
            .filter((f: any) => f.requires_user_review)
            .map((f: any) => f.field_id ?? f.selector ?? 'field');
          fillPlan = {
            filled: filledFromPlan,
            suggestions,
            blocked,
            actions,
          };
        }
      }
    } catch (err) {
      request.log.error({ err }, 'LLM autofill failed, using demo plan');
    }

    if (!fillPlan.filled?.length && !fillPlan.suggestions?.length && !fillPlan.blocked?.length) {
      fillPlan = buildDemoFillPlan(profile.baseInfo);
    }

    session.status = 'FILLED';
    session.fillPlan = fillPlan;
    events.push({
      id: randomUUID(),
      sessionId: id,
      eventType: 'AUTOFILL_DONE',
      payload: session.fillPlan,
      createdAt: new Date().toISOString(),
    });
    return { fillPlan: session.fillPlan, pageFields, candidateFields };
  });

  app.post('/sessions/:id/mark-submitted', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { id } = request.params as { id: string };
    const session = sessions.find((s) => s.id === id);
    if (!session) return reply.status(404).send({ message: 'Session not found' });
    session.status = 'SUBMITTED';
    session.endedAt = new Date().toISOString();
    try {
      const record: ApplicationRecord = {
        id: randomUUID(),
        sessionId: id,
        bidderUserId: session.bidderUserId,
        profileId: session.profileId,
        resumeId: session.selectedResumeId ?? session.recommendedResumeId ?? null,
        url: session.url ?? '',
        domain: session.domain ?? tryExtractDomain(session.url ?? ''),
        createdAt: new Date().toISOString(),
      };
      await insertApplication(record);
    } catch (err) {
      request.log.error({ err }, 'failed to insert application record');
    }
    await stopBrowserSession(id);
    events.push({
      id: randomUUID(),
      sessionId: id,
      eventType: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    });
    return { status: session.status };
  });

  app.get('/sessions', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const bidderUserId = (request.query as { bidderUserId?: string }).bidderUserId;
    const filtered = bidderUserId
      ? sessions.filter((s) => s.bidderUserId === bidderUserId)
      : sessions;
    return filtered;
  });

  app.get('/users', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const { role } = request.query as { role?: string };
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
    const { rows } = await pool.query<User>(sql, params);
    return rows;
  });

  app.patch('/users/:id/role', async (request, reply) => {
    const actor = request.authUser;
    if (!actor || actor.role !== 'ADMIN') {
      return reply.status(403).send({ message: 'Only admins can update roles' });
    }
    const { id } = request.params as { id: string };
    const schema = z.object({ role: z.enum(['ADMIN', 'MANAGER', 'BIDDER', 'OBSERVER']) });
    const body = schema.parse(request.body);
    await pool.query('UPDATE users SET role = $1 WHERE id = $2', [body.role, id]);
    const updated = await findUserById(id);
    return updated;
  });

  app.get('/metrics/my', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const bidderUserId = (request.query as { bidderUserId?: string }).bidderUserId;
    const userSessions = bidderUserId
      ? sessions.filter((s) => s.bidderUserId === bidderUserId)
      : sessions;
    const tried = userSessions.length;
    const submitted = userSessions.filter((s) => s.status === 'SUBMITTED').length;
    const percentage = tried === 0 ? 0 : Math.round((submitted / tried) * 100);
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthlyApplied = userSessions.filter(
      (s) =>
        s.status === 'SUBMITTED' &&
        s.startedAt &&
        new Date(s.startedAt).getTime() >= monthStart.getTime(),
    ).length;
    return {
      tried,
      submitted,
      appliedPercentage: percentage,
      monthlyApplied,
      recent: userSessions.slice(0, 5),
    };
  });

  app.get('/settings/llm', async () => llmSettings[0]);
  app.post('/settings/llm', async (request) => {
    const schema = z.object({
      provider: z.enum(['OPENAI', 'HUGGINGFACE']),
      chatModel: z.string(),
      embedModel: z.string(),
      encryptedApiKey: z.string(),
    });
    const body = schema.parse(request.body);
    const current = llmSettings[0];
    llmSettings[0] = {
      ...current,
      ...body,
      updatedAt: new Date().toISOString(),
    };
    return llmSettings[0];
  });

  app.get('/manager/bidders/summary', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can view bidders' });
    }
    const rows = await listBidderSummaries();
    return rows;
  });

  app.get('/manager/applications', async (request, reply) => {
    if (forbidObserver(reply, request.authUser)) return;
    const actor = request.authUser;
    if (!actor || (actor.role !== 'MANAGER' && actor.role !== 'ADMIN')) {
      return reply.status(403).send({ message: 'Only managers or admins can view applications' });
    }
    const rows = await listApplications();
    return rows;
  });

  app.ready((err) => {
    if (err) app.log.error(err);
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
    if (!connection || !connection.socket) {
      return;
    }
    const { sessionId } = req.params as { sessionId: string };
    const live = livePages.get(sessionId);
    if (!live) {
      connection.socket?.send(JSON.stringify({ type: 'error', message: 'No live browser' }));
      connection.socket?.close();
      return;
    }

    const { page } = live;
    const sendFrame = async () => {
      try {
        const buf = await page.screenshot({ fullPage: true });
        connection.socket?.send(JSON.stringify({ type: 'frame', data: buf.toString('base64') }));
      } catch (err) {
        connection.socket?.send(JSON.stringify({ type: 'error', message: 'Could not capture frame' }));
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

function tryExtractDomain(url: string) {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    return undefined;
  }
}

function buildDemoFillPlan(baseInfo: BaseInfo): FillPlanResult {
  const phone = formatPhone(baseInfo?.contact);
  const safeFields = [
    { field: 'first_name', value: baseInfo?.name?.first, confidence: 0.98 },
    { field: 'last_name', value: baseInfo?.name?.last, confidence: 0.98 },
    { field: 'email', value: baseInfo?.contact?.email, confidence: 0.97 },
    { field: 'phone_code', value: baseInfo?.contact?.phoneCode, confidence: 0.75 },
    { field: 'phone_number', value: baseInfo?.contact?.phoneNumber, confidence: 0.78 },
    { field: 'phone', value: phone, confidence: 0.8 },
    { field: 'address', value: baseInfo?.location?.address, confidence: 0.75 },
    { field: 'city', value: baseInfo?.location?.city, confidence: 0.75 },
    { field: 'state', value: baseInfo?.location?.state, confidence: 0.72 },
    { field: 'country', value: baseInfo?.location?.country, confidence: 0.72 },
    { field: 'postal_code', value: baseInfo?.location?.postalCode, confidence: 0.72 },
    { field: 'linkedin', value: baseInfo?.links?.linkedin, confidence: 0.78 },
    { field: 'job_title', value: baseInfo?.career?.jobTitle, confidence: 0.7 },
    { field: 'current_company', value: baseInfo?.career?.currentCompany, confidence: 0.68 },
    { field: 'years_exp', value: baseInfo?.career?.yearsExp, confidence: 0.6 },
    { field: 'desired_salary', value: baseInfo?.career?.desiredSalary, confidence: 0.62 },
    { field: 'school', value: baseInfo?.education?.school, confidence: 0.66 },
    { field: 'degree', value: baseInfo?.education?.degree, confidence: 0.65 },
    { field: 'major_field', value: baseInfo?.education?.majorField, confidence: 0.64 },
    { field: 'graduation_at', value: baseInfo?.education?.graduationAt, confidence: 0.6 },
  ];
  const filled = safeFields
    .filter((f) => Boolean(f.value))
    .map((f) => ({ field: f.field, value: String(f.value ?? ''), confidence: f.confidence }));
  return {
    filled,
    suggestions: [],
    blocked: ['EEO', 'veteran_status', 'disability'],
    actions: [],
  };
}

function resolveResumePath(p: string) {
  if (!p) return '';
  if (path.isAbsolute(p)) {
    // If an absolute path was previously stored, fall back to the shared resumes directory using the filename.
    const fileName = path.basename(p);
    return path.join(RESUME_DIR, fileName);
  }
  const normalized = p.replace(/\\/g, '/');
  if (normalized.startsWith('/data/resumes/')) {
    const fileName = normalized.split('/').pop() ?? '';
    return path.join(RESUME_DIR, fileName);
  }
  if (normalized.startsWith('/resumes/')) {
    const fileName = normalized.split('/').pop() ?? '';
    return path.join(RESUME_DIR, fileName);
  }
  const trimmed = normalized.replace(/^\.?\\?\//, '');
  return path.join(PROJECT_ROOT, trimmed);
}

bootstrap();

function normalizeScore(parsed: any): number | undefined {
  const val =
    typeof parsed === 'number'
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

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+\.#]+/g)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function topKeywordsFromJd(jdText: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  for (const token of tokenize(jdText)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

function overlapCount(tokens: Set<string>, keywords: Set<string>): number {
  let count = 0;
  for (const k of keywords) {
    if (tokens.has(k)) count += 1;
  }
  return count;
}

async function callHfScore(prompt: string, logger?: any, resumeId?: string): Promise<any | undefined> {
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
    const data = (await res.json()) as any;
    const choiceContent =
      data?.choices?.[0]?.message?.content ||
      (Array.isArray(data) && data[0]?.generated_text) ||
      data?.generated_text ||
      data?.text;
    const text = typeof choiceContent === 'string' ? choiceContent.trim() : undefined;
    if (text) {
      try {
        return JSON.parse(text);
      } catch {
        logger?.warn({ resumeId }, 'hf-score-parse-text-failed');
      }
    }
    if (data && typeof data === 'object' && !data.error) return data;
    logger?.warn({ resumeId, data }, 'hf-score-unexpected-response');
  } catch (err) {
    logger?.error({ resumeId }, 'hf-score-call-failed');
  }
  return undefined;
}

async function scoreResumeWithHf(
  jdText: string,
  resumeText: string,
  logger?: any,
  resumeId?: string,
  opts?: { title?: string; keywords?: string[] },
): Promise<number | undefined> {
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
    const parsed = (await callHfScore(prompt, logger, resumeId)) ?? (await callPromptPack(prompt));
    const scoreVal = normalizeScore(parsed);
    if (typeof scoreVal === 'number') return Math.round(scoreVal);
    logger?.warn({ resumeId, parsed }, 'hf-score-parse-failed');
  } catch {
    logger?.error({ resumeId }, 'hf-score-exception');
  }
}

async function getTopMatchedResumesFromSession(session: ApplicationSession, jdText: string, logger: any) {
  const profile = await findProfileById(session.profileId);
  const resumesForProfile = await listResumesByProfile(session.profileId);
  const limited = resumesForProfile.slice(0, 200);
  const keywords = topKeywordsFromJd(jdText);
  const keywordSet = new Set(keywords);
  const title = (session.jobContext as any)?.title as string | undefined;

  const scored: { id: string; title: string; score: number; tie: number }[] = [];
  for (const r of limited) {
    let hydrated = r;
    try {
      hydrated = await hydrateResume(r, profile?.baseInfo);
    } catch {
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

async function startBrowserSession(session: ApplicationSession) {
  const existing = livePages.get(session.id);
  if (existing) {
    await existing.page.goto(session.url, { waitUntil: 'domcontentloaded' });
    await focusFirstField(existing.page);
    return;
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
  await page.goto(session.url, { waitUntil: 'domcontentloaded' });
  await focusFirstField(page);
  livePages.set(session.id, { browser, page });
}

async function stopBrowserSession(sessionId: string) {
  const live = livePages.get(sessionId);
  if (!live) return;
  if (live.interval) clearInterval(live.interval);
  await live.page.close().catch(() => undefined);
  await live.browser.close().catch(() => undefined);
  livePages.delete(sessionId);
}

async function focusFirstField(page: Page) {
  try {
    const locator = page.locator('input, textarea, select').first();
    await locator.scrollIntoViewIfNeeded({ timeout: 4000 });
  } catch {
    // ignore
  }
}
