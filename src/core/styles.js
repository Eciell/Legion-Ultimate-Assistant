    // ============================================================
    // 3. СТИЛИ
    // ============================================================
    const STYLES = `
        .${DOM_IDS.customModal}, .custom-modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(20, 16, 26, 0.98); border: 2px solid #caa55c; border-radius: 12px; padding: 20px; z-index: 10000; color: #f7eadf; width: 1200px; max-width: 98vw; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 10px 40px rgba(0,0,0,0.85); font-family: 'Nunito', sans-serif; backdrop-filter: blur(4px); }
        .${DOM_IDS.customModal}.modal-compact, .custom-modal.modal-compact { width: 450px; max-width: 95vw; max-height: 65vh; padding: 16px; }
        .${DOM_IDS.customModal} h2, .custom-modal h2 { margin-top: 0; color: #ffcf6a; border-bottom: 1px solid #555; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; cursor: grab; user-select: none; }
        .${DOM_IDS.customModal} h2:active, .custom-modal h2:active { cursor: grabbing; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar, .custom-modal ::-webkit-scrollbar { width: 6px; height: 6px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-track, .custom-modal ::-webkit-scrollbar-track { background: rgba(0,0,0,0.2); border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb, .custom-modal ::-webkit-scrollbar-thumb { background: #44374a; border-radius: 4px; }
        .${DOM_IDS.customModal} ::-webkit-scrollbar-thumb:hover, .custom-modal ::-webkit-scrollbar-thumb:hover { background: #caa55c; }
        .custom-close { background: none; border: none; color: #ff8fa3; font-size: 24px; cursor: pointer; transition: color 0.2s; user-select: none; }
        .custom-close:hover { color: #fff; }
        .modal-tabs { display: flex; gap: 10px; margin-bottom: 15px; border-bottom: 1px solid #444; padding-bottom: 10px; flex-wrap: wrap; }
        .modal-tab { background: #2a2030; border: 1px solid #555; color: #ccc; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: bold; transition: all 0.2s; }
        .modal-tab:hover { background: #3a2c40; color: #fff; }
        .modal-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .tab-content { display: none; flex: 1; overflow: hidden; position: relative; }
        .tab-content.active { display: flex; gap: 20px; }
        .sim-tree-wrap { flex: 1; background: #223029; border: 10px solid #6b4423; border-radius: 12px; box-shadow: inset 0 0 20px rgba(0,0,0,0.8); position: relative; overflow: auto; display: flex; flex-direction: column; }
        .sim-tree-inner { min-width: 700px; padding: 20px; display: flex; flex-direction: column; height: 840px; }
        .sim-top-bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; background: rgba(0,0,0,0.4); padding: 10px 15px; border-radius: 8px; border: 2px solid #caa55c; position: relative; z-index: 10; }
        .sim-free-pts { font-size: 18px; font-weight: bold; color: #ffcf6a; }
        .sim-branches { position: relative; height: 760px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; }
        .sim-branch { position: relative; background: rgba(255,255,255,0.03); border-radius: 8px; height: 100%; }
        .sim-branch-header { text-align: center; font-weight: bold; color: #ffcf6a; font-size: 14px; position: absolute; top: 0; width: 100%; pointer-events: none; }
        .sim-branch-pts { font-size: 11px; color: #aaa; margin-top: 2px; }
        .sim-node { position: absolute; z-index: 2; display: flex; flex-direction: column; align-items: center; width: 90px; cursor: pointer; transform: translate(-50%, -50%); }
        .sim-node-icon { width: 44px; height: 44px; border-radius: 50%; background: #2a2030; border: 3px solid #555; display: flex; align-items: center; justify-content: center; font-size: 20px; transition: all 0.2s; box-shadow: 0 4px 6px rgba(0,0,0,0.5); }
        .sim-node.available .sim-node-icon { border-color: #ffcf6a; box-shadow: 0 0 10px rgba(255, 207, 106, 0.5); cursor: pointer; }
        .sim-node.available:hover .sim-node-icon { transform: scale(1.15); }
        .sim-node.maxed .sim-node-icon { background: #caa55c; border-color: #ffcf6a; color: #111; }
        .sim-node.locked { opacity: 0.6; cursor: not-allowed; }
        .sim-node.locked .sim-node-icon { border-style: dashed; background: #111; }
        .sim-node-ranks { display: flex; gap: 2px; margin-top: 4px; background: rgba(0,0,0,0.7); padding: 2px 4px; border-radius: 6px; }
        .sim-node-ranks i { width: 6px; height: 6px; border-radius: 50%; background: #333; border: 1px solid #555; }
        .sim-node-ranks i.filled { background: #ffcf6a; border-color: #ffcf6a; }
        .sim-node-name { font-size: 10px; text-align: center; margin-top: 2px; font-weight: bold; background: rgba(0,0,0,0.8); padding: 2px 4px; border-radius: 4px; line-height: 1.1; position: relative; z-index: 3; white-space: normal; }
        .sim-card { position: fixed; background: #f5e9c8; color: #2a2010; border: 3px solid #2b1d18; border-radius: 12px; padding: 15px; width: 280px; z-index: 10001; box-shadow: 0 10px 25px rgba(0,0,0,0.6); display: none; }
        .sim-card h4 { margin: 0 0 5px 0; font-size: 16px; color: #2b1d18; display: flex; justify-content: space-between; }
        .sim-card .desc { font-size: 13px; margin-bottom: 10px; line-height: 1.3; }
        .sim-card .req { font-size: 12px; color: #c2405a; font-weight: bold; margin-bottom: 10px; }
        .sim-card .controls { display: flex; justify-content: space-between; align-items: center; margin-top: 10px; }
        .sim-card button { background: #caa55c; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; color: #2b1d18; font-size: 13px; }
        .sim-card button:disabled { opacity: 0.5; cursor: not-allowed; }
        .sim-card-close { position: absolute; top: 8px; right: 8px; cursor: pointer; font-size: 16px; color: #888; }
        .sim-reset-btn { background: #caa55c; color: #2b1d18; border: 2px solid #2b1d18; padding: 6px 12px; border-radius: 6px; font-weight: bold; cursor: pointer; }
        .sim-reset-btn:hover { background: #ffcf6a; }
        .build-right { width: 250px; flex-shrink: 0; background: #111; padding: 15px; border-radius: 8px; border: 1px solid #333; height: fit-content; }
        .stats-panel h3 { margin-top: 0; color: #ffcf6a; font-size: 16px; border-bottom: 1px solid #444; padding-bottom: 5px; }
        .stat-line { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 13px; }
        .stat-line span { color: #aaa; }
        .stat-line b { color: #4cc95a; }
        .search-bar { width: 100%; padding: 10px; margin-bottom: 15px; background: #111; border: 1px solid #555; color: #fff; border-radius: 6px; font-size: 14px; outline: none; box-sizing: border-box; }
        .table-container { overflow-y: auto; flex: 1; border: 1px solid #333; border-radius: 6px; }
        .${DOM_IDS.customModal} table, .custom-modal table { width: 100%; border-collapse: collapse; font-size: 14px; }
        .${DOM_IDS.customModal} th, .${DOM_IDS.customModal} td, .custom-modal th, .custom-modal td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #333; }
        .${DOM_IDS.customModal} th, .custom-modal th { background: #2a2030; color: #ffcf6a; position: sticky; top: 0; cursor: pointer; user-select: none; z-index: 2; }
        .${DOM_IDS.customModal} th::after, .custom-modal th::after { content: ' ↕'; font-size: 10px; opacity: 0.5; }
        .${DOM_IDS.customModal} th.sort-asc::after, .custom-modal th.sort-asc::after { content: ' ↑'; opacity: 1; }
        .${DOM_IDS.customModal} th.sort-desc::after, .custom-modal th.sort-desc::after { content: ' ↓'; opacity: 1; }
        .stat-up { color: #4cc95a; font-weight: bold; }
        .stat-down { color: #ff5a7a; font-weight: bold; }
        .stat-eq { color: #888; }
        .deal-great { color: #4cc95a; font-weight: bold; text-shadow: 0 0 5px rgba(76, 201, 90, 0.5); }
        .deal-good { color: #8bc34a; font-weight: bold; }
        .deal-bad { color: #ff5a7a; }
        .loader { display: flex; justify-content: center; align-items: center; height: 100px; font-size: 16px; color: #caa55c; font-weight: bold; }
        .${DOM_IDS.fabWrap}, .legion-fab-wrap { position: fixed; bottom: 20px; right: 20px; z-index: 10000; touch-action: none; user-select: none; }
        .${DOM_IDS.fabBtn}, .legion-fab-btn { width: 52px; height: 52px; border-radius: 50%; background: #1d1620; border: 2px solid #caa55c; color: #ffcf6a; font-size: 26px; display: flex; justify-content: center; align-items: center; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,0.75); transition: transform 0.2s, background 0.2s; position: relative; }
        .${DOM_IDS.fabBtn}:hover, .legion-fab-btn:hover { background: #2a2030; transform: scale(1.08); }
        .${DOM_IDS.fabBtn}:active, .legion-fab-btn:active { transform: scale(0.95); }
        .${DOM_IDS.fabMenu}, .legion-fab-menu { position: absolute; bottom: 62px; right: 0; min-width: 220px; background: rgba(29, 22, 32, 0.96); border: 2px solid #caa55c; border-radius: 10px; padding: 8px; display: none; flex-direction: column; gap: 6px; box-shadow: 0 10px 30px rgba(0,0,0,0.85); backdrop-filter: blur(8px); }
        .${DOM_IDS.fabMenu}.open, .legion-fab-menu.open { display: flex; animation: fabFadeIn 0.2s ease; }
        @keyframes fabFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .fab-menu-item { position: relative; background: #2a2030; color: #ffcf6a; border: 1px solid #555; border-radius: 6px; padding: 10px 14px; font-weight: bold; cursor: pointer; font-size: 13px; text-align: left; transition: all 0.2s; display: flex; justify-content: space-between; align-items: center; }
        .fab-menu-item:hover { background: #caa55c; color: #1d1620; border-color: #caa55c; }
        .fab-menu-item.active { background: #4cc95a; color: #1d1620; border-color: #4cc95a; box-shadow: 0 0 15px rgba(76, 201, 90, 0.5); }
        .${DOM_IDS.chatBadge}, .chat-badge { position: absolute; top: -6px; right: -6px; background: #ff5a7a; color: #fff; border-radius: 50%; padding: 2px 7px; font-size: 12px; font-weight: 900; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: none; pointer-events: none; z-index: 2; }
        .${DOM_IDS.chatWidget}, .chat-widget { position: fixed; bottom: 80px; right: 20px; width: 320px; height: 400px; background: #1d1620; border: 2px solid #caa55c; border-radius: 12px; display: flex; flex-direction: column; z-index: 10000; box-shadow: 0 10px 30px rgba(0,0,0,0.8); overflow: hidden; transition: transform 0.2s, opacity 0.2s; transform: translateY(20px); opacity: 0; pointer-events: none; }
        .${DOM_IDS.chatWidget}.open, .chat-widget.open { transform: translateY(0); opacity: 1; pointer-events: auto; }
        .chat-top-bar, .chat-header { background: #2a2030; padding: 10px 12px; font-weight: bold; color: #ffcf6a; display: flex; justify-content: space-between; align-items: center; gap: 8px; overflow: hidden; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; box-sizing: border-box; }
        .chat-main-tabs, .chat-tabs { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; min-width: 0; }
        .chat-main-tab, .chat-tab { background: #1d1620; border: 1px solid #444; color: #aaa; padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; white-space: nowrap; font-weight: bold; user-select: none; pointer-events: auto; }
        .chat-main-tab.active, .chat-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-sub-tabs { display: flex; gap: 6px; padding: 6px 12px; background: #231929; border-bottom: 1px solid #3a2b42; }
        .chat-sub-tab { background: #1d1620; border: 1px solid #444; color: #bbb; padding: 3px 8px; border-radius: 4px; cursor: pointer; font-size: 11px; white-space: nowrap; user-select: none; pointer-events: auto; }
        .chat-sub-tab.active { background: #caa55c; color: #1d1620; border-color: #caa55c; font-weight: bold; }
        .chat-role-icon { margin-right: 4px; }
        .chat-envelope { display: none; }
        .chat-close { cursor: pointer; color: #ff8fa3; padding: 4px 6px; flex-shrink: 0; font-size: 16px; line-height: 1; user-select: none; pointer-events: auto; }
        .chat-close:hover { color: #fff; }
        .chat-messages { flex: 1; padding: 10px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: #f7eadf !important; }
        .chat-msg { background: rgba(255,255,255,0.05); padding: 6px 10px; border-radius: 8px; line-height: 1.3; word-wrap: break-word; color: #f7eadf !important; }
        .chat-msg.pending { opacity: 0.6; font-style: italic; }
        .chat-msg.streamer-msg { border-left: 3px solid #ffd700; background: rgba(255, 215, 0, 0.08); }
        .chat-msg.mention-msg { border-left: 3px solid #f7768e; background: rgba(247, 118, 142, 0.12); }
        .chat-text { color: #f7eadf !important; word-break: break-word; }
        .chat-author { font-weight: bold; color: #f7eadf !important; margin-right: 5px; }
        .chat-input-area { display: flex; padding: 10px; background: #111; border-top: 1px solid #333; gap: 5px; }
        .chat-input { flex: 1; background: #222; border: 1px solid #444; color: #fff; padding: 8px 12px; border-radius: 6px; font-size: 13px; outline: none; }
        .chat-input:focus { border-color: #caa55c; }
        .chat-send { background: #caa55c; color: #1d1620; border: none; padding: 0 15px; border-radius: 6px; font-weight: bold; cursor: pointer; user-select: none; pointer-events: auto; }
        .chat-send:hover { background: #ffcf6a; }
        .chat-widget button { user-select: none; pointer-events: auto; }
        .${DOM_IDS.hudLog}, .hud-log { position: fixed; bottom: 20px; left: 20px; width: 480px; max-height: 300px; background: rgba(29, 22, 32, 0.95); border: 2px solid #caa55c; border-radius: 8px; padding: 10px; z-index: 9999; overflow-y: auto; font-family: monospace; font-size: 12px; color: #f7eadf; box-shadow: 0 4px 10px rgba(0,0,0,0.5); display: none; }
        .${DOM_IDS.hudLog}.active, .hud-log.active { display: block; }
        .hud-log-header { font-weight: bold; color: #ffcf6a; margin-bottom: 8px; border-bottom: 1px solid #555; padding-bottom: 4px; display: flex; justify-content: space-between; align-items: center; cursor: move; user-select: none; touch-action: none; }
        .hud-log-close { cursor: pointer; color: #ff8fa3; padding: 5px; }
        .hud-log-close:hover { color: #fff; }
        .hud-line { margin-bottom: 4px; line-height: 1.3; word-wrap: break-word; }
        .hud-line.info { color: #8fd3ff; }
        .hud-line.success { color: #4cc95a; }
        .hud-line.warn { color: #ff9800; }
        .hud-line.action { color: #ffcf6a; font-weight: bold; }
        .hud-line.error { color: #ff5a7a; }
        .auc-buy-btn { padding: 4px 8px; background: #28a745; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; transition: background 0.2s, opacity 0.2s; }
        .auc-buy-btn:hover { background: #218838; }
        .auc-buy-btn:disabled { opacity: 0.6; cursor: not-allowed; }

        /* Фиксы котов в шахте (баг игры) */
        .mn-fig.has-d:not(:has(> svg:not(.mna-dfig))) > svg.mna-dfig { display: block !important; }
        .mn-h .mna-dfig { overflow: visible !important; }

        /* UI-декоратор аукциона: иконки монет */
        .b-coin-wrap {
            display: inline-flex;
            align-items: center;
            gap: 3px;
            white-space: nowrap;
            vertical-align: middle;
        }
        .b-coin-ico {
            width: 11px;
            height: 11px;
            border-radius: 50%;
            border: 1.5px solid rgba(0, 0, 0, 0.45);
            display: inline-block;
            vertical-align: middle;
            margin-left: 2px;
            margin-right: 1px;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-coin-ico.g {
            background: radial-gradient(circle at 35% 35%, #fff176, #f2c94c);
            box-shadow: 0 0 2px rgba(242, 201, 76, 0.45);
        }
        .b-coin-ico.s {
            background: radial-gradient(circle at 35% 35%, #ffffff, #d7dde2);
            box-shadow: 0 0 2px rgba(215, 221, 226, 0.45);
        }
        .b-coin-ico.b {
            background: radial-gradient(circle at 35% 35%, #e0965a, #c47a3a);
            box-shadow: 0 0 2px rgba(196, 122, 58, 0.45);
        }

        /* UI-декоратор аукциона: арт предмета */
        .b-lot-art {
            width: 40px;
            height: 40px;
            min-width: 40px;
            border-radius: 8px;
            background: rgba(0, 0, 0, 0.35);
            border: 1px solid rgba(255, 255, 255, 0.15);
            display: flex;
            align-items: center;
            justify-content: center;
            position: relative;
            overflow: hidden;
            flex-shrink: 0;
            box-sizing: border-box;
        }
        .b-lot-art svg {
            width: 34px;
            height: 34px;
            max-width: 36px;
            max-height: 36px;
            display: block;
            overflow: visible;
        }
        .b-lot-art img {
            width: 32px;
            height: 32px;
            max-width: 32px;
            max-height: 32px;
            object-fit: contain;
            display: block;
        }
        #auction-body .b-lot-art {
            display: inline-flex;
            vertical-align: middle;
            margin-right: 5px;
            width: 32px;
            height: 32px;
            min-width: 32px;
        }
        #auction-body .b-lot-art img,
        #auction-body .b-lot-art svg {
            width: 26px;
            height: 26px;
        }
        #dossier-lots-container .b-lot-art {
            width: 30px;
            height: 30px;
            min-width: 30px;
        }
        #dossier-lots-container .b-lot-art img,
        #dossier-lots-container .b-lot-art svg {
            width: 24px;
            height: 24px;
        }
        #${DOM_IDS.playerHud}, #legion-player-hud { position: fixed; top: 100px; right: 20px; width: 220px; background: #1d1620; border: 2px solid #caa55c; border-radius: 10px; z-index: 10001; box-shadow: 0 8px 24px rgba(0,0,0,0.85); display: flex; flex-direction: column; overflow: hidden; font-family: 'Nunito', sans-serif; }
        .player-hud-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: #2a2030; border-bottom: 1px solid #444; cursor: move; user-select: none; touch-action: none; }
        .player-hud-close { background: none; border: none; color: #ff8fa3; font-size: 14px; cursor: pointer; padding: 0 2px; line-height: 1; }
        .player-hud-close:hover { color: #fff; }
        .player-hud-body { padding: 8px 10px; display: flex; flex-direction: column; gap: 5px; font-size: 12px; }
        .player-hud-row { display: flex; justify-content: space-between; align-items: center; }
        .player-hud-label { color: #aaa; }
        .player-hud-val { font-weight: bold; }
        /* ── Ассистент Жреца: плавающий HUD боя (Поход) ── */
        .priest-hud { position: fixed; top: 80px; right: 20px; background: #1e1724; border: 1px solid #caa55c; border-radius: 8px; padding: 10px; display: none; flex-direction: column; z-index: 10001; box-shadow: 0 4px 15px rgba(0,0,0,0.7); min-width: 150px; max-width: 240px; font-family: 'Nunito', sans-serif; color: #f7eadf; }
        .priest-hud-title { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: bold; color: #caa55c; font-size: 12px; margin-bottom: 8px; cursor: grab; user-select: none; touch-action: none; }
        .priest-hud-title:active { cursor: grabbing; }
        .priest-hud-settings { background: none; border: none; color: #caa55c; font-size: 13px; line-height: 1; cursor: pointer; padding: 0 2px; }
        .priest-hud-settings:hover { color: #ffcf6a; }
        .priest-hud-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; background: rgba(0,0,0,0.3); padding: 4px; border-radius: 4px; }
        .priest-hud-nick { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .priest-heal-btn { background: #28a745; color: #fff; border: none; border-radius: 3px; padding: 2px 6px; font-size: 11px; cursor: pointer; flex-shrink: 0; }
        .priest-heal-btn:hover:not(:disabled) { background: #34c759; }
        .priest-heal-btn:disabled { background: #555; color: #fff; cursor: not-allowed; opacity: 0.7; }
    `;
