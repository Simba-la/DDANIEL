// ==UserScript==
// @name         GROWL
// @namespace    http://tampermonkey.net/
// @version      2025-04-26
// @description  SDSD
// @author       You
// @match        https://m.bilibili.com/video/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    console.log("📱 脚本启动，当前页面：", location.href);

    const allowedBVids = ['BV1gew7ehEyR', 'BV1FoFNegEVE', 'BV1bRFPeQES7', 'BV1Fuf6YKEsn', 'BV1pHfzYMExy', 'BV1o3Z8YFE5T', 'BV1nmczeMEEK', 'BV1g8caeqEdP'];
    const bvidMatch = location.pathname.match(/\/video\/(BV\w+)/);
    const currentBVID = bvidMatch ? bvidMatch[1] : null;
    if (!currentBVID || !allowedBVids.includes(currentBVID)) return;

    let commentIntervalId = null;
    let danmakuIntervalId = null;
    let aid = null;
    let csrf = null;
    let commentTexts = [];
    let danmakuTexts = [];
    let lastActionTime = 0;
    const minInterval = 20000;

    let errorCount = 0;
    let recoveryTimerId = null;
    let recoveryCountdown = 0;
    let recoveryPanel = null;

    waitForAidAndCsrf();
    createUI();
    waitForPlayerReady();

    function waitForAidAndCsrf() {
        const check = () => {
            const state = window.__INITIAL_STATE__;
            aid = state?.aid;
            csrf = getCookie("bili_jct");
            if (!aid || !csrf) setTimeout(check, 1000);
        };
        check();
    }

    function getCookie(name) {
        const match = document.cookie.match(new RegExp("(^| )" + name + "=([^;]+)"));
        return match ? match[2] : null;
    }

    function getRandomLine(lines) {
        return lines.map(l => l.trim()).filter(Boolean)[Math.floor(Math.random() * lines.length)];
    }

    function delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function safeRun(taskFn) {
        const now = Date.now();
        const since = now - lastActionTime;
        if (since < minInterval) await delay(minInterval - since);
        lastActionTime = Date.now();
        try {
            await taskFn();
            errorCount = 0;
            if (recoveryPanel) recoveryPanel.style.display = 'none';
        } catch (err) {
            errorCount++;
            console.error(`🚫 出错第${errorCount}次：`, err);
            stopCommentLoop();
            stopDanmakuLoop();

            let pauseMinutes = 5;
            if (errorCount >= 5) pauseMinutes = 20;
            else if (errorCount >= 3) pauseMinutes = 10;

            recoveryCountdown = pauseMinutes * 60;
            showRecoveryPanel();

            recoveryTimerId = setInterval(() => {
                recoveryCountdown--;
                if (recoveryCountdown <= 0) {
                    clearInterval(recoveryTimerId);
                    recoveryTimerId = null;
                    recoveryPanel.style.display = 'none';
                    startCommentLoop();
                    startDanmakuLoop();
                } else {
                    updateRecoveryPanel();
                }
            }, 1000);
        }
    }

    function createUI() {
        const panel = document.createElement('div');
        panel.innerHTML = `
            <div style="font-weight:bold;">⚙️ 自动助手</div>
            <textarea id="comment-texts" placeholder="评论内容(换行分隔)" rows="4" style="width:90%; margin-top:5px;"></textarea>
            <textarea id="danmaku-texts" placeholder="弹幕内容(换行分隔)" rows="4" style="width:90%; margin-top:5px;"></textarea>
            <button id="start-comment" style="margin-top:6px;">▶️ 评论</button>
            <button id="start-danmaku" style="margin-top:6px;">▶️ 弹幕</button>
            <div id="status" style="margin-top:5px; color:gray;">未启动</div>
        `;
        Object.assign(panel.style, {
            position: 'fixed',
            bottom: '10px',
            right: '10px',
            width: '200px',
            background: 'white',
            border: '1px solid #ccc',
            borderRadius: '10px',
            padding: '10px',
            zIndex: '99999',
            fontSize: '12px',
            boxShadow: '0 0 5px rgba(0,0,0,0.2)'
        });
        document.body.appendChild(panel);

        document.getElementById('start-comment').onclick = toggleComment;
        document.getElementById('start-danmaku').onclick = toggleDanmaku;
    }

    function showRecoveryPanel() {
        if (!recoveryPanel) {
            recoveryPanel = document.createElement('div');
            recoveryPanel.innerHTML = `
                <div>⏳ 错误恢复中...</div>
                <div id="recovery-timer">0秒</div>
                <button id="force-recover">⏩ 手动恢复</button>
            `;
            Object.assign(recoveryPanel.style, {
                position: 'fixed',
                bottom: '220px',
                right: '10px',
                width: '200px',
                background: '#ffeeee',
                border: '1px solid red',
                borderRadius: '10px',
                padding: '10px',
                zIndex: '99999',
                fontSize: '12px',
                textAlign: 'center'
            });
            document.body.appendChild(recoveryPanel);

            document.getElementById('force-recover').onclick = () => {
                clearInterval(recoveryTimerId);
                recoveryPanel.style.display = 'none';
                errorCount = 0;
                startCommentLoop();
                startDanmakuLoop();
            };
        }
        updateRecoveryPanel();
        recoveryPanel.style.display = 'block';
    }

    function updateRecoveryPanel() {
        if (recoveryPanel) {
            document.getElementById('recovery-timer').innerText = `${recoveryCountdown}秒`;
        }
    }

    function toggleComment() {
        commentTexts = document.getElementById('comment-texts').value.split('\n').filter(Boolean);
        if (!commentIntervalId) {
            startCommentLoop();
            document.getElementById('status').innerText = '✅ 评论中';
        } else {
            stopCommentLoop();
            document.getElementById('status').innerText = '⏸️ 评论停止';
        }
    }

    function toggleDanmaku() {
        danmakuTexts = document.getElementById('danmaku-texts').value.split('\n').filter(Boolean);
        if (!danmakuIntervalId) {
            startDanmakuLoop();
            document.getElementById('status').innerText = '✅ 弹幕中';
        } else {
            stopDanmakuLoop();
            document.getElementById('status').innerText = '⏸️ 弹幕停止';
        }
    }

    function startCommentLoop() {
        if (!aid || !csrf) return;
        async function cycle() {
            const text = getRandomLine(commentTexts);
            await safeRun(() => sendRootComment(text));
            commentIntervalId = setTimeout(cycle, getRandomInt(30, 60) * 1000);
        }
        cycle();
    }

    function stopCommentLoop() {
        clearTimeout(commentIntervalId);
        commentIntervalId = null;
    }

    async function sendRootComment(text) {
        const body = `oid=${aid}&type=1&message=${encodeURIComponent(text)}&csrf=${csrf}`;
        const res = await fetch("https://api.bilibili.com/x/v2/reply/add", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body
        });
        const data = await res.json();
        if (data.code !== 0) throw new Error(data.message);
    }

    function startDanmakuLoop() {
        async function cycle() {
            const input = document.querySelector('textarea[placeholder="发个友善的弹幕见证当下"]');
            const btn = document.querySelector('button.bpx-player-dm-send-btn');
            if (input && btn) {
                const text = getRandomLine(danmakuTexts);
                await safeRun(() => {
                    input.value = text;
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    btn.click();
                    console.log("✅ 发送弹幕:", text);
                });
            }
            danmakuIntervalId = setTimeout(cycle, getRandomInt(15, 30) * 1000);
        }
        cycle();
    }

    function stopDanmakuLoop() {
        clearTimeout(danmakuIntervalId);
        danmakuIntervalId = null;
    }

    function waitForPlayerReady() {
        if (!document.querySelector('textarea[placeholder="发个友善的弹幕见证当下"]')) {
            setTimeout(waitForPlayerReady, 1000);
        }
    }

    function getRandomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }
})();
