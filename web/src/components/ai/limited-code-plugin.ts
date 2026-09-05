import type { BundledLanguage, BundledTheme, CodeHighlighterPlugin, HighlightOptions } from "streamdown";
import type { HighlighterCore, LanguageRegistration, TokensResult } from "shiki";

type LanguageModule = { default: LanguageRegistration[] };
type LanguageLoader = () => Promise<LanguageModule>;
type LimitedLanguage = "bash" | "css" | "go" | "html" | "java" | "javascript" | "json" | "markdown" | "python" | "rust" | "sql" | "typescript";

const LANGUAGE_LOADERS: Record<LimitedLanguage, LanguageLoader> = {
    bash: () => import("shiki/dist/langs/bash.mjs"),
    css: () => import("shiki/dist/langs/css.mjs"),
    go: () => import("shiki/dist/langs/go.mjs"),
    html: () => import("shiki/dist/langs/html.mjs"),
    java: () => import("shiki/dist/langs/java.mjs"),
    javascript: () => import("shiki/dist/langs/javascript.mjs"),
    json: () => import("shiki/dist/langs/json.mjs"),
    markdown: () => import("shiki/dist/langs/markdown.mjs"),
    python: () => import("shiki/dist/langs/python.mjs"),
    rust: () => import("shiki/dist/langs/rust.mjs"),
    sql: () => import("shiki/dist/langs/sql.mjs"),
    typescript: () => import("shiki/dist/langs/typescript.mjs"),
};

const LANGUAGE_ALIASES: Record<string, LimitedLanguage> = {
    bash: "bash",
    cjs: "javascript",
    css: "css",
    go: "go",
    golang: "go",
    htm: "html",
    html: "html",
    java: "java",
    js: "javascript",
    javascript: "javascript",
    json: "json",
    jsx: "javascript",
    md: "markdown",
    markdown: "markdown",
    py: "python",
    python: "python",
    rs: "rust",
    rust: "rust",
    sh: "bash",
    shell: "bash",
    sql: "sql",
    ts: "typescript",
    tsx: "typescript",
    typescript: "typescript",
};

const SUPPORTED_LANGUAGES = Object.keys(LANGUAGE_ALIASES) as BundledLanguage[];
const THEMES: [BundledTheme, BundledTheme] = ["github-light", "github-dark"];
const MAX_HIGHLIGHT_CACHE_ENTRIES = 64;

type HighlightTask = Promise<TokensResult>;

let highlighterPromise: Promise<HighlighterCore> | null = null;
const languagePromises = new Map<LimitedLanguage, Promise<void>>();
const highlightTasks = new Map<string, HighlightTask>();

function normalizeLanguage(language: string): LimitedLanguage | null {
    return LANGUAGE_ALIASES[language.trim().toLowerCase()] || null;
}

async function getHighlighter(): Promise<HighlighterCore> {
    if (!highlighterPromise) {
        const initializing = Promise.all([import("shiki/core"), import("shiki/engine/javascript"), import("shiki/dist/themes/github-light.mjs"), import("shiki/dist/themes/github-dark.mjs")])
            .then(async ([core, engine, light, dark]) =>
                core.createHighlighterCore({
                    engine: engine.createJavaScriptRegexEngine(),
                    themes: [light.default, dark.default],
                    langs: [],
                    warnings: false,
                }),
            )
            .catch((error) => {
                if (highlighterPromise === initializing) highlighterPromise = null;
                throw error;
            });
        highlighterPromise = initializing;
    }
    return highlighterPromise;
}

async function ensureLanguage(highlighter: HighlighterCore, language: LimitedLanguage) {
    if (highlighter.getLoadedLanguages().includes(language)) return;

    let loading = languagePromises.get(language);
    if (!loading) {
        const task = LANGUAGE_LOADERS[language]()
            .then((module) => highlighter.loadLanguage(module.default))
            .catch((error) => {
                if (languagePromises.get(language) === task) languagePromises.delete(language);
                throw error;
            });
        languagePromises.set(language, task);
        loading = task;
    }
    await loading;
}

function createHighlightKey(code: string, language: LimitedLanguage) {
    return `${language}:${code}`;
}

function rememberHighlightTask(key: string, task: HighlightTask) {
    highlightTasks.set(key, task);
    if (highlightTasks.size <= MAX_HIGHLIGHT_CACHE_ENTRIES) return;

    const oldestKey = highlightTasks.keys().next().value;
    if (oldestKey) highlightTasks.delete(oldestKey);
}

function highlightCode(code: string, language: LimitedLanguage): HighlightTask {
    const key = createHighlightKey(code, language);
    const cached = highlightTasks.get(key);
    if (cached) return cached;

    const task = getHighlighter()
        .then(async (highlighter) => {
            await ensureLanguage(highlighter, language);
            return highlighter.codeToTokens(code, {
                lang: language,
                themes: {
                    light: THEMES[0],
                    dark: THEMES[1],
                },
                defaultColor: "light",
            });
        })
        .catch((error) => {
            highlightTasks.delete(key);
            throw error;
        });

    rememberHighlightTask(key, task);
    return task;
}

export function createLimitedCodePlugin(): CodeHighlighterPlugin {
    return {
        name: "shiki",
        type: "code-highlighter",
        getSupportedLanguages: () => SUPPORTED_LANGUAGES,
        getThemes: () => THEMES,
        supportsLanguage: (language) => normalizeLanguage(language) !== null,
        highlight: (options: HighlightOptions, callback) => {
            const language = normalizeLanguage(options.language);
            if (!language) return null;

            void highlightCode(options.code, language)
                .then((result) => callback?.(result))
                .catch((error) => {
                    console.error("[Limited Streamdown Code] Failed to highlight code:", error);
                });
            return null;
        },
    };
}
