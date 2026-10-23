function getMobilizationTemplates(districtName, liffUrl) {
  if (typeof districtName !== 'string' || !districtName.trim()) {
    throw new Error('[District SSOT Error] districtName is required and cannot be empty.');
  }
  if (typeof liffUrl !== 'string' || !liffUrl.trim()) {
    throw new Error('[LIFF SSOT Error] liffUrl is required and cannot be empty.');
  }

  const branchLabel = districtName.trim();
  const url = liffUrl.trim();

  return [
    {
      id: 0,
      icon: "📱",
      tabTitle: "① 導入紹介",
      role: "POSTING MAPの導入紹介",
      goalSummary: "このメールでお願いすること: 「まずは地図を開いて眺めてもらう」",
      targetState: "POSTING MAPをまだ利用していない党員向け",
      subject: `【${branchLabel}】ポスティングマップ導入のお知らせ`,
      body: `${branchLabel}の皆さん お疲れさまです

このたび ${branchLabel}では
ポスティング活動をより分かりやすく進めるため
『POSTING MAP』を導入しました

POSTING MAPでは
スマートフォンから配布エリアを確認したり
配布した場所を記録したりすることができます

まずは一度 地図を開いて
お住まいの地域を眺めてみてください

【POSTING MAP】
${url}

※ 新しいアプリのダウンロードや登録は不要です
  LINEからそのまま開いてご利用いただけます`
    },
    {
      id: 1,
      icon: "📦",
      tabTitle: "② チラシ展開",
      role: "最初の100枚を取りに来てもらう",
      goalSummary: "このメールでお願いすること: 「100枚だけ取りに来てもらう」",
      targetState: "アプリ導入前後の党員向け",
      subject: `【${branchLabel}】チラシを用意しています`,
      body: `■ チラシを取りに来ませんか

${branchLabel}の皆さん
いつも活動にご協力いただきありがとうございます

ポスティング用のチラシを用意しています

お時間のあるときに
私のところへチラシを取りに来ませんか？

必要な枚数をお渡しします

チラシを受け取ったら
POSTING MAPに保有しているチラシの枚数を
登録してくださいね

どんどん活動を広げていきましょう

ご都合の良い日をメールでご連絡ください`
    }
  ];
}

function renderMainStageMail(tabIndex = 0) {
  DashboardState.selectedMailTabIndex = tabIndex;
  const container = document.getElementById('main-stage-mail-content');
  if (!container) return;

  const districtName = (DashboardState.summary && DashboardState.summary.districtName)
    || DashboardState.districtCode
    || getResolvedDistrictCode();
  const liffId = (typeof window !== 'undefined' && window.PMS_CLIENT_CONFIG && window.PMS_CLIENT_CONFIG.line && window.PMS_CLIENT_CONFIG.line.liffId);

  if (!districtName || typeof districtName !== 'string' || !districtName.trim()) {
    container.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center p-8 rounded-xl bg-[#131A26] border border-statusRed/50 text-center gap-3">
        <span class="text-3xl">⚠️</span>
        <div class="font-bold text-statusRed text-base">【地区設定エラー】地区名が取得できませんでした</div>
        <p class="text-xs text-textSub">アプリからの初期データ取得に失敗しています。</p>
      </div>
    `;
    DashboardState.currentMailTemplates = [];
    return;
  }

  if (!liffId || typeof liffId !== 'string' || !liffId.trim()) {
    container.innerHTML = `
      <div class="flex-1 flex flex-col items-center justify-center p-8 rounded-xl bg-[#131A26] border border-statusRed/50 text-center gap-3">
        <span class="text-3xl">⚠️</span>
        <div class="font-bold text-statusRed text-base">【LINE LIFF設定エラー】PMS_CLIENT_CONFIG.line.liffId が未設定です</div>
        <p class="text-xs text-textSub">config.js の line.liffId を確認してください。</p>
      </div>
    `;
    DashboardState.currentMailTemplates = [];
    return;
  }

  const liffUrl = `https://liff.line.me/${liffId.trim()}`;

  let templates;
  try {
    templates = getMobilizationTemplates(districtName.trim(), liffUrl);
    DashboardState.currentMailTemplates = templates;
  } catch (err) {
    container.innerHTML = `<div class="p-6 text-center text-statusRed font-bold">${escapeHtml(err.message)}</div>`;
    DashboardState.currentMailTemplates = [];
    return;
  }

  const validIndex = (tabIndex >= 0 && tabIndex < templates.length) ? tabIndex : 0;
  const activeTpl = templates[validIndex];

  const tabsHtml = templates.map((t, idx) => {
    const isActive = idx === validIndex;
    return `
      <button onclick="renderMainStageMail(${idx})" class="px-3.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all duration-150 cursor-pointer ${
        isActive
          ? 'bg-brand/15 text-brand border border-brand/35 shadow-sm font-semibold'
          : 'text-textSub bg-[#0B1019]/60 border border-borderNormal/60 hover:text-white hover:bg-white/5'
      }">
        <span class="text-sm flex-shrink-0">${t.icon}</span>
        <span>${t.tabTitle}</span>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="flex flex-col h-auto lg:h-full gap-2 pr-1 overflow-visible lg:overflow-hidden">
      <!-- タブセレクター (文字幅フィット・コンパクト左寄せ) -->
      <div class="flex items-center gap-2 flex-shrink-0">
        ${tabsHtml}
      </div>

      <!-- メインメール表示カード -->
      <div class="flex-none h-auto lg:flex-1 flex flex-col lg:min-h-0 rounded-xl bg-[#131A26] border border-borderNormal p-3 gap-2 overflow-visible lg:overflow-hidden">

        <!-- 件名ブロック -->
        <div class="flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg bg-[#0B1019] border border-borderNormal flex-shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-[11px] font-bold text-textSub flex-shrink-0">件名:</span>
            <span class="text-xs sm:text-sm font-medium text-white select-all truncate">${escapeHtml(activeTpl.subject)}</span>
          </div>
          <button onclick="copyMailSubject(${validIndex})" class="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#243044]/60 hover:bg-[#33435C] text-white text-xs font-medium border border-borderNormal flex-shrink-0 transition-colors">
            <span>📋</span>
            <span>件名をコピー</span>
          </button>
        </div>

        <!-- 本文ブロック（件名と同じUIヘッダー ＋ 本文領域） -->
        <div class="flex-none h-auto lg:flex-1 lg:min-h-0 relative flex flex-col rounded-lg bg-[#0B1019] border border-borderNormal overflow-hidden">
          <div class="px-3 py-1.5 border-b border-borderNormal/60 bg-[#0B1019] flex items-center justify-between flex-shrink-0">
            <span class="text-[11px] font-bold text-textSub">本文:</span>
            <button onclick="copyMailBody(${validIndex})" class="flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#243044]/60 hover:bg-[#33435C] text-white text-xs font-medium border border-borderNormal flex-shrink-0 transition-colors">
              <span>📋</span>
              <span>本文をコピー</span>
            </button>
          </div>
          <pre id="mail-body-content" class="flex-none h-auto lg:flex-1 lg:min-h-0 p-3 text-xs sm:text-sm text-white/90 font-sans leading-relaxed whitespace-pre-wrap break-words select-all overflow-visible lg:overflow-y-auto lg:overflow-x-auto">${escapeHtml(activeTpl.body)}</pre>
        </div>

      </div>
    </div>
  `;
}

function copyMailSubject(tabIndex) {
  const templates = DashboardState.currentMailTemplates || [];
  const tpl = templates[tabIndex] || templates[0];
  if (!tpl) return;
  copyTextToClipboard(tpl.subject, "✓ 件名をコピーしました");
}

function convertPlainTextToRichHtml(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return lines.map(line => {
    if (!line.trim()) return '<div><br></div>';
    const escaped = escapeHtml(line);
    const linked = escaped.replace(urlRegex, (url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
    return `<div>${linked}</div>`;
  }).join('');
}

function copyRichAndPlainText(plainText, htmlText, successMsg) {
  let copied = false;
  const listener = (e) => {
    e.clipboardData.setData('text/plain', plainText);
    e.clipboardData.setData('text/html', htmlText);
    e.preventDefault();
    copied = true;
  };

  try {
    document.addEventListener('copy', listener);
    document.execCommand('copy');
  } catch (err) {
    console.warn('execCommand copy failed:', err);
  } finally {
    document.removeEventListener('copy', listener);
  }

  if (copied) {
    showMailToast(successMsg);
    return;
  }

  if (navigator.clipboard && window.ClipboardItem && navigator.clipboard.write) {
    try {
      const plainBlob = new Blob([plainText], { type: 'text/plain' });
      const htmlBlob = new Blob([htmlText], { type: 'text/html' });
      const item = new ClipboardItem({
        'text/plain': plainBlob,
        'text/html': htmlBlob
      });
      navigator.clipboard.write([item]).then(() => {
        showMailToast(successMsg);
      }).catch(() => {
        copyTextToClipboard(plainText, successMsg);
      });
    } catch (e) {
      copyTextToClipboard(plainText, successMsg);
    }
  } else {
    copyTextToClipboard(plainText, successMsg);
  }
}

function copyMailBody(tabIndex) {
  const templates = DashboardState.currentMailTemplates || [];
  const tpl = templates[tabIndex] || templates[0];
  if (!tpl) return;
  const richHtml = convertPlainTextToRichHtml(tpl.body);
  copyRichAndPlainText(tpl.body, richHtml, "✓ 本文をコピーしました");
}

let mailToastTimer = null;
function copyTextToClipboard(text, successMsg) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showMailToast(successMsg);
    }).catch(() => {
      fallbackCopyText(text);
      showMailToast(successMsg);
    });
  } else {
    fallbackCopyText(text);
    showMailToast(successMsg);
  }
}

function fallbackCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.style.position = "fixed";
  textArea.style.left = "-999999px";
  textArea.style.top = "-999999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  try {
    document.execCommand('copy');
  } catch (err) {}
  document.body.removeChild(textArea);
}

function showMailToast(msg) {
  const toastEl = document.getElementById('mail-copy-toast');
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.classList.remove('opacity-0', 'pointer-events-none', '-translate-y-2');
  toastEl.classList.add('opacity-100', 'translate-y-0');

  if (mailToastTimer) clearTimeout(mailToastTimer);
  mailToastTimer = setTimeout(() => {
    toastEl.classList.remove('opacity-100', 'translate-y-0');
    toastEl.classList.add('opacity-0', 'pointer-events-none', '-translate-y-2');
  }, 1800);
}
