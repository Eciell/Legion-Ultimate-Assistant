    // ============================================================
    // 0.2. УТИЛИТЫ ФОРМАТИРОВАНИЯ (core/utils-format.js)
    // Деньги/монеты, статистика и время. Методы обращаются друг к другу
    // через this.* (после Object.assign this === Utils), как и раньше.
    // ============================================================
    const UtilsFormat = {
        calculateMedian(arr) {
            if (!arr.length) return 0;
            const s = [...arr].sort((a, b) => a - b);
            const m = Math.floor(s.length / 2);
            return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
        },
        formatMoney(n) {
            n = Math.max(0, Math.floor(+n || 0));
            const g = Math.floor(n / 10000);
            const s = Math.floor(n / 100) % 100;
            const b = n % 100;
            const parts = [];
            if (g) parts.push(`${g} з`);
            if (s) parts.push(`${s} с`);
            if (b || (!g && !s)) parts.push(`${b} б`);
            return parts.join(' ');
        },
        // Разбор «12 з 34 с 56 б» → 123456
        parseCoinsText(str) {
            if (!str) return 0;
            let total = 0, matched = false;
            const g = String(str).match(/(\d+)\s*(?:з|зол)/i);
            const s = String(str).match(/(\d+)\s*(?:с|сер)/i);
            const b = String(str).match(/(\d+)\s*(?:б|мед)/i);
            if (g) { total += parseInt(g[1], 10) * 10000; matched = true; }
            if (s) { total += parseInt(s[1], 10) * 100; matched = true; }
            if (b) { total += parseInt(b[1], 10); matched = true; }
            return matched ? total : 0;
        },
        // Форматирование числа в HTML с иконками монет
        formatCoinsHtml(n) {
            n = Math.max(0, Math.floor(+n || 0));
            const g = Math.floor(n / 10000), s = Math.floor(n / 100) % 100, b = n % 100;
            const parts = [];
            if (g) parts.push(`<span>${g}<i class="b-coin-ico g" title="золотые"></i></span>`);
            if (s) parts.push(`<span>${s}<i class="b-coin-ico s" title="серебряные"></i></span>`);
            if (b || (!g && !s)) parts.push(`<span>${b}<i class="b-coin-ico b" title="медные"></i></span>`);
            const label = this.formatMoney(n);
            return `<span class="b-coin-wrap" role="img" aria-label="${label}" title="${label}">${parts.join(' ')}</span>`;
        },
        formatTimeLeft(ms) {
            if (!ms) return '—';
            const diff = ms - Date.now();
            if (diff <= 0) return 'Истек';
            const h = Math.floor(diff / 3600000);
            const m = Math.floor((diff % 3600000) / 60000);
            return `${h}ч ${m}м`;
        },
    };
    Object.assign(Utils, UtilsFormat);
