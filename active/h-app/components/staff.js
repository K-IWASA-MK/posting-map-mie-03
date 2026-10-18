// POSTING MAP Component: staff.js (Stateless, API-free rendering)
window.renderStaffCard = function(userInfo, options = {}) {
  if (!userInfo) return '';

  const avatarHtml = userInfo.picture ? `
    <div class="w-24 h-24 rounded-full overflow-hidden border-2 border-white/20 shadow-2xl mb-4 relative z-10">
      <img src="${userInfo.picture}" class="w-full h-full object-cover">
    </div>
  ` : `
    <div class="w-24 h-24 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mb-4 relative z-10">
      <span class="text-3xl text-white/40">👤</span>
    </div>
  `;

  const formattedId = userInfo.id ? userInfo.id.replace(/^[A-Za-z]+/, 'STAFF ID ') : '';
  const displayBranch = options.districtName || options.branchName || '';
  const lastSyncTime = options.lastSyncTime || '--:--';
  const registrationDate = userInfo.registrationDate || '2025/07/01';

  return `
    <div class="pt-2 pb-0 px-4 flex flex-col items-center">
      <div class="mb-6 flex items-center justify-center gap-3">
        <span class="text-xs font-bold text-white/50 tracking-wider">公式配布員</span>
        ${formattedId ? `<span style="letter-spacing: 0.15em; text-indent: 0.15em; background: linear-gradient(180deg, rgba(234,95,8,0.16), rgba(234,95,8,0.06)); border: 1px solid #EA5F08; box-shadow: 0 0 6px rgba(234,95,8,.35), 0 0 12px rgba(234,95,8,.18); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);" class="inline-flex items-center justify-center h-6 px-3 text-[10px] font-black text-white font-mono rounded-full">${formattedId}</span>` : ''}
      </div>
      
      <div id="id-gyro-card" style="height: 300px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;" class="w-full max-w-sm gyro-card flex flex-col items-center p-6 relative overflow-hidden">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        
        <!-- 1. 最上部 (🟢AUTHを本当に少しだけ下へ微調整) -->
        <div style="margin-top: 18px;" class="inline-flex items-center gap-2 z-10">
          <span class="w-2 h-2 bg-[#22c55e] rounded-full shadow-[0_0_8px_#22c55e]"></span>
          <span class="text-[8px] font-black text-[#22c55e] uppercase tracking-[0.3em]">Authorized Staff</span>
        </div>
        
        <!-- 2. 中央アバターと名前 (絶対配置で縦横完全センター化、元のサイズをキープ) -->
        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);" class="flex flex-col items-center z-10 w-full max-w-[280px]">
          ${avatarHtml}
          <div style="font-size: 28px; font-weight: 900; color: #ffffff; text-align: center; letter-spacing: 0.05em; line-height: 1.1;" class="flex flex-col items-center w-full">
            <div class="truncate w-full">${escapeHtml(userInfo.last)}</div>
            <div class="text-xs text-white/40 font-medium mt-1 truncate w-full">${escapeHtml(userInfo.first || '')}</div>
          </div>
        </div>
        
        <!-- 3. 最下部 (底面から12px固定、上の2行をさらに1行分上にシフトしてバランス調整) -->
        <div style="position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); width: 100%;" class="flex flex-col items-center gap-0.5 z-10">
          ${displayBranch ? `<p class="text-[8px] font-black text-white/40 uppercase tracking-[0.3em]">${displayBranch}</p>` : ''}
          <p class="text-[8px] font-black text-white/40 uppercase tracking-[0.3em]">Field Operations</p>
          <p style="margin-top: 12px;" class="text-[8px] font-black text-white/40 uppercase tracking-[0.3em] select-none">
            <span class="cursor-pointer hover:text-white transition-colors" onclick="openIdInfoModal('terms', event)">Terms</span>
            &nbsp;&nbsp;
            <span class="cursor-pointer hover:text-white transition-colors" onclick="openIdInfoModal('privacy', event)">Privacy</span>
            &nbsp;&nbsp;
            <span class="cursor-pointer hover:text-white transition-colors" onclick="openIdInfoModal('license', event)">License</span>
          </p>
        </div>
      </div>

      <!-- 第2カード: メッセージカード -->
      <div class="w-full max-w-sm gyro-card flex flex-col items-center justify-center py-10 px-6 relative overflow-hidden text-center select-none" style="margin-top: 18px; min-height: 240px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        <div class="id-ambient-sheen pointer-events-none"></div>
        <p class="id-message-card-text font-medium text-white/80 z-10 text-left w-full">
          <br>
          ポスティングを自由に楽しもう<br>
          空いてる時間に近い場所から<br><br>

          マップを見ながら街を歩いて<br>
          自分のペースで自分らしく<br>
          気軽に参加しましょう<br><br>

          ポスティングが終わったら<br>
          配った枚数を入力してね！<br><br>

          ランキングもあります<br>
          ぜひチェックしてみてね！<br>
          <br>
        </p>
      </div>

      <!-- 第3カード: 説明書（枚数登録） -->
      <div class="w-full max-w-sm gyro-card id-guide-card flex flex-col items-center justify-center py-8 px-6 relative overflow-hidden text-center select-none" style="margin-top: 18px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        <div class="id-ambient-sheen pointer-events-none"></div>
        <div class="id-guide-badge z-10">
          <span class="id-guide-badge-icon">📦</span>
          <span class="id-guide-badge-label">枚数登録</span>
        </div>
        <div class="id-guide-anim-stage z-10" aria-hidden="true">
          <div class="guide-stock-scene">
            <div class="guide-stock-box">📦</div>
            <div class="guide-stock-arrow">➔</div>
            <div class="guide-stock-pill">
              <span class="guide-stock-pill-num">6,000</span>
              <span class="guide-stock-pill-unit">枚</span>
            </div>
          </div>
        </div>
        <p class="id-guide-card-copy z-10">
          今あるチラシの枚数を登録<br>
          変わったらすぐ更新しよう！
        </p>
      </div>

      <!-- 第4カード: 説明書（在庫確認） -->
      <div class="w-full max-w-sm gyro-card id-guide-card flex flex-col items-center justify-center py-8 px-6 relative overflow-hidden text-center select-none" style="margin-top: 18px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        <div class="id-ambient-sheen pointer-events-none"></div>
        <div class="id-guide-badge z-10">
          <span class="id-guide-badge-icon">📊</span>
          <span class="id-guide-badge-label">在庫確認</span>
        </div>
        <div class="id-guide-anim-stage z-10" aria-hidden="true">
          <div class="guide-transfer-scene">
            <div class="guide-transfer-node guide-node-1">📊</div>
            <div class="guide-transfer-track">
              <span class="guide-transfer-dot"></span>
            </div>
            <div class="guide-transfer-node guide-node-2">🤝</div>
            <div class="guide-transfer-track">
              <span class="guide-transfer-dot guide-dot-delay"></span>
            </div>
            <div class="guide-transfer-node guide-node-3">📱</div>
          </div>
        </div>
        <p class="id-guide-card-copy z-10">
          近くの保管者を探して<br>
          LINEで受渡要請を送ろう！
        </p>
      </div>

      <!-- 第5カード: 説明書（地図） -->
      <div class="w-full max-w-sm gyro-card id-guide-card flex flex-col items-center justify-center py-8 px-6 relative overflow-hidden text-center select-none" style="margin-top: 18px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        <div class="id-ambient-sheen pointer-events-none"></div>
        <div class="id-guide-badge z-10">
          <span class="id-guide-badge-icon">🗺️</span>
          <span class="id-guide-badge-label">地図</span>
        </div>
        <div class="id-guide-anim-stage z-10" aria-hidden="true">
          <div class="guide-map-scene">
            <div class="guide-pin-step guide-pin-green">
              <span class="guide-pin-dot"></span>
              <span class="guide-pin-text">未配布</span>
            </div>
            <span class="guide-pin-arrow">➔</span>
            <div class="guide-pin-step guide-pin-blue">
              <span class="guide-pin-dot"></span>
              <span class="guide-pin-text">配布中</span>
            </div>
            <span class="guide-pin-arrow">➔</span>
            <div class="guide-pin-step guide-pin-orange">
              <span class="guide-pin-dot"></span>
              <span class="guide-pin-text">完了</span>
            </div>
          </div>
        </div>
        <p class="id-guide-card-copy z-10">
          緑のピンから配布スタート！<br>
          提出するとオレンジに変化
        </p>
      </div>

      <!-- 第6カード: 説明書（掲示板） -->
      <div class="w-full max-w-sm gyro-card id-guide-card flex flex-col items-center justify-center py-8 px-6 relative overflow-hidden text-center select-none" style="margin-top: 18px; --glow-x: 0px; --glow-y: 0px; --glow-opacity: 0.08; --edge-opacity: 0.08; --edge-angle: 180deg;">
        <div class="absolute inset-0 bg-gradient-to-b from-white/5 to-white/0 pointer-events-none rounded-[28px]"></div>
        <div class="id-ambient-sheen pointer-events-none"></div>
        <div class="id-guide-badge z-10">
          <span class="id-guide-badge-icon">💬</span>
          <span class="id-guide-badge-label">掲示板</span>
        </div>
        <div class="id-guide-anim-stage z-10" aria-hidden="true">
          <div class="guide-bulletin-scene">
            <div class="guide-bulletin-bubble">
              <span class="guide-bulletin-icon">💬</span>
              <div class="guide-bulletin-dots">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        </div>
        <p class="id-guide-card-copy z-10">
          地域の状況をみんなで共有！<br>
          投稿者へ個別に連絡もOK
        </p>
      </div>
    </div>
  `;
};

/**
 * POSTING MAP Component: StaffIdInfoView (ID情報モーダル Presentation View - Wave 8)
 * デジタル配布員証に付随する規約・プライバシー・ライセンスモーダルの表示および開閉制御を担当。
 * 外部ストレージへの直接依存は持たず、地区名は上位から受領する。
 */
window.StaffIdInfoView = (() => {
  // 規約・ライセンスデータ (View内部にカプセル化保持)
  const ID_INFO_DATA = {
    terms: {
      title: 'Terms of Service',
      body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p>POSTING MAP は、<br>認証された配布員・管理者向けの<br><span class="text-white font-bold">FIELD OPERATIONS SYSTEM</span> です。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">本システムは：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・配布進捗</div>
            <div>・エリア管理</div>
            <div>・GPSログ</div>
            <div>・活動データ</div>
            <div>・ランキング</div>
          </div>
          <p class="text-white/40">をリアルタイム管理します。</p>
        </div>

        <div class="space-y-1">
          <p class="text-white/70 font-black">本システムの：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・無断複製</div>
            <div>・再配布</div>
            <div>・不正利用</div>
            <div>・地域外利用</div>
          </div>
          <p class="text-white/40">を禁止します。</p>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">各地域ライセンスは、<br>契約支部・契約組織にのみ付与されます。</p>
      </div>
    `
    },
    privacy: {
      title: 'Privacy Policy',
      body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p>POSTING MAP は、<br>FIELD OPERATIONS SYSTEM として、<br>以下の情報を取得・管理します。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">【取得・管理する情報】</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・LINE認証情報</div>
            <div>・配布員ID</div>
            <div>・エリア進捗</div>
            <div>・配布ログ</div>
            <div>・GPS位置情報</div>
            <div>・写真エビデンス</div>
            <div>・デバイス情報</div>
          </div>
        </div>

        <div class="space-y-1">
          <p class="text-white/70 font-black">【取得データの利用目的】</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・配布進捗管理</div>
            <div>・エリア統制</div>
            <div>・FIELD OPERATIONS分析</div>
            <div>・不正防止</div>
            <div>・リアルタイム同期</div>
          </div>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">GPSおよび写真情報は、<br>FIELD OPERATIONS の活動証跡として利用されます。</p>
      </div>
    `
    },
    license: {
      title: 'License',
      body: `
      <div class="space-y-4 text-[11px] leading-relaxed text-white/50 select-none">
        <p class="text-white font-bold">FIELD OPERATIONS LICENSE</p>

        <p class="text-white/60 font-black">LICENSED ORGANIZATION<br>【__BRANCH_NAME__】</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">AUTHORIZED SYSTEMS：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・STAFF APP</div>
            <div>・ADMIN CONTROL</div>
            <div>・HQ MONITORING</div>
            <div>・REALTIME FIELD SYNC</div>
          </div>
        </div>

        <p class="text-white/60 font-black">LICENSE STATUS:<br><span class="text-emerald-500/80 font-black">ACTIVE</span></p>

        <p class="text-white/40">本ライセンスは、契約地域内のみ有効です。<br>地域外利用・再配布は禁止します。</p>

        <div class="space-y-1">
          <p class="text-white/70 font-black">POSTING MAP は：</p>
          <div class="pl-3 text-white/40 space-y-0.5">
            <div>・LINE認証</div>
            <div>・STAFF ID</div>
            <div>・ライセンス管理</div>
            <div>・権限制御</div>
          </div>
          <p class="text-white/40">により、FIELD OPERATIONS を保護します。</p>
        </div>

        <p class="text-white/40 pt-2 border-t border-white/5">LICENSED FIELD OPERATIONS SYSTEM<br>© POSTING MAP</p>
      </div>
    `
    }
  };

  /**
   * モーダル表示
   * @param {string} type - 'terms' | 'privacy' | 'license'
   * @param {Object} [options] - { branchName, event }
   */
  function open(type, options = {}) {
    const { branchName = '', event = null } = options;
    if (event && typeof event.stopPropagation === 'function') {
      event.stopPropagation(); // イベントのバブリング防止
    }

    const modal = document.getElementById('id-info-modal');
    if (!modal) return;

    const data = ID_INFO_DATA[type];
    if (!data) return;

    const titleEl = document.getElementById('id-info-title');
    const bodyEl = document.getElementById('id-info-body');

    if (titleEl) titleEl.textContent = data.title;
    if (bodyEl) {
      let bodyText = data.body;

      // ライセンス表示時のみ、地区名を動的に差し替える (必ず escapeHtml を通す)
      if (type === 'license') {
        const escaped = escapeHtml(branchName || '');
        bodyText = bodyText.replace('__BRANCH_NAME__', escaped);
      }

      bodyEl.innerHTML = bodyText;
    }

    modal.classList.remove('pointer-events-none', 'opacity-0');
    if (modal.firstElementChild) {
      modal.firstElementChild.classList.remove('translate-y-full');
    }
  }

  /**
   * モーダル非表示
   */
  function close() {
    const modal = document.getElementById('id-info-modal');
    if (!modal) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    if (modal.firstElementChild) {
      modal.firstElementChild.classList.add('translate-y-full');
    }
  }

  return {
    open,
    close
  };
})();
