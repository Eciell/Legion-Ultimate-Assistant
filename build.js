#!/usr/bin/env node
/**
 * Сборка userscript'ов Legion.
 *
 * Никаких Webpack/Rollup: файлы из src/ просто склеиваются в один бандл
 * в строго заданном порядке. Шапка (==UserScript==) идёт вне IIFE,
 * всё остальное — внутрь одной функции-обёртки.
 *
 * Две независимые сборки:
 *   --ultimate -> dist/LegionUltimate.user.js (публичная, src/header-ultimate.js)
 *   --personal -> dist/LegionPersonal.user.js (личная,   src/header-personal.js)
 *
 * Использование:
 *   node build.js --all         -> обе сборки (по умолчанию)
 *   node build.js               -> то же самое, что --all
 *   node build.js --personal    -> только dist/LegionPersonal.user.js - Это я для себя делаю аддон, под мои цели
 *   node build.js --ultimate    -> только dist/LegionUltimate.user.js - Это общий аддон для всех пользователей
 *   node build.js --help        -> справка
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

// Шапки. Personal собирается без @updateURL/@downloadURL (только локальная сборка),
// Ultimate — с автообновлением через raw-URL GitHub.
const HEADER_PERSONAL = 'header-personal.js';
const HEADER_ULTIMATE = 'header-ultimate.js';

const MAIN_FILE = 'main.js';
const CHAT_FILE = 'modules/chat.js';
const MINER_FILE = 'modules/miner.js';
// Личный модуль: подключается только в Personal и только если файл существует.
const QUEST_FILE = 'modules/quest.js';

/**
 * Порядок склейки = порядок исполнения внутри IIFE.
 * Утилиты и константы обязаны объявляться раньше модулей, которые их
 * используют (const попадает в temporal dead zone до инициализации).
 */
const CORE_ORDER = [
    'core/utils.js',
    'core/styles.js',
    'core/hooks.js',
    'core/ui.js'
];

// Модули, которые входят в обе сборки.
const SHARED_MODULES = [
    'modules/build-sim.js',
    'modules/hero-planner.js',
    'modules/auction.js',
    'modules/players.js'
];

/**
 * Состав сборок — жёсткие списки файлов.
 *
 * В Ultimate miner.js и quest.js не входят вообще: если такого файла нет,
 * сборка публичной версии от этого не меняется (список проверяется целиком,
 * любой отсутствующий файл -> фатальная ошибка).
 */
const TARGETS = {
    ultimate: {
        output: 'LegionUltimate.user.js',
        header: HEADER_ULTIMATE,
        modules: [...SHARED_MODULES, CHAT_FILE],
        optionalModules: [],
        // main.js обращается к Miner в boot()/shutdown() — на месте модуля заглушка.
        minerStub: true,
        title: 'Ultimate (публичная, без Майнера)'
    },
    personal: {
        output: 'LegionPersonal.user.js',
        header: HEADER_PERSONAL,
        modules: [...SHARED_MODULES, MINER_FILE, CHAT_FILE],
        optionalModules: [QUEST_FILE],
        minerStub: false,
        title: 'Personal (личная, с Майнером)'
    }
};

/**
 * Заглушка вместо miner.js для Ultimate-сборки.
 *
 * Сам модуль в публичную версию не входит, но main.js обращается к Miner в
 * boot() и shutdown() — без заглушки Ultimate падал бы с ReferenceError.
 * Заглушка повторяет публичный контракт (init/stopMining/abortController)
 * и убирает из меню кнопку «Умная Шахта». Кода авто-копания здесь нет.
 */
const MINER_STUB = [
    '    const Miner = {',
    '        abortController: null,',
    '        init() {',
    '            document.getElementById(DOM_IDS.btnAutoMine)?.remove();',
    '        },',
    '        stopMining() {}',
    '    };'
].join('\n');

function readSource(relPath) {
    const absPath = path.join(SRC_DIR, relPath);
    if (!fs.existsSync(absPath)) {
        throw new Error(`Не найден файл модуля: ${path.relative(ROOT, absPath)}`);
    }
    return fs.readFileSync(absPath, 'utf8')
        .replace(/^\uFEFF/, '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s+$/, '');
}

function banner(relPath, note) {
    return `    // ===== src/${relPath}${note ? ' ' + note : ''} =====`;
}

function assemble(target) {
    const chunks = [];

    // 1. Шапка Userscript — всегда вне IIFE, иначе Tampermonkey не увидит метаданные.
    //    Файл шапки жёстко закреплён за сборкой (см. TARGETS).
    chunks.push(readSource(target.header), '');

    // 2. Общая обёртка.
    chunks.push('(function() {', "    'use strict';", '');

    // 3. Ядро.
    for (const relPath of CORE_ORDER) {
        chunks.push(banner(relPath), readSource(relPath), '');
    }

    // 4. Модули строго по списку сборки. readSource() падает, если файла нет:
    //    для Ultimate это фатальная ошибка, никаких «мягких» пропусков.
    for (const relPath of target.modules) {
        // Ultimate собирается без miner.js — на его месте ставим заглушку,
        // иначе boot()/shutdown() из main.js упадут с ReferenceError.
        if (target.minerStub && relPath === CHAT_FILE) {
            chunks.push(banner(MINER_FILE, '(исключён из этой сборки, используется заглушка)'), MINER_STUB, '');
        }
        chunks.push(banner(relPath), readSource(relPath), '');
    }

    // 5. Личные необязательные модули (только Personal): подключаются, если файл создан.
    //    Для Ultimate список optionalModules пуст, existsSync здесь не вызывается.
    for (const relPath of target.optionalModules) {
        if (!fs.existsSync(path.join(SRC_DIR, relPath))) continue;
        chunks.push(banner(relPath), readSource(relPath), '');
    }

    // 6. Точка входа.
    chunks.push(banner(MAIN_FILE), readSource(MAIN_FILE), '');

    // 7. Закрытие обёртки.
    chunks.push('})();', '');

    return chunks.join('\n');
}

function validateSyntax(code, filename) {
    try {
        // Компиляция без исполнения: ловит синтаксические ошибки до записи в dist.
        new vm.Script(code, { filename });
    } catch (err) {
        throw new Error(`Синтаксическая ошибка в ${filename}: ${err.message}`);
    }
}

function build(targetName) {
    const target = TARGETS[targetName];
    const filename = `dist/${target.output}`;
    const code = assemble(target);

    validateSyntax(code, filename);

    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIST_DIR, target.output), code, 'utf8');

    const lineCount = code.split('\n').length - 1; // без учёта завершающего перевода строки
    const byteCount = Buffer.byteLength(code, 'utf8');
    console.log(`  ✓ ${filename} — ${lineCount} строк, ${byteCount} байт — ${target.title}`);
}

function usage() {
    console.log([
        'Сборка Legion (склейка src/ -> dist/).',
        '',
        '  node build.js --all         собрать обе версии (по умолчанию)',
        '  node build.js --ultimate    только LegionUltimate.user.js (публичная, без Майнера)',
        '  node build.js --personal    только LegionPersonal.user.js (личная, с Майнером)',
        '  node build.js --help        эта справка'
    ].join('\n'));
}

function main() {
    const args = process.argv.slice(2).filter(arg => arg !== '--');
    const known = ['--all', '--ultimate', '--personal', '--help', '-h'];
    const unknown = args.filter(arg => !known.includes(arg));

    if (unknown.length) {
        console.error(`Неизвестный аргумент: ${unknown.join(', ')}`);
        usage();
        process.exitCode = 1;
        return;
    }

    if (args.includes('--help') || args.includes('-h')) {
        usage();
        return;
    }

    const onlyPersonal = args.includes('--personal');
    const onlyUltimate = args.includes('--ultimate');

    // Сборки независимы: один флаг -> ровно одна сборка.
    const targets = [];
    if (onlyUltimate && !onlyPersonal) targets.push('ultimate');
    else if (onlyPersonal && !onlyUltimate) targets.push('personal');
    else targets.push('ultimate', 'personal'); // --all, без аргументов или оба флага

    console.log(`Сборка Legion [${targets.join(', ')}]`);
    for (const targetName of targets) build(targetName);
    console.log('Готово.');
}

try {
    main();
} catch (err) {
    console.error(`\n[ОШИБКА] ${err.message}`);
    process.exitCode = 1;
}
