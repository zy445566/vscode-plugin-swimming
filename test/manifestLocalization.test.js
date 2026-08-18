const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const projectRoot = path.resolve(__dirname, '..');
const packageJson = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
);
const defaultNls = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.nls.json'), 'utf8')
);
const chineseNls = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'package.nls.zh-cn.json'), 'utf8')
);
const defaultBundle = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'l10n', 'bundle.l10n.json'), 'utf8')
);
const chineseBundle = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'l10n', 'bundle.l10n.zh-cn.json'), 'utf8')
);

function getLocalizationKey(value) {
    const match = /^%(.+)%$/.exec(value);
    return match ? match[1] : undefined;
}

test('puts all editor context commands inside one Swimming submenu', () => {
    assert.deepEqual(packageJson.contributes.menus['editor/context'], [{
        submenu: 'swimming.menu',
        group: 'navigation',
    }]);
    assert.equal(packageJson.contributes.submenus.length, 1);
    assert.equal(packageJson.contributes.submenus[0].id, 'swimming.menu');
    assert.ok(packageJson.contributes.menus['swimming.menu'].length > 0);
});

test('localizes every manifest label in English and Simplified Chinese', () => {
    const labels = [
        packageJson.displayName,
        packageJson.description,
        packageJson.contributes.submenus[0].label,
        ...packageJson.contributes.commands.map((command) => command.title),
        packageJson.contributes.configuration.title,
        ...Object.values(packageJson.contributes.configuration.properties)
            .map((setting) => setting.description),
    ];

    for (const label of labels) {
        const key = getLocalizationKey(label);
        assert.ok(key, `manifest label is not localized: ${label}`);
        assert.equal(typeof defaultNls[key], 'string', `missing English label: ${key}`);
        assert.equal(typeof chineseNls[key], 'string', `missing Chinese label: ${key}`);
    }
});

test('provides matching runtime translations for English and Simplified Chinese', () => {
    const extensionSource = fs.readFileSync(
        path.join(projectRoot, 'src', 'extension.ts'),
        'utf8'
    );

    assert.equal(packageJson.l10n, './l10n');
    assert.match(extensionSource, /l10n\.t\(/);
    const runtimeMessages = [
        ...extensionSource.matchAll(/l10n\.t\(\s*'([^']+)'/g),
    ].map((match) => match[1]);
    for (const message of runtimeMessages) {
        assert.equal(typeof defaultBundle[message], 'string', 'missing English message: ' + message);
        assert.equal(typeof chineseBundle[message], 'string', 'missing Chinese message: ' + message);
    }
    for (const key of Object.keys(defaultBundle)) {
        assert.equal(typeof chineseBundle[key], 'string', `missing Chinese message: ${key}`);
    }
});

test('keeps Look While Typing controls as single-character settings', () => {
    const properties = packageJson.contributes.configuration.properties;
    const expectedSettings = [
        ['vscodePluginSwimming.lookWhileTypingScrollUpKey', '-'],
        ['vscodePluginSwimming.lookWhileTypingScrollDownKey', '='],
        ['vscodePluginSwimming.lookWhileTypingCloseTargetKey', '\\'],
        ['vscodePluginSwimming.lookWhileTypingReopenTargetKey', '`'],
    ];

    for (const [setting, defaultValue] of expectedSettings) {
        assert.equal(properties[setting]?.default, defaultValue);
    }

    const lookWhileTypingCommands = [
        'extension.swimming.scrollLookWhileTypingUp',
        'extension.swimming.scrollLookWhileTypingDown',
        'extension.swimming.closeLookWhileTypingTarget',
        'extension.swimming.reopenLookWhileTypingTarget',
    ];
    assert.equal(
        packageJson.contributes.keybindings.some((keybinding) => {
            return lookWhileTypingCommands.includes(keybinding.command);
        }),
        false
    );
});

test('offers line and cursor Look While Typing scroll modes', () => {
    const configuration = packageJson.contributes.configuration.properties;
    const scrollMode = configuration['vscodePluginSwimming.lookWhileTypingScrollMode'];

    assert.deepEqual(scrollMode.enum, ['line', 'cursor']);
    assert.equal(scrollMode.default, 'line');
});

test('documents the complete local VSIX packaging and installation workflow', () => {
    const readme = fs.readFileSync(path.join(projectRoot, 'README.md'), 'utf8');

    assert.match(readme, /pnpm install/);
    assert.match(readme, /pnpm test/);
    assert.match(readme, /pnpm run vsce:package/);
    assert.match(readme, /code --install-extension .*\.vsix/);
});

test('includes the compiled extension entrypoint in local VSIX packages', () => {
    assert.equal(
        packageJson.scripts['vsce:package'],
        'pnpm exec vsce package --no-dependencies --out swimming-local.vsix'
    );
    assert.equal(packageJson.files, undefined);
});

test('keeps compiled output available to the VSIX packager', () => {
    const vscodeIgnore = fs.readFileSync(
        path.join(projectRoot, '.vscodeignore'),
        'utf8'
    );

    assert.doesNotMatch(vscodeIgnore, /^out\/?$/m);
    assert.match(vscodeIgnore, /^node_modules\/\*\*$/m);
});
