var pageIdMap = {
  'page-areas': 'areas',
  'page-settings': 'settings',
  'page-ranking': 'ranking',
  'page-storage-register': 'storage-register',
  'page-storage-list': 'storage-list',
  'page-bulletin': 'bulletin'
};

let _prevPageBeforeTier2 = 'areas';
var lastAreaSubPage = 'areas';
var scrollPositions = { areas: 0, settings: 0, ranking: 0 };
let _autoHideScrollBound = false;
let _previousScrollTop = 0;
let _suppressAutoHideScroll = false;

function bindNormalScreenAutoHide() {
  if (_autoHideScrollBound || typeof document === 'undefined') return;
  const contentEl = document.getElementById('content');
  if (!contentEl) return;
  _autoHideScrollBound = true;

  contentEl.addEventListener('scroll', function() {
    const appEl = document.getElementById('app');
    if (!appEl || !appEl.classList.contains('nav-auto-enabled')) return;

    const currentScrollTop = Math.max(0, contentEl.scrollTop || 0);

    if (_suppressAutoHideScroll) {
      _previousScrollTop = currentScrollTop;
      return;
    }

    if (currentScrollTop <= 16) {
      appEl.classList.remove('nav-auto-hidden');
      _previousScrollTop = currentScrollTop;
      return;
    }

    const delta = currentScrollTop - _previousScrollTop;
    if (delta >= 8 && currentScrollTop > 24) {
      appEl.classList.add('nav-auto-hidden');
      _previousScrollTop = currentScrollTop;
    } else if (delta <= -6) {
      appEl.classList.remove('nav-auto-hidden');
      _previousScrollTop = currentScrollTop;
    }
  }, { passive: true });
}

async function switchPage(id, force = false) {
  const pages = document.querySelectorAll('.page');
  const targetId = id === 'settings' ? 'page-settings' :
                   id === 'ranking' ? 'page-ranking' :
                   id === 'storage-register' ? 'page-storage-register' :
                   id === 'storage-list' ? 'page-storage-list' :
                   id === 'bulletin' ? 'page-bulletin' :
                   'page-areas';
  const target = document.getElementById(targetId);
  if (!target) return;

  if (!force && !target.classList.contains('hidden') && target.style.opacity === '1') return;

  const mapContentEl = document.getElementById('content');
  if (mapContentEl) {
    if (id === 'areas' && (typeof currentCity === 'undefined' || currentCity === null)) {
      mapContentEl.classList.add('is-map-view');
    } else {
      mapContentEl.classList.remove('is-map-view');
    }
  }

  if (id === 'areas') {
    lastAreaSubPage = id;
  }

  const activePage = Array.from(pages).find(p => !p.classList.contains('hidden'));
  if (activePage) {
    const activeId = pageIdMap[activePage.id];
    if (activeId) {
      const contentEl = document.getElementById('content');
      if (contentEl) {
        scrollPositions[activeId] = contentEl.scrollTop;
      }
    }
    activePage.style.opacity = '0';
    activePage.style.transform = 'translateY(-12px)';
    await new Promise(r => setTimeout(r, 200));
    activePage.classList.add('hidden');
  } else {
    pages.forEach(p => {
      p.classList.add('hidden');
      p.style.opacity = '0';
    });
  }

  updateBottomNavVisibility();

  const appEl = document.getElementById('app');
  if (appEl) {
    appEl.classList.remove('nav-auto-hidden');
    if (id === 'areas') {
      appEl.classList.remove('nav-auto-enabled');
    } else {
      appEl.classList.add('nav-auto-enabled');
    }
  }

  const contentEl = document.getElementById('content');
  if (contentEl) {
    _suppressAutoHideScroll = true;
    contentEl.scrollTop = 0;
    contentEl.style.overflowY = 'auto';
  }

  target.style.opacity = '0';
  target.style.transform = 'translateY(12px)';
  target.classList.remove('hidden');

  if (typeof window.onPageEnter === 'function') {
    window.onPageEnter(id);
  }

  target.offsetHeight;

  target.style.opacity = '1';
  target.style.transform = 'translateY(0)';

  const navContainer = document.getElementById('bottom-nav');
  const renderNavFn = window.renderBottomNavigation || (typeof renderBottomNavigation === 'function' ? renderBottomNavigation : null);
  if (navContainer && renderNavFn) {
    navContainer.innerHTML = renderNavFn(id);
  }

  const scrollContent = document.getElementById('content');
  if (scrollContent) {
    _suppressAutoHideScroll = true;
    scrollContent.scrollTo(0, scrollPositions[id] || 0);
    _previousScrollTop = Math.max(0, scrollContent.scrollTop || 0);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        _previousScrollTop = Math.max(0, scrollContent.scrollTop || 0);
        _suppressAutoHideScroll = false;
      });
    } else {
      _suppressAutoHideScroll = false;
    }
  } else {
    _previousScrollTop = 0;
    _suppressAutoHideScroll = false;
  }
}

function toggleNavTier(tier) {
  if (tier === 2) {
    const activePage = document.querySelector('.page:not(.hidden)');
    if (activePage) {
      _prevPageBeforeTier2 = pageIdMap[activePage.id] || 'areas';
    }
    (typeof switchPage === 'function' ? switchPage : window.switchPage)('areas');
  }
}

function backToTier1() {
  const targetPage = _prevPageBeforeTier2 || 'settings';
  (typeof switchPage === 'function' ? switchPage : window.switchPage)(targetPage);
}

function navigateToAreaTab() {
  const target = window.lastAreaSubPage || lastAreaSubPage || 'areas';
  (typeof switchPage === 'function' ? switchPage : window.switchPage)(target);
}

function updateBottomNavVisibility() {
  const nav = document.getElementById('bottom-nav');
  const hasUser = typeof localStorage !== 'undefined' && !!localStorage.getItem('user_info');
  if (nav) nav.style.display = hasUser ? '' : 'none';
  bindNormalScreenAutoHide();
}

window.pageIdMap = pageIdMap;
window.scrollPositions = scrollPositions;
window.lastAreaSubPage = lastAreaSubPage;
window.toggleNavTier = toggleNavTier;
window.backToTier1 = backToTier1;
window.navigateToAreaTab = navigateToAreaTab;
window.updateBottomNavVisibility = updateBottomNavVisibility;
window.switchPage = switchPage;
