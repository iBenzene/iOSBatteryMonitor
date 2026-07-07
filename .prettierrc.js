export default {
    arrowParens: "avoid",
    bracketSameLine: false,
    bracketSpacing: true,
    endOfLine: "lf",
    htmlWhitespaceSensitivity: "css",
    overrides: [
        {
            files: ["*.json", "**/*.json"],
            options: {
                tabWidth: 4,
                trailingComma: "none",
            },
        },
        {
            files: ["*.md"],
            options: {
                proseWrap: "preserve",
                tabWidth: 2,
            },
        },
        {
            files: ["ui/**/*.js", "ui/**/*.vue"],
            options: {
                singleQuote: true,
                tabWidth: 4,
            },
        },
        {
            files: ["**/*.css", "**/*.html"],
            options: {
                tabWidth: 4,
            },
        },
    ],
    printWidth: 120,
    quoteProps: "as-needed",
    semi: true,
    singleQuote: false,
    tabWidth: 4,
    trailingComma: "es5",
    useTabs: false,
    vueIndentScriptAndStyle: false,
};
