// POSTING MAP Component: navigation.js (Stateless, API-free rendering)
window.renderBottomNavigation = function(activePage) {
  const getOpacity = (page) => activePage === page ? '' : 'opacity-40';
  const getTextClass = (page) => activePage === page ? 'text-white' : 'text-white/40';

  // Determine if we show Tier 1 or Tier 2 by default
  const isTier2 = ['areas', 'ranking', 'detail', 'bulletin'].includes(activePage);

  return `
    <!-- Tier 1 Container -->
    <div id="nav-tier-1" class="flex justify-around items-center ${isTier2 ? 'hidden' : ''}">
      <button data-page="storage-register" onclick="switchPage('storage-register')" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('storage-register')}">
        <div class="text-xl">📦</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('storage-register')}">枚数登録</span>
      </button>
      <button data-page="storage-list" onclick="switchPage('storage-list')" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('storage-list')}">
        <div class="text-xl">📊</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('storage-list')}">在庫確認</span>
      </button>
      <button data-page="settings" onclick="switchPage('settings')" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('settings')}">
        <div class="text-xl">👤</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('settings')}">トップ</span>
      </button>
      <button data-page="next" onclick="toggleNavTier(2)" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all opacity-40">
        <div class="text-xl">⚙️</div>
        <span class="text-[10px] font-black uppercase tracking-widest text-white/40">メニュー</span>
      </button>
    </div>

    <!-- Tier 2 Container -->
    <div id="nav-tier-2" class="flex justify-around items-center ${isTier2 ? '' : 'hidden'}">
      <button data-page="areas" onclick="navigateToAreaTab()" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('areas')}">
        <div class="text-xl">🗺️</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('areas')}">地図</span>
      </button>
      <button data-page="ranking" onclick="switchPage('ranking')" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('ranking')}">
        <div class="text-xl">🏆</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('ranking')}">ランキング</span>
      </button>
      <button data-page="bulletin" onclick="switchPage('bulletin')" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all ${getOpacity('bulletin')}">
        <div class="text-xl">💬</div>
        <span class="text-[10px] font-black uppercase tracking-widest ${getTextClass('bulletin')}">掲示板</span>
      </button>
      <button data-page="back" onclick="backToTier1()" class="nav-btn flex flex-col items-center gap-1 flex-1 transition-all opacity-40">
        <div class="text-xl">↩️</div>
        <span class="text-[10px] font-black uppercase tracking-widest text-white/40">戻る</span>
      </button>
    </div>
  `;
};
