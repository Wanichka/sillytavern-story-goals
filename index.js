// Story Goals v0.1.0
// A hand-written list of where this story is going, for one chat.
//
// WHAT IT IS: goals you set by hand ("get into the restricted section", "make
// peace with Daphne"), each with optional steps. Unfinished goals are injected
// into every request so the model knows the direction of the story. You tick a
// goal off when the story reaches it, and it leaves the prompt at once while
// staying in the panel, struck through.
//
// WHAT IT IS NOT: a task manager. There is no auto-generation, no auto-check,
// no "current task", no progress bar and above all NO SEPARATE API REQUEST.
// The Objective/SuperObjective family sends your chat to the model a second
// time under a service prompt to ask "is this task done yet?" — without your
// preset, without your jailbreak — which is exactly what trips content filters
// on an NSFW roleplay. Everything here is local; the only thing that ever
// reaches the model is the block of text below.
//
// STORAGE: chat metadata is the source of truth (it lives in the chat file on
// the server, travels with backups and chat branches), localStorage is a warm
// local mirror and the fallback when metadata is unreachable. Keyed per chat —
// a new chat starts with an empty list, because goals are set for a run, not
// for a character. Same scheme as Story Notes and Relationship Memory Tracker.
//
// INJECTION DEPTH: default is IN_PROMPT (before the chat history, next to the
// summary and the lorebooks), NOT depth 0. Goals are direction, not an order
// for the current message. At depth 0 the list becomes the last thing the model
// reads before answering and it starts executing it: the character marches to
// the library in the very next post regardless of what the scene was doing.
// That is the failure this extension exists to avoid, so depth 0 is kept only
// as an escape hatch for a model that ignores the block entirely.
//
// PROMPT ORDER: SillyTavern concatenates same-position injections in
// alphabetical order of their key. Summarize uses "1_memory", so
// "story_goals_injection" lands after the summary — where the active-quests
// tail of a summary naturally continues. If your setup needs the block
// somewhere else entirely, set the position to "macro only" and drop
// {{story_goals}} into the preset by hand.

import {
    eventSource,
    event_types,
    setExtensionPrompt,
    extension_prompt_types,
    extension_prompt_roles,
} from '../../../../script.js';

const LS_GOALS_KEY = 'story_goals_v1';
const LS_SETTINGS_KEY = 'story_goals_settings_v1';
const LS_PANEL_POS_KEY = 'story_goals_panel_pos';
const LS_PANEL_SIZE_KEY = 'story_goals_panel_size';
const LS_BUTTON_POS_KEY = 'story_goals_button_pos';

const METADATA_KEY = 'story_goals';
const INJECTION_KEY = 'story_goals_injection';
const MACRO_NAME = 'story_goals';

const DEBUG = false;

function log(...args) {
    if (!DEBUG) return;
    console.log('[Story Goals]', ...args);
}

/* ----------------------------- localization ----------------------------- */

const STRINGS = {
    ru: {
        panelTitle: 'Story Goals',
        buttonTitle: 'Story Goals',

        addGoal: 'Новая цель',
        settings: 'Настройки',
        close: 'Закрыть',
        searchPlaceholder: 'Поиск по целям',

        markDone: 'Отметить выполненной',
        markActive: 'Вернуть в активные',
        markStepDone: 'Отметить шаг выполненным',
        markStepActive: 'Вернуть шаг в активные',
        addStep: 'Добавить шаг',
        edit: 'Изменить',
        delete: 'Удалить',

        goalPlaceholder: 'Куда сюжет должен прийти со временем',
        stepPlaceholder: 'Шаг к этой цели',
        add: 'Добавить',
        save: 'Сохранить',
        cancel: 'Отмена',

        emptyList: 'Целей пока нет. Нажми «+» и впиши, куда должна идти история.',
        emptySearch: 'По запросу ничего не найдено.',

        language: 'Язык интерфейса',
        position: 'Место в промпте',
        positionHint: 'Глубина 0 ставит цели последними перед ответом — модель начинает выполнять их сразу, ломая темп. Держи этот вариант на случай, когда блок игнорируется целиком. «Только макрос» отключает инжект: блок попадёт в промпт лишь там, где ты вручную впишешь {{story_goals}}.',
        positionInPrompt: 'Перед историей чата (рекомендуется)',
        positionDepth4: 'В истории, глубина 4',
        positionDepth0: 'В истории, глубина 0 (макс. приоритет)',
        positionMacro: 'Только макрос {{story_goals}}',
        preamble: 'Преамбула блока',
        preambleHint: 'Инструкция перед списком: запрещает бросать сцену ради цели и разрешает не трогать цель много сообщений подряд. Уходит в промпт, поэтому написана для модели, а не для чтения.',
        resetPreamble: 'Сбросить преамбулу',

        export: 'Экспорт',
        import: 'Импорт',
        clearAll: 'Удалить все цели этого чата',
        resizeHint: 'Потяни, чтобы изменить высоту; двойной клик — сброс',

        confirmDelete: (preview, steps) => steps
            ? `Удалить цель вместе с шагами (${steps})?\n\n${preview}`
            : `Удалить цель?\n\n${preview}`,
        confirmClear: 'Удалить все цели этого чата?',
        exportEmpty: 'Нечего экспортировать: целей нет.',
        importUnreadable: 'Не удалось прочитать файл: это не похоже на экспорт Story Goals.',
        importEmpty: 'В файле нет целей.',
        importReplace: (incoming, existing) => `В файле ${incoming} целей, в этом чате уже ${existing}.\n\nOK — заменить всё, Отмена — добавить к существующим.`,
    },
    en: {
        panelTitle: 'Story Goals',
        buttonTitle: 'Story Goals',

        addGoal: 'New goal',
        settings: 'Settings',
        close: 'Close',
        searchPlaceholder: 'Search goals',

        markDone: 'Mark as reached',
        markActive: 'Move back to active',
        markStepDone: 'Mark step as done',
        markStepActive: 'Move step back to active',
        addStep: 'Add a step',
        edit: 'Edit',
        delete: 'Delete',

        goalPlaceholder: 'Where the story should eventually arrive',
        stepPlaceholder: 'A step toward this goal',
        add: 'Add',
        save: 'Save',
        cancel: 'Cancel',

        emptyList: 'No goals yet. Press "+" and write down where the story should go.',
        emptySearch: 'Nothing matches that search.',

        language: 'Interface language',
        position: 'Position in the prompt',
        positionHint: 'Depth 0 puts the goals last, right before the reply — the model starts executing them immediately and the pacing breaks. Keep it for the case where the block is ignored entirely. "Macro only" disables the injection: the block reaches the prompt solely where you write {{story_goals}} yourself.',
        positionInPrompt: 'Before the chat history (recommended)',
        positionDepth4: 'In the history, depth 4',
        positionDepth0: 'In the history, depth 0 (highest priority)',
        positionMacro: 'Macro only — {{story_goals}}',
        preamble: 'Block preamble',
        preambleHint: 'The instruction above the list: it forbids abandoning the scene for a goal and allows a goal to sit untouched for many messages. This goes into the prompt, so it is written for the model rather than for reading.',
        resetPreamble: 'Reset preamble',

        export: 'Export',
        import: 'Import',
        clearAll: 'Delete every goal in this chat',
        resizeHint: 'Drag to change the height, double-click to reset',

        confirmDelete: (preview, steps) => steps
            ? `Delete this goal and its ${steps} step(s)?\n\n${preview}`
            : `Delete this goal?\n\n${preview}`,
        confirmClear: 'Delete every goal in this chat?',
        exportEmpty: 'Nothing to export: there are no goals.',
        importUnreadable: 'Could not read the file: it does not look like a Story Goals export.',
        importEmpty: 'The file contains no goals.',
        importReplace: (incoming, existing) => `The file has ${incoming} goals, this chat already has ${existing}.\n\nOK — replace everything, Cancel — add to the existing ones.`,
    },
};

function t(key, ...args) {
    const lang = getSettings().lang;
    const value = STRINGS[lang]?.[key] ?? STRINGS.en[key] ?? key;
    return typeof value === 'function' ? value(...args) : value;
}

/* ------------------------------- settings ------------------------------- */

// This preamble is the entire point of the extension. A bare list of goals
// reads as a to-do list handed to the model for this turn, and it will empty
// the list as fast as it can: the character drops the conversation and walks
// to the library because the library is item one. So three things have to be
// said out loud — this is direction rather than instruction, the scene comes
// first, and leaving a goal untouched is the correct behaviour, not a failure.
const DEFAULT_PREAMBLE = [
    'Long-term narrative goals for this story, set by the user. They describe where the story is eventually going, not what has to happen now.',
    'Reference material only. Never quote, list or restate this block in your reply, and never render it as an info block, a quest log or a status screen.',
    'Do not redirect the current scene toward a goal and do not make characters suddenly act on one. Progress happens only when the scene reaches it on its own terms.',
    'A goal may stay untouched for many messages, and that is correct. When the story does move toward one, move in small plausible steps that fit what is already happening.',
].join('\n');

const DEFAULT_SETTINGS = {
    lang: 'ru',
    position: 'in_prompt',
    preamble: DEFAULT_PREAMBLE,
};

// Settings are global (not per chat): they describe how the block is delivered
// and how the panel is labelled, not what is in the list.
function getSettings() {
    try {
        const raw = localStorage.getItem(LS_SETTINGS_KEY);
        if (!raw) return { ...DEFAULT_SETTINGS };

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS };

        return {
            lang: STRINGS[parsed.lang] ? parsed.lang : DEFAULT_SETTINGS.lang,
            position: typeof parsed.position === 'string' ? parsed.position : DEFAULT_SETTINGS.position,
            preamble: typeof parsed.preamble === 'string' ? parsed.preamble : DEFAULT_SETTINGS.preamble,
        };
    } catch (error) {
        console.error('[Story Goals] Failed to read settings:', error);
        return { ...DEFAULT_SETTINGS };
    }
}

function saveSettings(settings) {
    try {
        localStorage.setItem(LS_SETTINGS_KEY, JSON.stringify(settings));
    } catch (error) {
        console.error('[Story Goals] Failed to save settings:', error);
    }
}

/* ------------------------------ storage layer ------------------------------ */

function getContextSafe() {
    return window.SillyTavern?.getContext?.() || null;
}

function getCurrentChatId() {
    try {
        const context = getContextSafe();
        return context?.getCurrentChatId?.() ?? context?.chatId ?? null;
    } catch (error) {
        console.error('[Story Goals] Failed to read chat id:', error);
        return null;
    }
}

function getStorageKey() {
    const chatId = getCurrentChatId();
    return chatId ? `${LS_GOALS_KEY}::${chatId}` : LS_GOALS_KEY;
}

let warnedMetadataUnavailable = false;

function getChatMetadataSafe() {
    try {
        const context = getContextSafe();
        const meta = context?.chatMetadata;
        return meta && typeof meta === 'object' ? meta : null;
    } catch (error) {
        console.error('[Story Goals] Failed to read chat metadata:', error);
        return null;
    }
}

function persistChatMetadata() {
    const context = getContextSafe();

    try {
        if (typeof context?.saveMetadata === 'function') {
            context.saveMetadata();
            return true;
        }

        if (typeof context?.saveMetadataDebounced === 'function') {
            context.saveMetadataDebounced();
            return true;
        }
    } catch (error) {
        console.error('[Story Goals] Failed to persist chat metadata:', error);
    }

    return false;
}

function makeId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// A goal is one line: it is a heading in a list, not a note. Multi-line paste
// is collapsed rather than rejected, because pasting from a summary is the
// most likely way a goal gets in here.
function collapse(text) {
    return String(text ?? '').replace(/\s*\n+\s*/g, ' ').trim();
}

// Tolerant of hand-edited or older files: anything unusable is dropped rather
// than allowed to break rendering or injection.
function normalizeSteps(value) {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            id: typeof item.id === 'string' && item.id ? item.id : makeId('s'),
            text: collapse(item.text),
            done: item.done === true,
        }))
        .filter((item) => item.text.length > 0);
}

function normalizeGoals(value) {
    if (!Array.isArray(value)) return [];

    return value
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            id: typeof item.id === 'string' && item.id ? item.id : makeId('g'),
            text: collapse(item.text),
            done: item.done === true,
            steps: normalizeSteps(item.steps),
        }))
        .filter((item) => item.text.length > 0);
}

function readLocalStorageGoals() {
    try {
        const raw = localStorage.getItem(getStorageKey());
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        const goals = normalizeGoals(parsed);
        return goals.length ? goals : null;
    } catch (error) {
        console.error('[Story Goals] Failed to read goals from localStorage:', error);
        return null;
    }
}

function getGoals() {
    const meta = getChatMetadataSafe();

    if (meta) {
        const stored = meta[METADATA_KEY];

        if (Array.isArray(stored) && stored.length > 0) {
            return normalizeGoals(stored);
        }

        // Empty metadata slot: seed it ONCE from the local mirror. Only ever
        // writes into an empty slot, so a stale local copy cannot roll back
        // real goals.
        const local = readLocalStorageGoals();

        if (local) {
            meta[METADATA_KEY] = local;
            persistChatMetadata();
            log('Seeded chat metadata from localStorage mirror.');
            return local;
        }

        return [];
    }

    // Metadata unavailable: normal during boot and chat switching, suspicious
    // when a chat is actually open — warn once so it is visible.
    if (getCurrentChatId() && !warnedMetadataUnavailable) {
        console.warn('[Story Goals] Chat metadata unavailable; running on localStorage fallback.');
        warnedMetadataUnavailable = true;
    }

    return readLocalStorageGoals() || [];
}

function saveGoals(goals) {
    const clean = normalizeGoals(goals);
    const meta = getChatMetadataSafe();

    if (meta) {
        meta[METADATA_KEY] = clean;
        persistChatMetadata();
    }

    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(clean, null, 2));
    } catch (error) {
        console.error('[Story Goals] Failed to save goals to localStorage:', error);
    }
}

// Both stores at once, so a cleared list cannot resurrect from the mirror.
function clearGoals() {
    const meta = getChatMetadataSafe();

    if (meta && METADATA_KEY in meta) {
        delete meta[METADATA_KEY];
        persistChatMetadata();
    }

    try {
        localStorage.removeItem(getStorageKey());
    } catch (error) {
        console.error('[Story Goals] Failed to clear localStorage goals:', error);
    }
}

/* --------------------------------- helpers --------------------------------- */

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

// Rough fallback only. Cyrillic costs roughly 2-3 characters per token on the
// tokenizers in play here; the real count replaces this as soon as
// SillyTavern's tokenizer answers.
function estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 2.8);
}

async function countTokens(text) {
    if (!text) return 0;

    const context = getContextSafe();

    try {
        if (typeof context?.getTokenCountAsync === 'function') {
            const value = await context.getTokenCountAsync(text);
            if (Number.isFinite(value)) return value;
        }

        if (typeof context?.getTokenCount === 'function') {
            const value = context.getTokenCount(text);
            if (Number.isFinite(value)) return value;
        }
    } catch (error) {
        log('Tokenizer unavailable, falling back to estimate:', error);
    }

    return estimateTokens(text);
}

/* ------------------------------- injection ------------------------------- */

// Only what is still ahead. A ticked goal and a ticked step leave the block
// entirely — the chat history already records that they happened, and keeping
// a "recently completed" section only teaches the model to narrate the list.
function buildGoalsText() {
    const goals = getGoals().filter((goal) => !goal.done);

    if (goals.length === 0) {
        return '';
    }

    const settings = getSettings();
    const parts = ['<story_goals>'];

    if (settings.preamble.trim()) {
        parts.push(settings.preamble.trim());
        parts.push('');
    }

    for (const goal of goals) {
        parts.push(`- ${goal.text}`);

        for (const step of goal.steps.filter((step) => !step.done)) {
            parts.push(`  · ${step.text}`);
        }
    }

    parts.push('</story_goals>');

    return parts.join('\n');
}

function resolveInjectionTarget(position) {
    switch (position) {
        case 'depth_0':
            return { type: extension_prompt_types.IN_CHAT, depth: 0 };
        case 'depth_4':
            return { type: extension_prompt_types.IN_CHAT, depth: 4 };
        case 'in_prompt':
        default:
            return { type: extension_prompt_types.IN_PROMPT, depth: 0 };
    }
}

function updatePromptInjection() {
    const settings = getSettings();

    // "Macro only" still writes an empty injection rather than skipping the
    // call, so switching to it clears whatever the previous position left in
    // the prompt.
    const text = settings.position === 'macro' ? '' : buildGoalsText();
    const { type, depth } = resolveInjectionTarget(settings.position);

    setExtensionPrompt(
        INJECTION_KEY,
        text,
        type,
        depth,
        false,
        extension_prompt_roles.SYSTEM
    );

    log(text ? 'Injection updated.' : 'Injection cleared.');
}

// The macro is registered regardless of the position setting, so {{story_goals}}
// can be dropped into a preset for a quick look. Using it while the injection
// is also on sends the block twice — that is what the "macro only" position is
// for.
function registerMacroSafe() {
    const context = getContextSafe();

    try {
        if (typeof context?.registerMacro === 'function') {
            context.registerMacro(MACRO_NAME, () => buildGoalsText());
            log('Macro registered.');
            return;
        }
    } catch (error) {
        console.error('[Story Goals] Failed to register the macro:', error);
    }

    console.warn(`[Story Goals] This SillyTavern version does not expose registerMacro; {{${MACRO_NAME}}} will not work. Use a prompt position instead.`);
}

/* --------------------------------- state --------------------------------- */

let searchQuery = '';
let showSettings = false;

// One editor at a time, wherever it sits:
//   { mode: 'newGoal' }
//   { mode: 'goal', goalId }
//   { mode: 'newStep', goalId }
//   { mode: 'step', goalId, stepId }
let editor = null;

function findGoal(goals, goalId) {
    return goals.find((goal) => goal.id === goalId) || null;
}

/* ------------------------------- rendering ------------------------------- */

function editorHtml(value, saveLabel, { step = false } = {}) {
    const placeholder = step ? t('stepPlaceholder') : t('goalPlaceholder');
    const extra = step ? ' sg-editor-step' : '';

    return `
        <div class="sg-editor${extra}">
            <textarea class="sg-editor-input" rows="2" placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>
            <div class="sg-editor-actions">
                <button type="button" class="sg-primary" data-sg-save><i class="fa-solid fa-check"></i> ${escapeHtml(saveLabel)}</button>
                <button type="button" class="sg-secondary" data-sg-cancel>${escapeHtml(t('cancel'))}</button>
            </div>
        </div>
    `;
}

function stepRowHtml(step) {
    const done = step.done ? ' sg-done' : '';
    const checkOn = step.done ? ' sg-on' : '';
    const checkTitle = escapeHtml(step.done ? t('markStepActive') : t('markStepDone'));

    return `
        <div class="sg-step${done}" data-sg-step-id="${escapeHtml(step.id)}">
            <button type="button" class="sg-check${checkOn}" data-sg-step-check title="${checkTitle}"><i class="fa-solid fa-check"></i></button>
            <div class="sg-step-text">${escapeHtml(step.text)}</div>
            <div class="sg-step-actions">
                <button type="button" class="sg-icon sg-icon-sm" data-sg-step-edit title="${escapeHtml(t('edit'))}"><i class="fa-solid fa-pen"></i></button>
                <button type="button" class="sg-icon sg-icon-sm sg-icon-danger" data-sg-step-delete title="${escapeHtml(t('delete'))}"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
    `;
}

function goalCardHtml(goal) {
    const done = goal.done ? ' sg-done' : '';
    const checkOn = goal.done ? ' sg-on' : '';
    const checkTitle = escapeHtml(goal.done ? t('markActive') : t('markDone'));

    // The step being edited is hidden: its editor is rendered under the card,
    // so showing the old text at the same time would just be a duplicate.
    const hiddenStepId = editor?.mode === 'step' && editor.goalId === goal.id ? editor.stepId : null;
    const steps = goal.steps.filter((step) => step.id !== hiddenStepId);

    const stepsHtml = steps.length
        ? `<div class="sg-steps">${steps.map(stepRowHtml).join('')}</div>`
        : '';

    return `
        <div class="sg-card${done}" data-sg-id="${escapeHtml(goal.id)}">
            <div class="sg-card-head">
                <button type="button" class="sg-check${checkOn}" data-sg-check title="${checkTitle}"><i class="fa-solid fa-check"></i></button>
                <div class="sg-card-text">${escapeHtml(goal.text)}</div>
                <div class="sg-card-actions">
                    <button type="button" class="sg-icon" data-sg-add-step title="${escapeHtml(t('addStep'))}"><i class="fa-solid fa-plus"></i></button>
                    <button type="button" class="sg-icon" data-sg-edit title="${escapeHtml(t('edit'))}"><i class="fa-solid fa-pen"></i></button>
                    <button type="button" class="sg-icon sg-icon-danger" data-sg-delete title="${escapeHtml(t('delete'))}"><i class="fa-solid fa-xmark"></i></button>
                </div>
            </div>
            ${stepsHtml}
        </div>
    `;
}

function settingsHtml() {
    const settings = getSettings();

    const langOptions = [
        ['ru', 'Русский'],
        ['en', 'English'],
    ].map(([value, label]) => {
        const selected = settings.lang === value ? ' selected' : '';
        return `<option value="${value}"${selected}>${label}</option>`;
    }).join('');

    const positionOptions = [
        ['in_prompt', t('positionInPrompt')],
        ['depth_4', t('positionDepth4')],
        ['depth_0', t('positionDepth0')],
        ['macro', t('positionMacro')],
    ].map(([value, label]) => {
        const selected = settings.position === value ? ' selected' : '';
        return `<option value="${value}"${selected}>${escapeHtml(label)}</option>`;
    }).join('');

    return `
        <div class="sg-settings">
            <div class="sg-set-row">
                <label class="sg-set-label" for="sg-lang">${escapeHtml(t('language'))}</label>
                <select id="sg-lang">${langOptions}</select>
            </div>
            <div class="sg-set-row">
                <label class="sg-set-label" for="sg-position">${escapeHtml(t('position'))}</label>
                <select id="sg-position">${positionOptions}</select>
                <div class="sg-hint">${escapeHtml(t('positionHint'))}</div>
            </div>
            <div class="sg-set-row">
                <label class="sg-set-label" for="sg-preamble">${escapeHtml(t('preamble'))}</label>
                <textarea id="sg-preamble" rows="9">${escapeHtml(settings.preamble)}</textarea>
                <div class="sg-hint">${escapeHtml(t('preambleHint'))}</div>
            </div>
            <div class="sg-set-actions">
                <button type="button" class="sg-primary" id="sg-settings-save"><i class="fa-solid fa-check"></i> ${escapeHtml(t('save'))}</button>
                <button type="button" class="sg-secondary" id="sg-settings-reset">${escapeHtml(t('resetPreamble'))}</button>
            </div>
        </div>
    `;
}

// Labels built once in createUi() have to follow the language too.
function applyStaticLabels() {
    const panel = document.querySelector('#sg-panel');
    if (!panel) return;

    const setTitle = (selector, key) => {
        const el = panel.querySelector(selector);
        if (el) el.title = t(key);
    };

    const button = document.querySelector('#sg-button');
    if (button) button.title = t('buttonTitle');

    const title = panel.querySelector('#sg-title');
    if (title) title.textContent = t('panelTitle');

    setTitle('#sg-add', 'addGoal');
    setTitle('#sg-settings-toggle', 'settings');
    setTitle('#sg-close', 'close');
    setTitle('#sg-resize', 'resizeHint');
    setTitle('#sg-clear', 'clearAll');

    const search = panel.querySelector('#sg-search');
    if (search) search.placeholder = t('searchPlaceholder');

    const exportLabel = panel.querySelector('#sg-export .sg-label');
    if (exportLabel) exportLabel.textContent = t('export');

    const importLabel = panel.querySelector('#sg-import .sg-label');
    if (importLabel) importLabel.textContent = t('import');
}

async function updateHeader() {
    const titleEl = document.querySelector('#sg-title-count');
    if (!titleEl) return;

    const goals = getGoals();
    const active = goals.filter((goal) => !goal.done).length;
    const text = buildGoalsText();

    // Estimate first so the number never blinks empty, then correct it.
    titleEl.textContent = `${active}/${goals.length} · ~${estimateTokens(text)} tok`;

    const tokens = await countTokens(text);
    if (document.querySelector('#sg-title-count') === titleEl) {
        titleEl.textContent = `${active}/${goals.length} · ${tokens} tok`;
    }
}

function renderPanel() {
    const body = document.querySelector('#sg-body');
    if (!body) return;

    applyStaticLabels();

    const searchBar = document.querySelector('#sg-searchbar');

    if (showSettings) {
        if (searchBar) searchBar.style.display = 'none';
        body.innerHTML = settingsHtml();
        wireSettings(body);
        updateHeader();
        return;
    }

    if (searchBar) searchBar.style.display = '';

    const goals = getGoals();
    const query = searchQuery.trim().toLowerCase();

    // A goal matched through one of its steps is shown whole: hiding the
    // heading and keeping the step would lose the context of the match.
    const visible = query
        ? goals.filter((goal) => goal.text.toLowerCase().includes(query)
            || goal.steps.some((step) => step.text.toLowerCase().includes(query)))
        : goals;

    const chunks = [];
    const creatingGoal = editor?.mode === 'newGoal';

    if (creatingGoal) {
        chunks.push(editorHtml('', t('add')));
    }

    if (visible.length === 0 && !creatingGoal) {
        const icon = goals.length === 0 ? 'fa-compass' : 'fa-magnifying-glass';
        const message = goals.length === 0 ? t('emptyList') : t('emptySearch');
        chunks.push(`<div class="sg-empty"><i class="fa-solid ${icon}"></i><p>${escapeHtml(message)}</p></div>`);
    }

    for (const goal of visible) {
        if (editor?.mode === 'goal' && editor.goalId === goal.id) {
            chunks.push(editorHtml(goal.text, t('save')));
        } else {
            chunks.push(goalCardHtml(goal));
        }

        if (editor?.goalId === goal.id && (editor.mode === 'newStep' || editor.mode === 'step')) {
            const step = editor.mode === 'step'
                ? goal.steps.find((item) => item.id === editor.stepId)
                : null;

            chunks.push(editorHtml(step?.text ?? '', step ? t('save') : t('add'), { step: true }));
        }
    }

    body.innerHTML = chunks.join('');
    wireList(body);
    updateHeader();
}

/* ------------------------------ goal actions ------------------------------ */

function addGoal(text) {
    const clean = collapse(text);
    if (!clean) return;

    const goals = getGoals();
    goals.unshift({ id: makeId('g'), text: clean, done: false, steps: [] });
    saveGoals(goals);
    updatePromptInjection();
}

function updateGoal(goalId, text) {
    const clean = collapse(text);
    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    // An emptied goal is a deleted goal — normalizeGoals would drop it anyway.
    if (!clean) {
        deleteGoal(goalId, true);
        return;
    }

    goal.text = clean;
    saveGoals(goals);
    updatePromptInjection();
}

function toggleGoal(goalId) {
    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    // Ticking a goal does not tick its steps: reopening it later should bring
    // back exactly the steps that were still ahead.
    goal.done = !goal.done;
    saveGoals(goals);
    updatePromptInjection();
}

function deleteGoal(goalId, silent = false) {
    const goals = getGoals();
    const index = goals.findIndex((goal) => goal.id === goalId);
    if (index === -1) return;

    if (!silent) {
        const { text, steps } = goals[index];
        const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
        if (!confirm(t('confirmDelete', preview, steps.length))) return;
    }

    goals.splice(index, 1);
    saveGoals(goals);
    updatePromptInjection();
}

/* ------------------------------ step actions ------------------------------ */

function addStep(goalId, text) {
    const clean = collapse(text);
    if (!clean) return;

    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    // Steps append: they are a route, and a route is read top to bottom.
    goal.steps.push({ id: makeId('s'), text: clean, done: false });
    saveGoals(goals);
    updatePromptInjection();
}

function updateStep(goalId, stepId, text) {
    const clean = collapse(text);
    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    const index = goal.steps.findIndex((step) => step.id === stepId);
    if (index === -1) return;

    if (!clean) {
        goal.steps.splice(index, 1);
    } else {
        goal.steps[index].text = clean;
    }

    saveGoals(goals);
    updatePromptInjection();
}

function toggleStep(goalId, stepId) {
    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    const step = goal.steps.find((item) => item.id === stepId);
    if (!step) return;

    step.done = !step.done;
    saveGoals(goals);
    updatePromptInjection();
}

// No confirm here, unlike a goal: a step is one line and costs a retype, while
// a goal takes its whole route down with it.
function deleteStep(goalId, stepId) {
    const goals = getGoals();
    const goal = findGoal(goals, goalId);
    if (!goal) return;

    const index = goal.steps.findIndex((step) => step.id === stepId);
    if (index === -1) return;

    goal.steps.splice(index, 1);
    saveGoals(goals);
    updatePromptInjection();
}

/* -------------------------------- wiring -------------------------------- */

function commitEditor(value) {
    if (!editor) return;

    switch (editor.mode) {
        case 'newGoal':
            addGoal(value);
            break;
        case 'goal':
            updateGoal(editor.goalId, value);
            break;
        case 'newStep':
            addStep(editor.goalId, value);
            break;
        case 'step':
            updateStep(editor.goalId, editor.stepId, value);
            break;
        default:
            break;
    }

    editor = null;
}

function wireList(body) {
    const editorEl = body.querySelector('.sg-editor');

    if (editorEl) {
        const input = editorEl.querySelector('.sg-editor-input');

        editorEl.querySelector('[data-sg-save]').addEventListener('click', () => {
            commitEditor(input.value);
            renderPanel();
        });

        editorEl.querySelector('[data-sg-cancel]').addEventListener('click', () => {
            editor = null;
            renderPanel();
        });

        // Enter saves here, unlike Story Notes: a goal is a single line, so a
        // newline would be a mistake far more often than an intention.
        // Shift+Enter still breaks the line for the rare long goal.
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                editorEl.querySelector('[data-sg-save]').click();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                editorEl.querySelector('[data-sg-cancel]').click();
            }
        });

        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }

    body.querySelectorAll('.sg-card').forEach((card) => {
        const goalId = card.getAttribute('data-sg-id');

        card.querySelector('[data-sg-check]').addEventListener('click', () => {
            toggleGoal(goalId);
            renderPanel();
        });

        card.querySelector('[data-sg-add-step]').addEventListener('click', () => {
            editor = { mode: 'newStep', goalId };
            renderPanel();
        });

        card.querySelector('[data-sg-edit]').addEventListener('click', () => {
            editor = { mode: 'goal', goalId };
            renderPanel();
        });

        card.querySelector('[data-sg-delete]').addEventListener('click', () => {
            deleteGoal(goalId);
            editor = null;
            renderPanel();
        });

        card.querySelectorAll('.sg-step').forEach((row) => {
            const stepId = row.getAttribute('data-sg-step-id');

            row.querySelector('[data-sg-step-check]').addEventListener('click', () => {
                toggleStep(goalId, stepId);
                renderPanel();
            });

            row.querySelector('[data-sg-step-edit]').addEventListener('click', () => {
                editor = { mode: 'step', goalId, stepId };
                renderPanel();
            });

            row.querySelector('[data-sg-step-delete]').addEventListener('click', () => {
                deleteStep(goalId, stepId);
                renderPanel();
            });
        });
    });
}

function wireSettings(body) {
    // Language applies immediately, without the Save button: a panel you cannot
    // read is a bad place to go looking for one. Position and preamble still
    // wait for Save, so a half-typed preamble is never injected.
    body.querySelector('#sg-lang').addEventListener('change', (event) => {
        const settings = getSettings();
        settings.lang = event.target.value;

        // Keep whatever is currently typed into the other two fields, so
        // switching language mid-edit does not throw the edits away.
        settings.position = body.querySelector('#sg-position').value;
        settings.preamble = body.querySelector('#sg-preamble').value;

        saveSettings(settings);
        updatePromptInjection();
        renderPanel();
    });

    body.querySelector('#sg-settings-save').addEventListener('click', () => {
        const settings = getSettings();
        settings.position = body.querySelector('#sg-position').value;
        settings.preamble = body.querySelector('#sg-preamble').value;
        saveSettings(settings);
        updatePromptInjection();
        showSettings = false;
        renderPanel();
    });

    body.querySelector('#sg-settings-reset').addEventListener('click', () => {
        body.querySelector('#sg-preamble').value = DEFAULT_PREAMBLE;
    });
}

/* ------------------------------ export/import ------------------------------ */

function exportGoals() {
    const goals = getGoals();

    if (goals.length === 0) {
        alert(t('exportEmpty'));
        return;
    }

    const payload = {
        type: 'story_goals',
        version: 1,
        exported: new Date().toISOString(),
        goals,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    const chatId = getCurrentChatId() || 'chat';
    link.href = url;
    link.download = `story-goals-${String(chatId).replace(/[^\w.-]+/g, '_')}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function importGoals(file) {
    const reader = new FileReader();

    reader.onload = () => {
        let incoming = [];

        try {
            const parsed = JSON.parse(String(reader.result));
            incoming = normalizeGoals(Array.isArray(parsed) ? parsed : parsed?.goals);
        } catch (error) {
            console.error('[Story Goals] Import failed:', error);
            alert(t('importUnreadable'));
            return;
        }

        if (incoming.length === 0) {
            alert(t('importEmpty'));
            return;
        }

        const existing = getGoals();
        const replace = existing.length > 0 && confirm(t('importReplace', incoming.length, existing.length));

        // Fresh ids on import, goals and steps alike: two files exported from
        // the same chat would otherwise collide and edits would hit the wrong
        // row.
        const stamped = incoming.map((goal) => ({
            ...goal,
            id: makeId('g'),
            steps: goal.steps.map((step) => ({ ...step, id: makeId('s') })),
        }));

        saveGoals(replace ? stamped : [...stamped, ...existing]);
        updatePromptInjection();
        renderPanel();
    };

    reader.readAsText(file);
}

/* ------------------------------- geometry ------------------------------- */

const DRAG_EDGE = 8;
const DRAG_TOP_MARGIN = 50;
const PANEL_MIN_H = 240;
const COMPACT_WIDTH = 600;   // must match the media query in style.css

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// visualViewport is more honest than innerHeight on tablets, where browser
// chrome expands and collapses.
function viewportSize() {
    const vv = window.visualViewport;
    if (vv && vv.width && vv.height) return { w: vv.width, h: vv.height };
    return { w: window.innerWidth, h: window.innerHeight };
}

function isCompactViewport() {
    return viewportSize().w <= COMPACT_WIDTH;
}

function clampToViewport(el, left, top) {
    const w = el.offsetWidth || 0;
    const h = el.offsetHeight || 0;
    const vp = viewportSize();
    const maxLeft = Math.max(DRAG_EDGE, vp.w - w - DRAG_EDGE);
    const maxTop = Math.max(DRAG_TOP_MARGIN, vp.h - h - DRAG_EDGE);

    return {
        left: clamp(left, DRAG_EDGE, maxLeft),
        top: clamp(top, DRAG_TOP_MARGIN, maxTop),
    };
}

function applyPosition(el, left, top) {
    // Inline !important beats the fixed-position rules (and the mobile media
    // query) in style.css, so a dragged element actually moves.
    el.style.setProperty('left', `${left}px`, 'important');
    el.style.setProperty('top', `${top}px`, 'important');
    el.style.setProperty('right', 'auto', 'important');
    el.style.setProperty('bottom', 'auto', 'important');
}

function restorePosition(el, storageKey) {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
            const p = clampToViewport(el, saved.left, saved.top);
            applyPosition(el, p.left, p.top);
        }
    } catch (error) {
        console.error('[Story Goals] Failed to restore position:', error);
    }
}

// Drag `el` by `handle`, remembering the position. Sets el.__sgDragMoved so a
// click handler on the same element can tell a drag from a tap.
function makeDraggable(el, { storageKey, handle = el } = {}) {
    restorePosition(el, storageKey);
    handle.style.touchAction = 'none';

    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    handle.addEventListener('pointerdown', (event) => {
        const innerButton = event.target.closest('button');
        if (innerButton && innerButton !== el) return;
        if (event.button != null && event.button !== 0) return;

        dragging = true;
        moved = false;
        el.__sgDragMoved = false;

        const rect = el.getBoundingClientRect();
        baseLeft = rect.left;
        baseTop = rect.top;
        startX = event.clientX;
        startY = event.clientY;

        try { handle.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
    });

    handle.addEventListener('pointermove', (event) => {
        if (!dragging) return;

        const dx = event.clientX - startX;
        const dy = event.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 5) return;

        moved = true;
        el.__sgDragMoved = true;

        const p = clampToViewport(el, baseLeft + dx, baseTop + dy);
        applyPosition(el, p.left, p.top);
    });

    function finish(event) {
        if (!dragging) return;
        dragging = false;

        try { handle.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }

        if (moved) {
            const rect = el.getBoundingClientRect();
            try {
                localStorage.setItem(storageKey, JSON.stringify({ left: rect.left, top: rect.top }));
            } catch (e) { /* ignore */ }
        }
    }

    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
}

/* ------------------------------- resizing ------------------------------- */

// Height only. The width is style.css's business — it is shared with the rest
// of the set, and a two-axis corner grip invites mis-taps on a tablet.
function clampHeight(el, height) {
    const vp = viewportSize();
    const rect = el.getBoundingClientRect();

    // An untouched panel is pinned to the bottom by CSS, so growing it moves
    // its top edge up; a dragged one is pinned by top and grows downward.
    const room = el.style.top
        ? vp.h - rect.top - DRAG_EDGE
        : rect.bottom - DRAG_TOP_MARGIN;

    return clamp(height, PANEL_MIN_H, Math.max(PANEL_MIN_H, room));
}

function applyHeight(el, height) {
    el.style.setProperty('height', `${height}px`, 'important');
}

function restoreHeight(el) {
    if (isCompactViewport()) {
        el.style.removeProperty('height');
        return;
    }

    try {
        const saved = JSON.parse(localStorage.getItem(LS_PANEL_SIZE_KEY) || 'null');
        if (!saved || !Number.isFinite(saved.h)) return;
        applyHeight(el, clampHeight(el, saved.h));
    } catch (error) {
        console.error('[Story Goals] Failed to restore height:', error);
    }
}

function makeResizable(el, grip) {
    if (!grip) return;
    grip.style.touchAction = 'none';

    let resizing = false;
    let startY = 0;
    let baseH = 0;

    grip.addEventListener('pointerdown', (event) => {
        if (event.button != null && event.button !== 0) return;
        if (isCompactViewport()) return;

        resizing = true;
        baseH = el.getBoundingClientRect().height;
        startY = event.clientY;
        el.classList.add('sg-resizing');

        try { grip.setPointerCapture(event.pointerId); } catch (e) { /* ignore */ }
        event.preventDefault();
    });

    grip.addEventListener('pointermove', (event) => {
        if (!resizing) return;
        applyHeight(el, clampHeight(el, baseH + (event.clientY - startY)));
    });

    function finish(event) {
        if (!resizing) return;
        resizing = false;
        el.classList.remove('sg-resizing');

        try { grip.releasePointerCapture(event.pointerId); } catch (e) { /* ignore */ }

        const rect = el.getBoundingClientRect();
        try {
            localStorage.setItem(LS_PANEL_SIZE_KEY, JSON.stringify({ h: rect.height }));
            if (el.style.top) {
                localStorage.setItem(LS_PANEL_POS_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
            }
        } catch (e) { /* ignore */ }
    }

    grip.addEventListener('pointerup', finish);
    grip.addEventListener('pointercancel', finish);

    grip.addEventListener('dblclick', () => {
        try { localStorage.removeItem(LS_PANEL_SIZE_KEY); } catch (e) { /* ignore */ }
        el.style.removeProperty('height');
    });
}

/* ---------------------------------- UI ---------------------------------- */

function createUi() {
    if (document.querySelector('#sg-panel')) return;

    const button = document.createElement('button');
    button.id = 'sg-button';
    button.type = 'button';
    button.innerHTML = '<i class="fa-solid fa-compass"></i>';
    document.body.appendChild(button);

    const panel = document.createElement('div');
    panel.id = 'sg-panel';
    panel.style.display = 'none';
    panel.innerHTML = `
        <div id="sg-header">
            <div id="sg-brand">
                <i class="fa-solid fa-compass"></i>
                <div id="sg-title">Story Goals</div>
                <div id="sg-title-count">0/0</div>
            </div>
            <div id="sg-header-actions">
                <button type="button" id="sg-add"><i class="fa-solid fa-plus"></i></button>
                <button type="button" id="sg-settings-toggle"><i class="fa-solid fa-gear"></i></button>
                <button type="button" id="sg-close"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div id="sg-searchbar">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="search" id="sg-search" autocomplete="off">
        </div>
        <div id="sg-body"></div>
        <div id="sg-resize"></div>
        <div id="sg-actions">
            <button type="button" id="sg-export" class="sg-secondary"><i class="fa-solid fa-download"></i> <span class="sg-label"></span></button>
            <button type="button" id="sg-import" class="sg-secondary"><i class="fa-solid fa-upload"></i> <span class="sg-label"></span></button>
            <button type="button" id="sg-clear" class="sg-secondary sg-danger-text"><i class="fa-solid fa-trash"></i></button>
        </div>
        <input type="file" id="sg-import-file" accept="application/json,.json" hidden>
    `;
    document.body.appendChild(panel);

    makeDraggable(panel, {
        storageKey: LS_PANEL_POS_KEY,
        handle: panel.querySelector('#sg-header'),
    });
    makeDraggable(button, { storageKey: LS_BUTTON_POS_KEY });
    makeResizable(panel, panel.querySelector('#sg-resize'));

    // Height first: the position clamp depends on the panel's dimensions.
    restoreHeight(panel);
    applyStaticLabels();

    button.addEventListener('click', () => {
        // A drag that ends over the button also fires a click.
        if (button.__sgDragMoved) {
            button.__sgDragMoved = false;
            return;
        }

        const opening = panel.style.display === 'none';
        panel.style.display = opening ? 'flex' : 'none';

        if (opening) {
            // A hidden panel measures 0x0, so both clamps only mean something
            // once it is actually on screen.
            restoreHeight(panel);
            restorePosition(panel, LS_PANEL_POS_KEY);
            renderPanel();
        }
    });

    panel.querySelector('#sg-close').addEventListener('click', () => {
        panel.style.display = 'none';
        editor = null;
        showSettings = false;
    });

    panel.querySelector('#sg-add').addEventListener('click', () => {
        showSettings = false;
        editor = { mode: 'newGoal' };
        renderPanel();
    });

    panel.querySelector('#sg-settings-toggle').addEventListener('click', () => {
        showSettings = !showSettings;
        editor = null;
        renderPanel();
    });

    const search = panel.querySelector('#sg-search');
    search.addEventListener('input', () => {
        searchQuery = search.value;
        renderPanel();
    });

    panel.querySelector('#sg-export').addEventListener('click', exportGoals);

    const fileInput = panel.querySelector('#sg-import-file');
    panel.querySelector('#sg-import').addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
        const file = fileInput.files?.[0];
        if (file) importGoals(file);
        fileInput.value = '';
    });

    panel.querySelector('#sg-clear').addEventListener('click', () => {
        if (!confirm(t('confirmClear'))) return;

        clearGoals();
        updatePromptInjection();
        renderPanel();
    });

    // Rotating a tablet or resizing the window changes what "on-screen" means.
    window.addEventListener('resize', () => {
        if (panel.style.display !== 'none') {
            restoreHeight(panel);
            restorePosition(panel, LS_PANEL_POS_KEY);
        }
        restorePosition(button, LS_BUTTON_POS_KEY);
    });
}

/* --------------------------------- events --------------------------------- */

function handleChatChanged() {
    // New chat, new list: reset the transient UI state so an editor left open
    // in the old chat cannot save into the new one.
    editor = null;
    showSettings = false;
    searchQuery = '';

    const search = document.querySelector('#sg-search');
    if (search) search.value = '';

    renderPanel();
    updatePromptInjection();
}

// Event names differ between SillyTavern versions, and eventSource.on(undefined)
// throws, which would abort the rest of init().
function onEvent(label, handler) {
    const name = event_types?.[label];

    if (!name) {
        console.warn(`[Story Goals] Event ${label} is not available in this SillyTavern version; skipping.`);
        return;
    }

    eventSource.on(name, handler);
}

function init() {
    createUi();
    registerMacroSafe();
    updatePromptInjection();

    onEvent('CHAT_CHANGED', handleChatChanged);

    // Rebuilt right before the prompt is assembled, so what goes out is always
    // the current list — never a stale copy of a goal that was ticked off.
    onEvent('GENERATE_BEFORE_COMBINE_PROMPTS', updatePromptInjection);
    onEvent('GENERATION_STARTED', updatePromptInjection);

    log('Extension loaded.');
}

setTimeout(init, 1000);
