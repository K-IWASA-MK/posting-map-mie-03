function generateRecordsReportPdfHtml(state) {
  const s = state || {};
  const branchLabel = (s.summary?.districtName || '支部').trim();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const formattedTimestamp = `${yyyy}/${mm}/${dd} ${hh}:${min}`;

  const doneAreas = Number(s.summary?.completedPins ?? (s.globalPinStatus?.completed?.length || 0));
  const totalAreas = Number(s.summary?.totalPins ?? (s.masterPins?.length || 0));
  const unassignedAreas = Number(s.summary?.unassignedPins ?? Math.max(0, totalAreas - doneAreas - Number(s.summary?.inProgressPins ?? (s.globalPinStatus?.inProgress?.length || 0))));
  const inProgressAreas = Number(s.summary?.inProgressPins ?? (s.globalPinStatus?.inProgress?.length || 0));
  const completedAreas = doneAreas;

  const rosterList = s.roster || [];
  const rankingList = s.ranking || [];
  const stocksList = s.stocks || [];
  const liveRecordsList = s.liveRecords || [];

  const totalPostings = Number(s.summary?.totalPostings || rankingList.reduce((acc, cur) => acc + (Number(cur.count) || 0), 0));
  const totalStock = Number(s.summary?.totalStockCount ?? (stocksList.reduce((acc, cur) => acc + (Number(cur.count) || 0), 0)));
  const rosterCount = Number(s.summary?.rosterCount ?? (rosterList.length || 0));

  let rosterRowsHtml = '';
  if (rosterList.length === 0) {
    rosterRowsHtml = `<tr><td colspan="4" class="text-muted" style="padding: 8px;">登録データはありません</td></tr>`;
  } else {
    rosterRowsHtml = rosterList.map(r => {
      const stockTotal = Number(r.stockTotal !== undefined ? r.stockTotal : (stocksList.filter(st => st.staffId === r.id).reduce((acc, st) => acc + (Number(st.count) || 0), 0)));
      const deliveredTotal = Number(r.deliveredTotal !== undefined ? r.deliveredTotal : (rankingList.find(rk => rk.staffId === r.id)?.count || 0));
      const isUnregistered = !r.name || r.name === '未登録';

      return `
        <tr class="${isUnregistered ? 'text-muted' : ''}">
          <td class="font-mono">${escapeHtml(r.id || '--')}</td>
          <td>${escapeHtml(r.name || '未登録')}</td>
          <td class="font-mono">${stockTotal.toLocaleString()} 枚</td>
          <td class="font-mono">${deliveredTotal.toLocaleString()} 枚</td>
        </tr>
      `;
    }).join('');
  }

  let liveRecordsRowsHtml = '';
  if (liveRecordsList.length === 0) {
    liveRecordsRowsHtml = `<tr><td colspan="5" class="text-muted" style="padding: 8px;">配布実績データはありません</td></tr>`;
  } else {
    liveRecordsRowsHtml = liveRecordsList.map(rec => {
      let formattedTime = rec.time || '--:--';
      if (rec.timestamp) {
        const match = String(rec.timestamp).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
        if (match) formattedTime = match[1].replace('-', '/');
      }
      const areaName = [rec.cityName, rec.townName].filter(Boolean).join(' ') || `エリア #${rec.rowId || ''}`;
      const countVal = Number(rec.count || 0);
      const gpsLabel = rec.gpsStatus === 'OK' ? 'GPS' : (rec.hasGps ? 'GPS' : '');
      const photoLabel = rec.photoStatus === 'OK' ? '写真' : (rec.hasPhoto ? '写真' : '');
      const evidenceLabels = [gpsLabel, photoLabel].filter(Boolean).join(' / ') || '—';

      return `
        <tr>
          <td class="font-mono text-muted">${escapeHtml(formattedTime)}</td>
          <td>${escapeHtml(areaName)}</td>
          <td class="font-mono">${countVal.toLocaleString()} 枚</td>
          <td class="font-mono">${escapeHtml(rec.staffId || '--')}</td>
          <td class="font-mono text-muted">${escapeHtml(evidenceLabels)}</td>
        </tr>
      `;
    }).join('');
  }

  let rankingRowsHtml = '';
  if (rankingList.length === 0) {
    rankingRowsHtml = `<tr><td colspan="7" class="text-muted" style="padding: 8px;">ランキングデータはありません</td></tr>`;
  } else {
    rankingRowsHtml = rankingList.map((item, idx) => {
      const rankNum = item.rank || (idx + 1);
      const isUnregistered = !item.name || item.name === '未登録';
      const staffRecs = liveRecordsList.filter(r => r.staffId === item.staffId);
      const hasGpsRec = item.hasGps || staffRecs.some(r => r.gpsStatus === 'OK' || r.hasGps);
      const hasPhotoRec = item.hasPhoto || staffRecs.some(r => r.photoStatus === 'OK' || r.hasPhoto);

      const gpsDisplay = isUnregistered ? '—' : (hasGpsRec ? 'OK' : 'NO');
      const photoDisplay = isUnregistered ? '—' : (hasPhotoRec ? 'OK' : 'NO');
      const completedCount = new Set(
        staffRecs
          .map(r => String(r.rowId ?? '').trim())
          .filter(Boolean)
      ).size;

      return `
        <tr class="${isUnregistered ? 'text-muted' : ''}">
          <td class="font-mono">${rankNum}</td>
          <td class="font-mono">${escapeHtml(item.staffId || '--')}</td>
          <td>${escapeHtml(item.name || '未登録')}</td>
          <td class="font-mono">${Number(item.count || 0).toLocaleString()} 枚</td>
          <td class="font-mono">${completedCount}</td>
          <td class="font-mono">${gpsDisplay}</td>
          <td class="font-mono">${photoDisplay}</td>
        </tr>
      `;
    }).join('');
  }

  let stocksRowsHtml = '';
  if (stocksList.length === 0) {
    stocksRowsHtml = `<tr><td colspan="5" class="text-muted" style="padding: 8px;">保有チラシデータはありません</td></tr>`;
  } else {
    stocksRowsHtml = stocksList.map(st => {
      const isUnregistered = !st.staffName || st.staffName === '未登録';
      const reqCount = Number(st.pendingRequestsCount || st.requests || 0);
      let formattedUpdate = st.updatedAt || '--';
      if (st.updatedAt) {
        const match = String(st.updatedAt).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
        if (match) formattedUpdate = match[1].replace('-', '/');
      }

      return `
        <tr class="${isUnregistered ? 'text-muted' : ''}">
          <td class="font-mono">${escapeHtml(st.staffId || '--')}</td>
          <td>${escapeHtml(st.staffName || st.location || '未設定')}</td>
          <td class="font-mono">${Number(st.count || 0).toLocaleString()} 枚</td>
          <td class="font-mono text-muted">${reqCount} 件</td>
          <td class="font-mono text-muted">${escapeHtml(formattedUpdate)}</td>
        </tr>
      `;
    }).join('');
  }

  const logoUrl = (typeof window !== 'undefined' && window.location)
    ? `${window.location.origin}/active/h-app/assets/icon180-v2.png`
    : '/active/h-app/assets/icon180-v2.png';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <title>【${escapeHtml(branchLabel)}】配布実績報告書 - POSTING MAP</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;700;900&family=JetBrains+Mono:wght@400;500;700&display=swap');

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    @page {
      size: A4 portrait;
      margin: 12mm 14mm;
    }

    body {
      font-family: 'Inter', 'Noto Sans JP', sans-serif;
      color: #0F172A;
      background-color: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      line-height: 1.4;
    }

    .font-mono {
      font-family: 'JetBrains Mono', monospace;
    }

    .sheet {
      width: 100%;
      box-sizing: border-box;
    }

    .header-box {
      border-bottom: 1.5px solid #334155;
      padding-bottom: 8px;
      position: relative;
    }

    .header-3col {
      display: flex;
      align-items: center;
      justify-content: space-between;
      position: relative;
      min-height: 38px;
    }

    .header-left {
      width: 140px;
      display: flex;
      align-items: center;
      justify-content: flex-start;
    }

    .logo-img {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      border: 1px solid #CBD5E1;
      object-fit: contain;
    }

    .header-center {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      text-align: center;
      white-space: nowrap;
    }

    .header-center h1 {
      font-size: 19px;
      font-weight: 800;
      color: #0F172A;
      letter-spacing: -0.01em;
    }

    .header-right {
      width: 140px;
      text-align: right;
      font-size: 11px;
      font-weight: 700;
      font-family: 'JetBrains Mono', monospace;
      color: #475569;
    }

    .summary-section {
      border-bottom: 1.5px solid #CBD5E1;
      padding: 14px 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .summary-row-1 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
      text-align: center;
    }

    .summary-row-2 {
      display: grid;
      grid-template-columns: repeat(3, 1fr) 1fr;
      gap: 12px;
      text-align: center;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed #E2E8F0;
    }

    .kpi-card {
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .kpi-title {
      font-size: 11px;
      font-weight: 600;
      color: #64748B;
      margin-bottom: 2px;
    }

    .kpi-num {
      font-size: 20px;
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      color: #0F172A;
      line-height: 1.1;
    }

    .kpi-num .unit {
      font-size: 12px;
      font-weight: 500;
      color: #64748B;
      margin-left: 2px;
    }

    .kpi-num .sub {
      font-size: 13px;
      font-weight: 500;
      color: #94A3B8;
      font-family: 'JetBrains Mono', monospace;
    }

    .sections-container {
      padding: 8px 0;
    }

    .section-wrap {
      margin: 6px 0;
    }

    .section-title {
      font-size: 13px;
      font-weight: 800;
      color: #0F172A;
      margin-bottom: 6px;
      break-after: avoid;
      page-break-after: avoid;
    }

    .report-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
      text-align: center;
    }

    .report-table thead {
      display: table-header-group;
    }

    .report-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .report-table thead tr {
      border-top: 1.5px solid #334155;
      border-bottom: 1.5px solid #334155;
      background: #F8FAFC;
    }

    .report-table th {
      padding: 6px 8px;
      font-weight: 700;
      color: #334155;
      font-size: 10.5px;
      text-align: center;
      border: none;
    }

    .report-table td {
      padding: 6.5px 8px;
      color: #1E293B;
      font-weight: 400;
      text-align: center;
      border-bottom: 1px solid #E2E8F0;
    }

    .report-table tbody tr:last-child td {
      border-bottom: 1.5px solid #334155;
    }

    .text-muted { color: #94A3B8 !important; }

    .report-footer {
      border-top: 1.5px solid #334155;
      padding-top: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9.5px;
      color: #64748B;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    .report-footer .brand {
      font-weight: 800;
      font-family: 'JetBrains Mono', monospace;
      color: #0F172A;
    }
  </style>
</head>
<body>
  <div class="sheet">
    <div>
      <!-- 1. ヘッダーブロック -->
      <div class="header-box">
        <div class="header-3col">
          <div class="header-left">
            <img src="${logoUrl}" alt="POSTING MAP" class="logo-img">
          </div>
          <div class="header-center">
            <h1>【${escapeHtml(branchLabel)}】配布実績報告書</h1>
          </div>
          <div class="header-right">
            ${formattedTimestamp}
          </div>
        </div>
      </div>

      <!-- 2. サマリー指標 -->
      <div class="summary-section">
        <div class="summary-row-1">
          <div class="kpi-card">
            <div class="kpi-title">配布状況</div>
            <div class="kpi-num">${doneAreas} <span class="sub">/ ${totalAreas}</span></div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">未配布</div>
            <div class="kpi-num">${unassignedAreas}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">配布中</div>
            <div class="kpi-num">${inProgressAreas}</div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">完了</div>
            <div class="kpi-num">${completedAreas}</div>
          </div>
        </div>

        <div class="summary-row-2">
          <div class="kpi-card">
            <div class="kpi-title">配布実績</div>
            <div class="kpi-num">${totalPostings.toLocaleString()} <span class="unit">枚</span></div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">保有チラシ</div>
            <div class="kpi-num">${totalStock.toLocaleString()} <span class="unit">枚</span></div>
          </div>
          <div class="kpi-card">
            <div class="kpi-title">名簿</div>
            <div class="kpi-num">${rosterCount} <span class="unit">名</span></div>
          </div>
          <div></div>
        </div>
      </div>

      <!-- 3〜6. 4大セクション -->
      <div class="sections-container">
        <!-- セクション1: 1、登録者一覧 -->
        <div class="section-wrap">
          <div class="section-title">1、登録者一覧</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 25%;">スタッフID</th>
                <th style="width: 25%;">氏名</th>
                <th style="width: 25%;">保有枚数</th>
                <th style="width: 25%;">累計配布枚数</th>
              </tr>
            </thead>
            <tbody>
              ${rosterRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- セクション2: 2、配布実績 -->
        <div class="section-wrap">
          <div class="section-title">2、配布実績</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 20%;">配布日時</th>
                <th style="width: 32%;">配布地域</th>
                <th style="width: 16%;">配布枚数</th>
                <th style="width: 16%;">担当スタッフ</th>
                <th style="width: 16%;">現場記録</th>
              </tr>
            </thead>
            <tbody>
              ${liveRecordsRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- セクション3: 3、ランキング -->
        <div class="section-wrap">
          <div class="section-header-wrap">
            <div class="section-title">3、ランキング</div>
          </div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 10%;">順位</th>
                <th style="width: 16%;">スタッフID</th>
                <th style="width: 22%;">氏名</th>
                <th style="width: 18%;">累計配布枚数</th>
                <th style="width: 14%;">完了エリア</th>
                <th style="width: 10%;">GPS</th>
                <th style="width: 10%;">写真</th>
              </tr>
            </thead>
            <tbody>
              ${rankingRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- セクション4: 4、保有チラシ -->
        <div class="section-wrap">
          <div class="section-title">4、保有チラシ</div>
          <table class="report-table">
            <thead>
              <tr>
                <th style="width: 20%;">スタッフID</th>
                <th style="width: 25%;">氏名</th>
                <th style="width: 20%;">保有枚数</th>
                <th style="width: 15%;">受渡要請</th>
                <th style="width: 20%;">最終更新</th>
              </tr>
            </thead>
            <tbody>
              ${stocksRowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- 7. フッター -->
    <div class="report-footer">
      <div class="brand">POSTING MAP</div>
    </div>
  </div>
</body>
</html>`;
}

function downloadRecordsReportPdf() {
  if (typeof DashboardState === 'undefined') {
    alert('ダッシュボードの状態を読み込めませんでした。');
    return;
  }

  const html = generateRecordsReportPdfHtml(DashboardState);
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();

  iframe.contentWindow.focus();
  setTimeout(() => {
    iframe.contentWindow.print();
    setTimeout(() => {
      if (document.body.contains(iframe)) {
        document.body.removeChild(iframe);
      }
    }, 1500);
  }, 300);
}

window.generateRecordsReportPdfHtml = generateRecordsReportPdfHtml;
window.downloadRecordsReportPdf = downloadRecordsReportPdf;


function formatCsvField(val) {
  if (val === null || val === undefined) return '""';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

function generateRecordsCsv(state) {
  const s = state || {};
  const branchLabel = (s.summary?.districtName || '支部').trim();

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');
  const formattedTimestamp = `${yyyy}/${mm}/${dd} ${hh}:${min}`;

  const rosterList = s.roster || [];
  const rankingList = s.ranking || [];
  const stocksList = s.stocks || [];
  const liveRecordsList = s.liveRecords || [];

  const lines = [];

  lines.push([formatCsvField(`【${branchLabel}】配布実績データ`), formatCsvField(`出力日時: ${formattedTimestamp}`)].join(','));
  lines.push('');

  lines.push(formatCsvField('1、登録者一覧'));
  lines.push(['スタッフID', '氏名', '保有枚数', '累計配布枚数'].map(formatCsvField).join(','));
  if (rosterList.length === 0) {
    lines.push(['(データなし)', '', '', ''].map(formatCsvField).join(','));
  } else {
    rosterList.forEach(r => {
      const stockTotal = Number(r.stockTotal !== undefined ? r.stockTotal : (stocksList.filter(st => st.staffId === r.id).reduce((acc, st) => acc + (Number(st.count) || 0), 0)));
      const deliveredTotal = Number(r.deliveredTotal !== undefined ? r.deliveredTotal : (rankingList.find(rk => rk.staffId === r.id)?.count || 0));
      lines.push([r.id || '--', r.name || '未登録', `${stockTotal.toLocaleString()} 枚`, `${deliveredTotal.toLocaleString()} 枚`].map(formatCsvField).join(','));
    });
  }
  lines.push('');

  lines.push(formatCsvField('2、配布実績'));
  lines.push(['配布日時', '配布地域', '配布枚数', '担当スタッフ', 'GPS', '写真'].map(formatCsvField).join(','));
  if (liveRecordsList.length === 0) {
    lines.push(['(データなし)', '', '', '', '', ''].map(formatCsvField).join(','));
  } else {
    liveRecordsList.forEach(rec => {
      let formattedTime = rec.time || '--:--';
      if (rec.timestamp) {
        const match = String(rec.timestamp).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
        if (match) formattedTime = match[1].replace('-', '/');
      }
      const areaName = [rec.cityName, rec.townName].filter(Boolean).join(' ') || `エリア #${rec.rowId || ''}`;
      const countVal = `${Number(rec.count || 0).toLocaleString()} 枚`;
      const gpsLabel = rec.gpsStatus === 'OK' ? 'OK' : (rec.hasGps ? 'OK' : 'NO');
      const photoLabel = rec.photoStatus === 'OK' ? 'OK' : (rec.hasPhoto ? 'OK' : 'NO');
      lines.push([formattedTime, areaName, countVal, rec.staffId || '--', gpsLabel, photoLabel].map(formatCsvField).join(','));
    });
  }
  lines.push('');

  lines.push(formatCsvField('3、ランキング'));
  lines.push(['順位', 'スタッフID', '氏名', '累計配布枚数', '完了エリア', 'GPS', '写真'].map(formatCsvField).join(','));
  if (rankingList.length === 0) {
    lines.push(['(データなし)', '', '', '', '', '', ''].map(formatCsvField).join(','));
  } else {
    rankingList.forEach((item, idx) => {
      const rankNum = item.rank || (idx + 1);
      const isUnregistered = !item.name || item.name === '未登録';
      const staffRecs = liveRecordsList.filter(r => r.staffId === item.staffId);
      const hasGpsRec = item.hasGps || staffRecs.some(r => r.gpsStatus === 'OK' || r.hasGps);
      const hasPhotoRec = item.hasPhoto || staffRecs.some(r => r.photoStatus === 'OK' || r.hasPhoto);

      const gpsDisplay = isUnregistered ? '—' : (hasGpsRec ? 'OK' : 'NO');
      const photoDisplay = isUnregistered ? '—' : (hasPhotoRec ? 'OK' : 'NO');
      const completedCount = new Set(
        staffRecs
          .map(r => String(r.rowId ?? '').trim())
          .filter(Boolean)
      ).size;

      lines.push([
        rankNum,
        item.staffId || '--',
        item.name || '未登録',
        `${Number(item.count || 0).toLocaleString()} 枚`,
        completedCount,
        gpsDisplay,
        photoDisplay
      ].map(formatCsvField).join(','));
    });
  }
  lines.push('');

  lines.push(formatCsvField('4、保有チラシ'));
  lines.push(['スタッフID', '氏名', '保有枚数', '受渡要請', '最終更新'].map(formatCsvField).join(','));
  if (stocksList.length === 0) {
    lines.push(['(データなし)', '', '', '', ''].map(formatCsvField).join(','));
  } else {
    stocksList.forEach(st => {
      const reqCount = `${Number(st.pendingRequestsCount || st.requests || 0)} 件`;
      let formattedUpdate = st.updatedAt || '--';
      if (st.updatedAt) {
        const match = String(st.updatedAt).trim().match(/(?:^\d{4}[\/-])?(\d{1,2}[\/-]\d{1,2}\s+\d{1,2}:\d{2})/);
        if (match) formattedUpdate = match[1].replace('-', '/');
      }
      lines.push([
        st.staffId || '--',
        st.staffName || st.location || '未設定',
        `${Number(st.count || 0).toLocaleString()} 枚`,
        reqCount,
        formattedUpdate
      ].map(formatCsvField).join(','));
    });
  }

  return '\uFEFF' + lines.join('\r\n');
}

function downloadRecordsCsv() {
  if (typeof DashboardState === 'undefined') {
    alert('ダッシュボードの状態を読み込めませんでした。');
    return;
  }

  const csvContent = generateRecordsCsv(DashboardState);
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const min = String(now.getMinutes()).padStart(2, '0');

  const branchLabel = (DashboardState.summary?.districtName || '支部').trim();

  const fileName = `${branchLabel}_配布実績_${yyyy}${mm}${dd}_${hh}${min}.csv`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

window.formatCsvField = formatCsvField;
window.generateRecordsCsv = generateRecordsCsv;
window.downloadRecordsCsv = downloadRecordsCsv;
