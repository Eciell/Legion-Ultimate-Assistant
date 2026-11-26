#!/usr/bin/env node
/**
 * Сборка userscript Legion Ultimate Assistant.
 *
 * Никаких Webpack/Rollup: файлы из src/ просто склеиваются в один бандл
 * в строго заданном порядке. Шапка (==UserScript==) идёт вне IIFE,
 * всё остальное — внутрь одной функции-обёртки.
 *
 * Результат: dist/LegionUltimate.user.js
 *
 * Использование:
 *   node build.js               -> собрать dist/LegionUltimate.user.js
 *   node build.js --ultimate    -> то же самое (флаг оставлен для совместимости)
 *   node build.js --all         -> то же самое (флаг оставлен для совместимости)
 *   node build.js --help        -> справка
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const SRC_DIR = path.join(ROOT, 'src');
const DIST_DIR = path.join(ROOT, 'dist');

const HEADER_FILE = 'header-ultimate.js';
const MAIN_FILE = 'main.js';
const OUTPUT_FILE = 'LegionUltimate.user.js';

/**
 * Порядок склейки = порядок исполнения внутри IIFE.
 * Утилиты и константы обязаны объявляться раньше модулей, которые их
 * используют (const попадает в temporal dead zone до инициализации).
 */
const CORE_ORDER = [
    // utils.js разбит на модули. Порядок критичен (TDZ):
    // constants.js объявляет G/DOM_IDS/API_BASE/Utils={}, остальные модули
    // дополняют Utils через Object.assign, поэтому идут строго после него.
    'core/constants.js',
    'core/utils-format.js',
    'core/utils-api.js',
    'core/utils-art.js',
    'core/utils.js',
    'core/styles.js',
    'core/hooks.js',
    // HTML-шаблоны (FAB-меню, модалки, HUD) вынесены из ui.js и main.js.
    // Идут строго перед ui.js: методы UI зовут UITemplates.
    'core/ui-templates.js',
    'core/ui.js'
];

/**
 * Игровые модули. Подключаются после ядра, поэтому G/Utils/DOM_IDS/UI
 * уже объявлены.
 */
const MODULES = [
    'modules/build-sim.js',
    'modules/hero-planner.js',
    'modules/auction.js',
    'modules/players.js',
    // Логика «Карманного города» вынесена из ui.js в отдельный модуль.
    'modules/pocket-city.js',
    // «Боевой ассистент» — подсказки по механикам боссов в походе.
    // main.js вызывает init() в boot().
    'modules/combat-assistant.js',
    // «Пати» — клиент собственного сервера через GM_xmlhttpRequest.
    // main.js вызывает Party.init() последним.
    'modules/party.js',
    // Подсветка ников пользователей аддона в нативном чате. Ходит в
    // /heartbeat + /users через Party._request(auth:false) и рисует
    // подсветку атрибутным CSS. Идёт после party.js, потому что использует
    // его сетевой слой и getBaseUrl().
    'modules/addon-presence.js',
    // «Арена» — оценка шанса победы, детект согильдейцев в отряде
    // противника и вкладка «Согильдейцы» в модалке приглашения.
    // Модуль автономен: состав гильдии запрашивает сам, работает поверх
    // arena2.js, хуки — только через core/hooks.js (LGArena.open).
    'modules/arena.js',
    // «Статистика гильдии» — четвёртая вкладка в НАТИВНОМ окне гильдии
    // (guilds2.js: .gl-modal / .gl-tabs1 / .gl-pane). Модуль автономен:
    // id гильдии берёт из G.ME / G.LGGuilds.index(), состав — через
    // GET /api/guilds/guild с кэшем в Map. main.js вызывает init() в boot(),
    // destroy() — в shutdown().
    'modules/guild-summary.js'
];

/**
 * Заглушка Miner для main.js: модуль авто-копания удалён, но точка входа
 * всё ещё обращается к Miner.init()/stopMining()/abortController.
 * Заглушка повторяет публичный контракт и убирает из меню кнопку
 * «Умная Шахта»; кода авто-копания и хуков шахты здесь нет.
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

function assemble() {
    const chunks = [];

    // 1. Шапка Userscript — всегда вне IIFE, иначе Tampermonkey не увидит метаданные.
    chunks.push(readSource(HEADER_FILE), '');

    // 2. Общая обёртка.
    chunks.push('(function() {', "    'use strict';", '');

    // 3. Ядро.
    for (const relPath of CORE_ORDER) {
        chunks.push(banner(relPath), readSource(relPath), '');
    }

    // 4. Заглушка Miner: main.js вызывает его методы при загрузке и остановке.
    chunks.push(banner('modules/miner.js', '(заглушка)'), MINER_STUB, '');

    // 5. Игровые модули. readSource() падает, если файла нет.
    for (const relPath of MODULES) {
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

function build() {
    const filename = `dist/${OUTPUT_FILE}`;
    const code = assemble();

    validateSyntax(code, filename);

    fs.mkdirSync(DIST_DIR, { recursive: true });
    fs.writeFileSync(path.join(DIST_DIR, OUTPUT_FILE), code, 'utf8');

    const lineCount = code.split('\n').length - 1; // без учёта завершающего перевода строки
    const byteCount = Buffer.byteLength(code, 'utf8');
    console.log(`  ✓ ${filename} — ${lineCount} строк, ${byteCount} байт`);
}

function usage() {
    console.log([
        'Сборка Legion Ultimate Assistant (склейка src/ -> dist/).',
        '',
        '  node build.js               собрать dist/LegionUltimate.user.js',
        '  node build.js --ultimate    то же самое (флаг для совместимости)',
        '  node build.js --all         то же самое (флаг для совместимости)',
        '  node build.js --help        эта справка'
    ].join('\n'));
}

function main() {
    const args = process.argv.slice(2).filter(arg => arg !== '--');
    const known = ['--all', '--ultimate', '--help', '-h'];
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

    console.log('Сборка LegionUltimate');
    build();
    console.log('Готово.');
}

try {
    main();
} catch (err) {
    console.error(`\n[ОШИБКА] ${err.message}`);
    process.exitCode = 1;
}
