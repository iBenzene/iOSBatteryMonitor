export default {
    extends: ["stylelint-config-standard"],
    ignoreFiles: ["node_modules/**", "ui/dist/**"],
    overrides: [
        {
            customSyntax: "postcss-html",
            files: ["**/*.vue"],
        },
    ],
    plugins: ["stylelint-order"],
    rules: {
        "at-rule-empty-line-before": null,
        "declaration-empty-line-before": null,
        "no-descending-specificity": null,
        "order/properties-alphabetical-order": true,
        "selector-class-pattern": null,
        "selector-pseudo-class-no-unknown": [
            true,
            {
                ignorePseudoClasses: ["deep", "global", "slotted"],
            },
        ],
    },
};
