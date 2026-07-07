import js from "@eslint/js";
import jsonc from "eslint-plugin-jsonc";
import sortKeysFix from "eslint-plugin-sort-keys-fix";
import vue from "eslint-plugin-vue";

const browserGlobals = {
    EventSource: "readonly",
    URLSearchParams: "readonly",
    console: "readonly",
    document: "readonly",
    fetch: "readonly",
    setInterval: "readonly",
    window: "readonly",
};

const nodeGlobals = {
    Buffer: "readonly",
    console: "readonly",
    process: "readonly",
    setTimeout: "readonly",
};

const arrowFunctionOnlyRules = {
    "no-restricted-syntax": [
        "error",
        {
            message: "Use a const arrow function instead of a function declaration.",
            selector: "FunctionDeclaration",
        },
        {
            message: "Use an arrow function instead of a function expression.",
            selector:
                "FunctionExpression:not(MethodDefinition > FunctionExpression):not(Property[method=true] > FunctionExpression)",
        },
    ],
};

export default [
    {
        ignores: ["node_modules/", "package-lock.json", "ui/dist/", "data/"],
    },
    js.configs.recommended,
    ...vue.configs["flat/recommended"],
    ...jsonc.configs["flat/recommended-with-json"],
    {
        files: ["*.js", "main.js"],
        languageOptions: {
            ecmaVersion: "latest",
            globals: nodeGlobals,
            sourceType: "module",
        },
        plugins: {
            "sort-keys-fix": sortKeysFix,
        },
        rules: {
            ...arrowFunctionOnlyRules,
            "arrow-body-style": ["error", "as-needed"],
            "no-console": "off",
            "no-var": "error",
            "object-shorthand": ["error", "always"],
            "padded-blocks": ["error", "never"],
            "prefer-arrow-callback": [
                "error",
                {
                    allowNamedFunctions: false,
                    allowUnboundThis: true,
                },
            ],
            "prefer-const": [
                "error",
                {
                    destructuring: "any",
                    ignoreReadBeforeAssign: false,
                },
            ],
            "sort-keys-fix/sort-keys-fix": [
                "error",
                "asc",
                {
                    caseSensitive: false,
                    natural: true,
                },
            ],
        },
    },
    {
        files: ["ui/**/*.js", "ui/**/*.vue"],
        languageOptions: {
            ecmaVersion: "latest",
            globals: browserGlobals,
            sourceType: "module",
        },
        plugins: {
            "sort-keys-fix": sortKeysFix,
        },
        rules: {
            ...arrowFunctionOnlyRules,
            "sort-keys-fix/sort-keys-fix": [
                "error",
                "asc",
                {
                    caseSensitive: false,
                    natural: true,
                },
            ],
            "vue/component-definition-name-casing": ["error", "PascalCase"],
            "vue/component-name-in-template-casing": ["error", "PascalCase"],
            "vue/first-attribute-linebreak": "off",
            "vue/html-closing-bracket-newline": "off",
            "vue/html-indent": "off",
            "vue/html-self-closing": "off",
            "vue/max-attributes-per-line": "off",
            "vue/multi-word-component-names": "off",
            "vue/multiline-html-element-content-newline": "off",
            "vue/script-indent": "off",
            "vue/singleline-html-element-content-newline": "off",
        },
    },
    {
        files: ["**/*.json"],
        rules: {
            "jsonc/comma-dangle": ["error", "never"],
            "jsonc/indent": ["error", 4],
            "jsonc/key-spacing": [
                "error",
                {
                    afterColon: true,
                    beforeColon: false,
                },
            ],
            "jsonc/sort-keys": "off",
            "sort-keys-fix/sort-keys-fix": "off",
        },
    },
    {
        files: ["*.config.js", ".eslintrc.js", ".prettierrc.js", ".stylelintrc.js"],
        rules: {
            "sort-keys-fix/sort-keys-fix": "off",
        },
    },
];
