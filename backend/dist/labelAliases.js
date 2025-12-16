"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CANONICAL_LABEL_KEYS = exports.DEFAULT_LABEL_ALIASES = void 0;
exports.normalizeLabelAlias = normalizeLabelAlias;
exports.buildAliasIndex = buildAliasIndex;
exports.matchLabelToCanonical = matchLabelToCanonical;
exports.DEFAULT_LABEL_ALIASES = {
    // ===== Personal identity =====
    full_name: [
        'full name',
        'legal name',
        'name in full',
        'complete name',
        'first and last name',
        'name (as on id)',
        'name as on id',
        'name (as on passport)',
        'name as on passport',
        'candidate name',
        'applicant name',
        'your name',
    ],
    first_name: ['first name', 'given name', 'forename', 'given names', 'name (first)', 'first'],
    last_name: ['last name', 'family name', 'surname', 'name (last)', 'last'],
    preferred_name: ['preferred name', 'chosen name', 'display name', 'nickname', 'known as', 'goes by'],
    pronouns: ['pronouns', 'preferred pronouns', 'personal pronouns'],
    // ===== Contact =====
    email: ['email', 'e mail', 'e-mail', 'email address', 'primary email', 'contact email', 'personal email', 'work email'],
    phone: [
        'phone',
        'phone number',
        'telephone',
        'tel',
        'contact number',
        'mobile',
        'mobile phone',
        'cell',
        'cell phone',
        'primary phone',
        'work phone',
        'home phone',
    ],
    phone_country_code: ['country code', 'dial code', 'calling code', 'phone country code'],
    // ===== Address / location =====
    address_line1: ['address', 'street address', 'address line 1', 'address 1', 'street', 'street and number', 'house and street', 'street name and number'],
    city: ['city', 'town', 'locality', 'municipality'],
    state_province_region: ['state', 'province', 'region', 'state/region', 'province/state', 'county', 'territory', 'prefecture'],
    postal_code: ['zip', 'zip code', 'postal', 'postal code', 'postcode', 'postal/zip', 'pincode', 'pin code'],
    country: ['country', 'country/region', 'nation'],
    current_location: [
        'current location',
        'location',
        'based in',
        'where are you located',
        'city of residence',
        'current city',
        'place of residence',
    ],
    // ===== Online profiles / links =====
    linkedin_url: ['linkedin', 'linked in', 'linkedin profile', 'linkedin url', 'linked in profile', 'linked in url'],
    // ===== Documents =====
    cover_letter: ['cover letter', 'motivation letter', 'letter of interest', 'application letter', 'upload cover letter', 'attach cover letter'],
    // ===== Work / role =====
    job_title: ['job title', 'position', 'role', 'desired role', 'desired position', 'title', 'designation'],
    current_company: ['current company', 'current employer', 'present employer', 'employer', 'company', 'company name', 'organization', 'organisation'],
    years_experience: ['years of experience', 'experience (years)', 'years experience', 'yrs experience', 'total experience', 'overall experience'],
    // ===== Compensation / availability =====
    desired_salary: [
        'desired salary',
        'expected salary',
        'salary expectation',
        'salary expectations',
        'salary requirement',
        'salary requirements',
        'salary range',
        'compensation expectation',
        'expected compensation',
        'desired compensation',
        'target compensation',
        'pay expectation',
        'desired pay',
        'base salary expectation',
    ],
    hourly_rate: ['hourly rate', 'hourly pay', 'desired hourly rate', 'rate per hour'],
    start_date: ['start date', 'available to start', 'earliest start date', 'date available', 'availability date', 'when can you start', 'available from'],
    notice_period: ['notice period', 'weeks notice', 'notice', 'availability after notice'],
    // ===== Education =====
    school: ['school', 'university', 'college', 'institution', 'school name', 'university name', 'college name'],
    degree: ['degree', 'degree type', 'qualification', 'education level', 'highest degree', 'diploma', 'certificate'],
    major_field: ['major', 'field of study', 'concentration', 'specialization', 'specialisation', 'discipline'],
    graduation_date: ['graduation date', 'graduation year', 'graduated', 'completion date', 'degree completion date', 'completion year'],
    // ===== EEO (explicitly filled when requested) =====
    eeo_gender: ['gender', 'sex'],
    eeo_race_ethnicity: ['race', 'ethnicity', 'race/ethnicity'],
    eeo_veteran: ['veteran', 'protected veteran'],
    eeo_disability: ['disability', 'disability status'],
};
exports.CANONICAL_LABEL_KEYS = new Set(Object.keys(exports.DEFAULT_LABEL_ALIASES));
function normalizeLabelAlias(label) {
    return label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildAliasIndex(customAliases = []) {
    const index = new Map();
    const add = (canonical, alias) => {
        const normalized = normalizeLabelAlias(alias);
        if (!normalized)
            return;
        const squished = normalized.replace(/\s+/g, '');
        index.set(normalized, canonical);
        if (squished)
            index.set(squished, canonical);
    };
    for (const [canonical, aliases] of Object.entries(exports.DEFAULT_LABEL_ALIASES)) {
        add(canonical, canonical);
        aliases.forEach((alias) => add(canonical, alias));
    }
    customAliases.forEach((alias) => add(alias.canonicalKey, alias.alias));
    return index;
}
function matchLabelToCanonical(label, aliasIndex) {
    if (!label)
        return undefined;
    const normalized = normalizeLabelAlias(label);
    if (!normalized)
        return undefined;
    const squished = normalized.replace(/\s+/g, '');
    return aliasIndex.get(normalized) ?? aliasIndex.get(squished);
}
