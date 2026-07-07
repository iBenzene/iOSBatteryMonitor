export default {
    "*.{json,md}": ["prettier --config .prettierrc.js --write"],
    "**/*.js": [
        "ESLINT_USE_FLAT_CONFIG=true eslint --config .eslintrc.js --fix",
        "prettier --config .prettierrc.js --write",
    ],
    "**/*.vue": [
        "ESLINT_USE_FLAT_CONFIG=true eslint --config .eslintrc.js --fix",
        "prettier --config .prettierrc.js --write",
    ],
    "ui/**/*.{css,vue}": ["stylelint --config .stylelintrc.js --fix", "prettier --config .prettierrc.js --write"],
};
