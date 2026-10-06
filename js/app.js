/**
 * BDIS - Bengkayang Distribution Intelligence System
 * Application Logic & Controller
 * Compliant with gardu.prd specifications
 */

(function () {
  "use strict";

  // State Management
  const state = {
    currentView: "landing",
    selectedTransformerId: "TRF-BKY-004", // Default to the critical one from PRD
    gisFilterRisk: "ALL",
    gisFilterFeeder: "ALL",
    gisSearchQuery: "",
    landingMapInstance: null,
    gisMapInstance: null,
    gisMarkers: {},
    gisClusterGroup: null
  };

  // Color constants strictly matching gardu.prd
  const RISK_COLORS = {
    NORMAL: "#22c55e",   // GREEN
    WASPADA: "#eab308",  // YELLOW
    WARNING: "#f97316",  // ORANGE
    CRITICAL: "#ef4444"  // RED
  };

  // DOM Elements
  const elements = {
    navItems: document.querySelectorAll(".nav-item"),
    viewSections: document.querySelectorAll(".view-section"),
    gisMapContainer: document.getElementById("gisMainMap"),
    landingMapContainer: document.getElementById("landingMiniMap"),
    gisDetailDrawer: document.getElementById("gisDetailDrawer"),
    gisSearchInput: document.getElementById("gisSearchInput"),
    gisRiskFilters: document.querySelectorAll(".filter-pill[data-risk]"),
    gisFeederFilter: document.getElementById("gisFeederFilter"),
    assetListContainer: document.getElementById("gisAssetListContainer"),
    aiTrafoSelect: document.getElementById("aiTrafoSelect"),
    priorityTableBody: document.getElementById("priorityTableBody"),
    dataTableBody: document.getElementById("dataTableBody"),
    modalBackdrop: document.getElementById("importModal")
  };

  // =========================================================================
  // ROUTER & NAVIGATION
  // =========================================================================
  function navigateTo(viewName) {
    if (!viewName) return;
    state.currentView = viewName;

    // Update Nav buttons
    elements.navItems.forEach(item => {
      const target = item.getAttribute("data-view");
      if (target === viewName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    // Toggle view sections
    elements.viewSections.forEach(section => {
      if (section.id === `view-${viewName}`) {
        section.classList.add("active-view");
      } else {
        section.classList.remove("active-view");
      }
    });

    // Update URL Hash without reload
    window.location.hash = viewName;

    // View-specific initializations
    if (viewName === "gis") {
      setTimeout(() => {
        if (state.gisMapInstance) {
          state.gisMapInstance.invalidateSize();
        } else {
          initGisMainMap();
        }
      }, 100);
    } else if (viewName === "landing") {
      setTimeout(() => {
        if (state.landingMapInstance) {
          state.landingMapInstance.invalidateSize();
        }
      }, 100);
    } else if (viewName === "ai") {
      renderAiAssessment(state.selectedTransformerId);
    } else if (viewName === "reliability") {
      renderReliabilityCharts();
    } else if (viewName === "dashboard") {
      renderDashboardCharts();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // =========================================================================
  // LEAFLET MAP INITIALIZATION & RENDERING
  // =========================================================================
  function createCustomMarkerIcon(riskLevel) {
    const color = RISK_COLORS[riskLevel] || "#00a8ff";
    const pulseClass = (riskLevel === "CRITICAL" || riskLevel === "WARNING") ? "marker-pulse" : "";

    return L.divIcon({
      className: "custom-bdis-marker",
      html: `
        <div class="marker-inner-circle" style="background-color: ${color};">
          <div class="${pulseClass}" style="border: 2px solid ${color};"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  }

  // Mini Map on Landing Page
  function initLandingMiniMap() {
    if (!elements.landingMapContainer || state.landingMapInstance) return;

    try {
      const map = L.map("landingMiniMap", {
        center: BDIS_DATA.mapCenter,
        zoom: 11,
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: false,
        dragging: false
      });

      // Dark CartoDB basemap
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        maxZoom: 18,
        subdomains: "abcd"
      }).addTo(map);

      // Plot transformers with subtle animation
      BDIS_DATA.transformers.forEach(t => {
        const icon = createCustomMarkerIcon(t.riskLevel);
        L.marker([t.lat, t.lng], { icon }).addTo(map);
      });

      state.landingMapInstance = map;
    } catch (err) {
      console.warn("Leaflet tile error (offline fallback applied):", err);
    }
  }

  // Main GIS Map
  function initGisMainMap() {
    if (!elements.gisMapContainer || state.gisMapInstance) return;

    try {
      const map = L.map("gisMainMap", {
        center: BDIS_DATA.mapCenter,
        zoom: BDIS_DATA.zoomLevel,
        zoomControl: true,
        attributionControl: true
      });

      // Dark styled tiles for professional industrial look
      L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> | PLN ULP Bengkayang',
        maxZoom: 19,
        subdomains: "abcd"
      }).addTo(map);

      state.gisMapInstance = map;

      // Populate markers
      renderGisMarkers();
    } catch (err) {
      console.warn("Leaflet initialization warning:", err);
    }
  }

  function renderGisMarkers() {
    if (!state.gisMapInstance) return;

    // Clear existing markers
    Object.values(state.gisMarkers).forEach(m => m.remove());
    state.gisMarkers = {};

    const filtered = filterTransformers();

    filtered.forEach(trafo => {
      const icon = createCustomMarkerIcon(trafo.riskLevel);
      const marker = L.marker([trafo.lat, trafo.lng], { icon });

      // Custom tooltip
      marker.bindTooltip(`
        <div style="font-family: 'Plus Jakarta Sans', sans-serif; font-size: 12px; color: #fff;">
          <strong>${trafo.id}</strong> - ${trafo.name}<br/>
          <span style="color: ${RISK_COLORS[trafo.riskLevel]}; font-weight: bold;">
            ${trafo.riskLevel} (${trafo.conditionIndex}/100)
          </span>
        </div>
      `, { direction: "top", offset: [0, -10] });

      marker.on("click", () => {
        selectTransformer(trafo.id, true);
      });

      marker.addTo(state.gisMapInstance);
      state.gisMarkers[trafo.id] = marker;
    });

    renderAssetSidebarList(filtered);
  }

  function filterTransformers() {
    return BDIS_DATA.transformers.filter(t => {
      const matchesRisk = state.gisFilterRisk === "ALL" || t.riskLevel === state.gisFilterRisk;
      const matchesFeeder = state.gisFilterFeeder === "ALL" || t.feeder === state.gisFilterFeeder;
      const q = state.gisSearchQuery.toLowerCase().trim();
      const matchesSearch = !q || t.id.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.region.toLowerCase().includes(q);
      return matchesRisk && matchesFeeder && matchesSearch;
    });
  }

  function renderAssetSidebarList(list) {
    if (!elements.assetListContainer) return;

    if (list.length === 0) {
      elements.assetListContainer.innerHTML = `
        <div style="padding: 20px; text-align: center; color: var(--text-dim); font-size: 0.8rem;">
          Tidak ada trafo yang sesuai kriteria filter.
        </div>
      `;
      return;
    }

    elements.assetListContainer.innerHTML = list.map(t => {
      const isSelected = t.id === state.selectedTransformerId;
      const color = RISK_COLORS[t.riskLevel];
      return `
        <div class="asset-list-item ${isSelected ? 'selected' : ''}" data-id="${t.id}">
          <div class="asset-item-info">
            <div class="asset-item-code">${t.id}</div>
            <div class="asset-item-sub">${t.name}</div>
            <div style="font-size: 0.7rem; color: var(--text-dim); margin-top: 2px;">
              ${t.feeder} • ${t.capacityKva} kVA
            </div>
          </div>
          <div style="text-align: right;">
            <div class="badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}60; font-size: 0.7rem;">
              ${t.conditionIndex}/100
            </div>
            <div style="font-size: 0.68rem; color: ${color}; font-weight: bold; margin-top: 3px;">
              ${t.riskLevel}
            </div>
          </div>
        </div>
      `;
    }).join("");

    // Bind item click
    elements.assetListContainer.querySelectorAll(".asset-list-item").forEach(item => {
      item.addEventListener("click", () => {
        const id = item.getAttribute("data-id");
        selectTransformer(id, true);
      });
    });
  }

  // Select Transformer and open Detail Drawer
  function selectTransformer(id, flyToMap = false) {
    const trafo = BDIS_DATA.transformers.find(t => t.id === id);
    if (!trafo) return;

    state.selectedTransformerId = id;

    // Highlight sidebar list
    if (elements.assetListContainer) {
      elements.assetListContainer.querySelectorAll(".asset-list-item").forEach(el => {
        if (el.getAttribute("data-id") === id) {
          el.classList.add("selected");
          el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        } else {
          el.classList.remove("selected");
        }
      });
    }

    // Pan map to asset
    if (flyToMap && state.gisMapInstance) {
      state.gisMapInstance.flyTo([trafo.lat, trafo.lng], 14, { duration: 1.2 });
    }

    // Render GIS Detail Drawer
    renderGisDetailDrawer(trafo);

    // If AI page is active, update AI assessment as well
    if (state.currentView === "ai") {
      renderAiAssessment(id);
    }
  }

  // Detail Drawer strictly matching PROMPT 2 in gardu.prd:
  // Transformer ID, Capacity, Loading, Temperature, Power Factor, Age, Outages, Condition Index, Risk Level, Recommended Action
  function renderGisDetailDrawer(t) {
    if (!elements.gisDetailDrawer) return;

    const riskColor = RISK_COLORS[t.riskLevel];

    elements.gisDetailDrawer.innerHTML = `
      <div class="drawer-head">
        <div>
          <div style="display: flex; align-items: center; gap: 8px;">
            <h3 style="font-family: var(--font-mono); font-size: 1.15rem; color: #fff;">${t.id}</h3>
            <span class="badge" style="background: ${riskColor}22; color: ${riskColor}; border: 1px solid ${riskColor}88;">
              ${t.riskLevel}
            </span>
          </div>
          <div style="font-size: 0.78rem; color: var(--text-muted); margin-top: 2px;">
            ${t.name}
          </div>
        </div>
        <button class="drawer-close" id="btnDrawerClose" title="Tutup Panel">&times;</button>
      </div>

      <div class="drawer-body">
        <!-- AI Condition Index Gauge -->
        <div style="background: rgba(0, 168, 255, 0.05); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 14px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="font-size: 0.74rem; text-transform: uppercase; color: var(--text-muted); font-weight: 700;">
              AI CONDITION INDEX
            </span>
            <span class="mono" style="font-size: 1.2rem; font-weight: 800; color: ${riskColor};">
              ${t.conditionIndex} <span style="font-size: 0.8rem; color: var(--text-dim);">/ 100</span>
            </span>
          </div>
          <div class="ci-bar-wrapper">
            <div class="ci-bar-fill" style="width: ${t.conditionIndex}%; background-color: ${riskColor}; box-shadow: 0 0 10px ${riskColor};"></div>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.68rem; color: var(--text-dim); margin-top: 6px;">
            <span>0 (Kritis)</span>
            <span>50 (Warning)</span>
            <span>80 (Sehat)</span>
            <span>100</span>
          </div>
        </div>

        <!-- Parameters Grid -->
        <div class="param-grid">
          <div class="param-item">
            <div class="param-item-label">Kapasitas</div>
            <div class="param-item-value">${t.capacityKva} <span style="font-size: 0.75rem;">kVA</span></div>
          </div>
          <div class="param-item">
            <div class="param-item-label">Beban (Loading)</div>
            <div class="param-item-value" style="color: ${t.loadingPct >= 90 ? 'var(--risk-critical)' : 'inherit'};">
              ${t.loadingPct}%
            </div>
          </div>
          <div class="param-item">
            <div class="param-item-label">Suhu Operasi</div>
            <div class="param-item-value" style="color: ${t.temperatureC >= 75 ? 'var(--risk-critical)' : 'inherit'};">
              ${t.temperatureC}°C
            </div>
          </div>
          <div class="param-item">
            <div class="param-item-label">Power Factor (cos φ)</div>
            <div class="param-item-value" style="color: ${t.powerFactor <= 0.8 ? 'var(--risk-warning)' : 'inherit'};">
              ${t.powerFactor}
            </div>
          </div>
          <div class="param-item">
            <div class="param-item-label">Usia Trafo</div>
            <div class="param-item-value">${t.ageYears} <span style="font-size: 0.75rem;">Tahun</span></div>
          </div>
          <div class="param-item">
            <div class="param-item-label">Gangguan / Trip (12m)</div>
            <div class="param-item-value">${t.outages12m} / ${t.trips12m} <span style="font-size: 0.75rem;">kali</span></div>
          </div>
        </div>

        <!-- AI Insight Box -->
        <div style="background: rgba(255, 255, 255, 0.02); border-left: 3px solid var(--primary); padding: 12px 14px; border-radius: 0 var(--radius-sm) var(--radius-sm) 0;">
          <div style="font-size: 0.75rem; font-weight: 700; color: var(--primary); margin-bottom: 4px; display: flex; align-items: center; gap: 6px;">
            🤖 AI DIAGNOSTIC INSIGHT
          </div>
          <div style="font-size: 0.8rem; color: var(--text-muted); line-height: 1.45;">
            ${t.topFactors[0] || 'Kondisi operasional normal tanpa anomali terdeteksi.'}
          </div>
        </div>

        <!-- Recommended Action Box -->
        <div style="background: ${riskColor}12; border: 1px solid ${riskColor}40; border-radius: var(--radius-sm); padding: 12px 14px;">
          <div style="font-size: 0.75rem; font-weight: 700; color: ${riskColor}; margin-bottom: 4px;">
            ⚡ REKOMENDASI TINDAKAN (${t.priority})
          </div>
          <div style="font-size: 0.8rem; color: #fff; line-height: 1.45;">
            ${t.recommendedAction}
          </div>
        </div>

        <!-- Action Button to AI Page -->
        <button class="btn btn-primary" id="btnGoToAiDetail" style="width: 100%; margin-top: 8px;">
          Buka Analisis AI Mendalam →
        </button>

        <div style="text-align: center; font-size: 0.7rem; color: var(--text-dim); margin-top: 4px;">
          ⚠️ PROTOTYPE DEMO DATA • MODEL ANFIS PLN BENGKAYANG
        </div>
      </div>
    `;

    elements.gisDetailDrawer.classList.add("open");

    // Drawer close event
    document.getElementById("btnDrawerClose").addEventListener("click", () => {
      elements.gisDetailDrawer.classList.remove("open");
    });

    // Go to AI Detail button
    document.getElementById("btnGoToAiDetail").addEventListener("click", () => {
      navigateTo("ai");
    });
  }

  // =========================================================================
  // AI TRANSFORMER ASSESSMENT MODULE (ANFIS Model)
  // =========================================================================
  function renderAiAssessment(trafoId) {
    const trafo = BDIS_DATA.transformers.find(t => t.id === trafoId) || BDIS_DATA.transformers[0];
    state.selectedTransformerId = trafo.id;

    // Update selector
    if (elements.aiTrafoSelect) {
      elements.aiTrafoSelect.value = trafo.id;
    }

    const aiContainer = document.getElementById("aiAssessmentContainer");
    if (!aiContainer) return;

    const riskColor = RISK_COLORS[trafo.riskLevel];

    aiContainer.innerHTML = `
      <!-- Assessment Header -->
      <div class="score-display-box">
        <div>
          <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 6px;">
            <h2 style="font-size: 1.8rem; color: #fff; font-family: var(--font-heading);">${trafo.id}</h2>
            <span class="badge" style="background: ${riskColor}25; color: ${riskColor}; border: 1px solid ${riskColor};">
              ${trafo.riskLevel}
            </span>
            <span class="badge badge-pln">${trafo.feeder}</span>
          </div>
          <div style="font-size: 0.9rem; color: var(--text-muted);">
            ${trafo.name} • Gardu Induk: ${trafo.substation}
          </div>
        </div>

        <div style="display: flex; align-items: center; gap: 24px;">
          <div style="text-align: right;">
            <div style="font-size: 0.75rem; text-transform: uppercase; color: var(--text-dim); font-weight: 700;">
              CONDITION SCORE
            </div>
            <div class="score-number-wrapper">
              <span class="score-giant" style="color: ${riskColor};">${trafo.conditionIndex}</span>
              <span class="score-scale">/ 100</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Contributing Factors & Deterioration Probability -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px;">
        <!-- Factor Analysis Card -->
        <div class="ai-factors-card">
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 14px; display: flex; align-items: center; gap: 8px;">
            🔍 FAKTOR UTAMA PENURUNAN KONDISI (ANFIS)
          </div>
          <div style="display: flex; flex-direction: column; gap: 10px;">
            ${trafo.topFactors.map(f => `
              <div class="factor-item">
                <span class="factor-bullet">▸</span>
                <span>${f}</span>
              </div>
            `).join("")}
          </div>
        </div>

        <!-- Probability of Deterioration -->
        <div class="ai-factors-card" style="display: flex; flex-direction: column; justify-content: space-between;">
          <div>
            <div style="font-size: 0.85rem; font-weight: 700; color: #fff; margin-bottom: 10px;">
              ⏱️ PROBABILITAS DEGRADASI (90 HARI)
            </div>
            <div style="display: flex; align-items: baseline; gap: 8px; margin-bottom: 12px;">
              <span class="mono" style="font-size: 2.8rem; font-weight: 800; color: ${trafo.probDeterioration90d > 40 ? 'var(--risk-critical)' : 'var(--risk-normal)'};">
                ${trafo.probDeterioration90d}%
              </span>
              <span style="font-size: 0.85rem; color: var(--text-muted);">risiko breakdown/trip</span>
            </div>
            <div class="ci-bar-wrapper">
              <div class="ci-bar-fill" style="width: ${trafo.probDeterioration90d}%; background: ${trafo.probDeterioration90d > 40 ? 'var(--risk-critical)' : 'var(--risk-normal)'};"></div>
            </div>
          </div>

          <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border-subtle);">
            <div style="font-size: 0.74rem; text-transform: uppercase; color: var(--text-dim); font-weight: 700; margin-bottom: 4px;">
              ACTIONABLE RECOMMENDATION (${trafo.priority})
            </div>
            <div style="font-size: 0.88rem; color: #fff; font-weight: 600;">
              ${trafo.recommendedAction}
            </div>
          </div>
        </div>
      </div>

      <!-- Interactive ANFIS Parameter Simulator -->
      <div class="panel-card" style="margin-top: 10px;">
        <div class="panel-head">
          <div class="panel-title">
            🎛️ Simulator Parameter ANFIS Interaktif
          </div>
          <span class="badge badge-glow">Neuro-Fuzzy Inference Simulation</span>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 18px;">
          Ubah parameter operasional di bawah untuk melihat respons model ANFIS terhadap estimasi skor kesehatan trafo secara langsung:
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 18px;">
          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>Loading Beban (%)</span>
              <strong id="simValLoading" class="mono">${trafo.loadingPct}%</strong>
            </div>
            <input type="range" id="simSliderLoading" min="20" max="130" value="${trafo.loadingPct}" style="width: 100%;">
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>Suhu Operasi (°C)</span>
              <strong id="simValTemp" class="mono">${trafo.temperatureC}°C</strong>
            </div>
            <input type="range" id="simSliderTemp" min="30" max="95" value="${trafo.temperatureC}" style="width: 100%;">
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>Power Factor (cos φ)</span>
              <strong id="simValPf" class="mono">${trafo.powerFactor}</strong>
            </div>
            <input type="range" id="simSliderPf" min="60" max="100" value="${Math.round(trafo.powerFactor * 100)}" style="width: 100%;">
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.8rem; margin-bottom: 4px;">
              <span>Jumlah Trip (12 bln)</span>
              <strong id="simValTrips" class="mono">${trafo.trips12m}</strong>
            </div>
            <input type="range" id="simSliderTrips" min="0" max="10" value="${trafo.trips12m}" style="width: 100%;">
          </div>
        </div>

        <div style="margin-top: 18px; padding: 14px; background: rgba(7, 17, 31, 0.7); border-radius: var(--radius-sm); display: flex; justify-content: space-between; align-items: center; flex-wrap: gap; gap: 14px;">
          <div>
            <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase;">Hasil Prediksi Simulasi ANFIS</div>
            <div style="font-size: 1.1rem; font-weight: 700; color: #fff;">
              Estimasi Condition Score: <span id="simResultScore" class="mono" style="color: ${riskColor}; font-size: 1.4rem;">${trafo.conditionIndex}</span>/100
              (<span id="simResultRisk" style="color: ${riskColor};">${trafo.riskLevel}</span>)
            </div>
          </div>
          <button class="btn btn-outline btn-sm" id="btnResetSim">Reset ke Aktual</button>
        </div>
      </div>

      <!-- Machine Learning Benchmark Comparison (from PRD PROMPT 5) -->
      <div class="panel-card" style="margin-top: 10px;">
        <div class="panel-head">
          <div class="panel-title">
            📊 Evaluasi & Perbandingan Algoritma Machine Learning (PRD PROMPT 5)
          </div>
          <span class="badge badge-pln">Validasi Dataset</span>
        </div>
        <div style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 12px;">
          Sesuai ketentuan PRD, model ANFIS dievaluasi secara objektif terhadap beberapa arsitektur regresi alternatif (MAE, RMSE, R²):
        </div>

        <div class="priority-table-wrapper">
          <table class="benchmark-table">
            <thead>
              <tr>
                <th>Model Algoritma</th>
                <th>MAE</th>
                <th>RMSE</th>
                <th>R² Score</th>
                <th>Evaluasi</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${BDIS_DATA.modelBenchmarks.map(m => `
                <tr class="${m.model.includes('ANFIS') ? 'highlight-row' : ''}">
                  <td>
                    <strong>${m.model}</strong>
                  </td>
                  <td class="mono">${m.mae}</td>
                  <td class="mono">${m.rmse}</td>
                  <td class="mono" style="color: var(--primary);">${m.r2}</td>
                  <td>${m.status}</td>
                  <td>
                    <span class="badge ${m.model.includes('ANFIS') ? 'badge-glow' : 'badge-outline'}" style="font-size: 0.7rem;">
                      ${m.badge}
                    </span>
                  </td>
                </tr>
              `).join("")}
            </tbody>
          </table>
        </div>
      </div>
    `;

    // Bind Simulator Sliders
    bindSimulatorEvents(trafo);
  }

  function bindSimulatorEvents(baseTrafo) {
    const sLoad = document.getElementById("simSliderLoading");
    const sTemp = document.getElementById("simSliderTemp");
    const sPf = document.getElementById("simSliderPf");
    const sTrips = document.getElementById("simSliderTrips");
    const btnReset = document.getElementById("btnResetSim");

    if (!sLoad || !sTemp || !sPf || !sTrips) return;

    function recalculate() {
      const load = parseFloat(sLoad.value);
      const temp = parseFloat(sTemp.value);
      const pf = parseFloat(sPf.value) / 100;
      const trips = parseInt(sTrips.value, 10);

      document.getElementById("simValLoading").textContent = `${load}%`;
      document.getElementById("simValTemp").textContent = `${temp}°C`;
      document.getElementById("simValPf").textContent = pf.toFixed(2);
      document.getElementById("simValTrips").textContent = trips;

      // Simulated ANFIS Neuro-Fuzzy Inference calculation:
      // High load, high temp, low pf, high trips drastically reduce score
      let score = 100;
      score -= Math.max(0, (load - 60) * 0.75);
      score -= Math.max(0, (temp - 50) * 0.9);
      score -= Math.max(0, (0.95 - pf) * 60);
      score -= trips * 4.5;
      score = Math.max(15, Math.min(99, Math.round(score)));

      let risk = "NORMAL";
      let color = RISK_COLORS.NORMAL;
      if (score < 50) {
        risk = "CRITICAL";
        color = RISK_COLORS.CRITICAL;
      } else if (score < 65) {
        risk = "WARNING";
        color = RISK_COLORS.WARNING;
      } else if (score < 80) {
        risk = "WASPADA";
        color = RISK_COLORS.WASPADA;
      }

      const scoreEl = document.getElementById("simResultScore");
      const riskEl = document.getElementById("simResultRisk");
      if (scoreEl && riskEl) {
        scoreEl.textContent = score;
        scoreEl.style.color = color;
        riskEl.textContent = risk;
        riskEl.style.color = color;
      }
    }

    sLoad.addEventListener("input", recalculate);
    sTemp.addEventListener("input", recalculate);
    sPf.addEventListener("input", recalculate);
    sTrips.addEventListener("input", recalculate);

    if (btnReset) {
      btnReset.addEventListener("click", () => {
        sLoad.value = baseTrafo.loadingPct;
        sTemp.value = baseTrafo.temperatureC;
        sPf.value = Math.round(baseTrafo.powerFactor * 100);
        sTrips.value = baseTrafo.trips12m;
        recalculate();
      });
    }
  }

  // =========================================================================
  // RELIABILITY & CHARTS (Canvas Implementation without external lock)
  // =========================================================================
  function renderReliabilityCharts() {
    drawMonthlyOutagesChart("reliabilityCanvasTrend");
    drawOutageCausesChart("reliabilityCanvasDonut");
  }

  function renderDashboardCharts() {
    drawMonthlyOutagesChart("dashboardCanvasTrend");
  }

  // Pure High-Performance Canvas Line & Bar Chart for Monthly Outages
  function drawMonthlyOutagesChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const padding = { top: 30, right: 30, bottom: 40, left: 45 };
    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    const data = BDIS_DATA.monthlyOutages;
    const maxVal = 25;

    // Draw horizontal grid lines
    ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
    ctx.lineWidth = 1;
    ctx.fillStyle = "#64748b";
    ctx.font = "11px 'Plus Jakarta Sans', sans-serif";
    ctx.textAlign = "right";

    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const val = (maxVal / steps) * i;
      const y = padding.top + chartH - (val / maxVal) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(padding.left + chartW, y);
      ctx.stroke();
      ctx.fillText(Math.round(val), padding.left - 10, y + 4);
    }

    // Draw Gangguan Bars
    const barW = (chartW / data.length) * 0.35;
    data.forEach((d, idx) => {
      const cx = padding.left + (chartW / data.length) * (idx + 0.5);
      const barH = (d.gangguan / maxVal) * chartH;
      const y = padding.top + chartH - barH;

      // Gradient bar
      const grad = ctx.createLinearGradient(0, y, 0, padding.top + chartH);
      grad.addColorStop(0, "#00a8ff");
      grad.addColorStop(1, "rgba(0, 168, 255, 0.15)");

      ctx.fillStyle = grad;
      ctx.fillRect(cx - barW, y, barW * 0.9, barH);

      // Label Month
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.fillText(d.month, cx, padding.top + chartH + 20);

      // Value label on top
      ctx.fillStyle = "#38bdf8";
      ctx.fillText(d.gangguan, cx - (barW * 0.5), y - 6);
    });

    // Draw Trip Line
    ctx.beginPath();
    ctx.strokeStyle = "#ef4444";
    ctx.lineWidth = 2.5;

    data.forEach((d, idx) => {
      const cx = padding.left + (chartW / data.length) * (idx + 0.5);
      const y = padding.top + chartH - (d.trip / maxVal) * chartH;
      if (idx === 0) {
        ctx.moveTo(cx, y);
      } else {
        ctx.lineTo(cx, y);
      }
    });
    ctx.stroke();

    // Line dots
    data.forEach((d, idx) => {
      const cx = padding.left + (chartW / data.length) * (idx + 0.5);
      const y = padding.top + chartH - (d.trip / maxVal) * chartH;
      ctx.fillStyle = "#ef4444";
      ctx.beginPath();
      ctx.arc(cx, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });
  }

  // Draw Donut chart for Outage Causes
  function drawOutageCausesChart(canvasId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const centerX = w * 0.38;
    const centerY = h * 0.5;
    const radius = Math.min(centerX, centerY) - 15;
    const innerRadius = radius * 0.6;

    let startAngle = -Math.PI / 2;

    BDIS_DATA.outageCauses.forEach(item => {
      const sliceAngle = (item.percentage / 100) * (Math.PI * 2);
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
      ctx.arc(centerX, centerY, innerRadius, startAngle + sliceAngle, startAngle, true);
      ctx.closePath();
      ctx.fillStyle = item.color;
      ctx.fill();
      startAngle += sliceAngle;
    });

    // Donut Center Text
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 16px 'Outfit', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("100%", centerX, centerY - 6);
    ctx.font = "10px 'Plus Jakarta Sans', sans-serif";
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("Penyebab", centerX, centerY + 12);
  }

  // =========================================================================
  // MAINTENANCE PRIORITY MODULE (P1, P2, P3, P4)
  // =========================================================================
  function renderPriorityTable() {
    if (!elements.priorityTableBody) return;

    // Sort by Condition Index ascending (worst condition first)
    const sorted = [...BDIS_DATA.transformers].sort((a, b) => a.conditionIndex - b.conditionIndex);

    elements.priorityTableBody.innerHTML = sorted.map((t, idx) => {
      const pClass = `badge-${t.priority.toLowerCase()}`;
      const color = RISK_COLORS[t.riskLevel];

      return `
        <tr>
          <td class="mono" style="font-weight: 700; color: #fff;">#${idx + 1}</td>
          <td>
            <div style="font-family: var(--font-mono); font-weight: 700; color: #fff;">${t.id}</div>
            <div style="font-size: 0.75rem; color: var(--text-dim);">${t.name}</div>
          </td>
          <td>${t.feeder}</td>
          <td class="mono">${t.loadingPct}%</td>
          <td class="mono">${t.temperatureC}°C</td>
          <td>
            <span class="mono" style="font-weight: 700; color: ${color};">${t.conditionIndex}</span>/100
          </td>
          <td>
            <span class="badge" style="background: ${color}20; color: ${color}; border: 1px solid ${color}60;">
              ${t.riskLevel}
            </span>
          </td>
          <td>
            <span class="badge ${pClass}">${t.priority}</span>
          </td>
          <td>
            <button class="btn btn-outline btn-sm btn-focus-map" data-id="${t.id}" title="Lihat di Peta GIS">
              🗺️ Peta GIS
            </button>
          </td>
        </tr>
      `;
    }).join("");

    // Bind Focus on Map buttons
    elements.priorityTableBody.querySelectorAll(".btn-focus-map").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        navigateTo("gis");
        setTimeout(() => {
          selectTransformer(id, true);
        }, 200);
      });
    });
  }

  // =========================================================================
  // DATA MANAGEMENT MODULE (PROMPT 4 CSV/Database preview)
  // =========================================================================
  function renderDataTable() {
    if (!elements.dataTableBody) return;

    elements.dataTableBody.innerHTML = BDIS_DATA.transformers.map(t => `
      <tr>
        <td class="mono" style="color: var(--primary); font-weight: 700;">${t.id}</td>
        <td>${t.name}</td>
        <td>${t.feeder}</td>
        <td>${t.capacityKva} kVA</td>
        <td class="mono">${t.loadingPct}%</td>
        <td class="mono">${t.temperatureC}°C</td>
        <td class="mono">${t.powerFactor}</td>
        <td class="mono">${t.outages12m} / ${t.trips12m}</td>
        <td class="mono">${t.oilTestScore}</td>
        <td class="mono" style="font-weight: 700;">${t.conditionIndex}</td>
        <td>
          <span class="badge" style="background: ${RISK_COLORS[t.riskLevel]}20; color: ${RISK_COLORS[t.riskLevel]};">
            ${t.riskLevel}
          </span>
        </td>
      </tr>
    `).join("");
  }

  // =========================================================================
  // INITIALIZATION & EVENT LISTENERS
  // =========================================================================
  function initEvents() {
    // Navigation items
    elements.navItems.forEach(item => {
      item.addEventListener("click", () => {
        const targetView = item.getAttribute("data-view");
        navigateTo(targetView);
      });
    });

    // CTA buttons on Landing
    document.querySelectorAll("[data-navigate]").forEach(btn => {
      btn.addEventListener("click", () => {
        const view = btn.getAttribute("data-navigate");
        navigateTo(view);
      });
    });

    // GIS Risk Filter pills
    elements.gisRiskFilters.forEach(pill => {
      pill.addEventListener("click", () => {
        elements.gisRiskFilters.forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        state.gisFilterRisk = pill.getAttribute("data-risk");
        renderGisMarkers();
      });
    });

    // GIS Feeder Filter dropdown
    if (elements.gisFeederFilter) {
      elements.gisFeederFilter.addEventListener("change", (e) => {
        state.gisFilterFeeder = e.target.value;
        renderGisMarkers();
      });
    }

    // GIS Live Search
    if (elements.gisSearchInput) {
      elements.gisSearchInput.addEventListener("input", (e) => {
        state.gisSearchQuery = e.target.value;
        renderGisMarkers();
      });
    }

    // AI Transformer dropdown selector
    if (elements.aiTrafoSelect) {
      elements.aiTrafoSelect.innerHTML = BDIS_DATA.transformers.map(t => `
        <option value="${t.id}">${t.id} - ${t.name} (${t.riskLevel})</option>
      `).join("");

      elements.aiTrafoSelect.addEventListener("change", (e) => {
        selectTransformer(e.target.value, false);
      });
    }

    // Import Data Modal events
    const btnOpenImport = document.getElementById("btnOpenImportModal");
    const btnCloseImport = document.getElementById("btnCloseImportModal");
    const btnSimulateImport = document.getElementById("btnSimulateImport");

    if (btnOpenImport && elements.modalBackdrop) {
      btnOpenImport.addEventListener("click", () => elements.modalBackdrop.classList.add("open"));
    }
    if (btnCloseImport && elements.modalBackdrop) {
      btnCloseImport.addEventListener("click", () => elements.modalBackdrop.classList.remove("open"));
    }
    if (btnSimulateImport && elements.modalBackdrop) {
      btnSimulateImport.addEventListener("click", () => {
        const progressEl = document.getElementById("importProgressBox");
        if (progressEl) {
          progressEl.style.display = "block";
          setTimeout(() => {
            alert("✅ Validasi Berhasil!\n186 baris data trafo PLN Bengkayang lolos pengecekan tipe data, koordinat spasial, dan konsistensi unit.");
            elements.modalBackdrop.classList.remove("open");
          }, 1000);
        }
      });
    }

    // Quick priority table in Overview
    const quickPriorityBody = document.getElementById("overviewQuickPriority");
    if (quickPriorityBody) {
      const topCritical = [...BDIS_DATA.transformers]
        .sort((a, b) => a.conditionIndex - b.conditionIndex)
        .slice(0, 5);

      quickPriorityBody.innerHTML = topCritical.map((t, idx) => `
        <tr style="cursor: pointer;" data-id="${t.id}">
          <td class="mono">#${idx + 1}</td>
          <td class="mono" style="font-weight: 700; color: #fff;">${t.id}</td>
          <td>${t.name}</td>
          <td class="mono" style="color: ${RISK_COLORS[t.riskLevel]}; font-weight: 700;">${t.conditionIndex}</td>
          <td><span class="badge badge-${t.priority.toLowerCase()}">${t.priority}</span></td>
        </tr>
      `).join("");

      quickPriorityBody.querySelectorAll("tr").forEach(row => {
        row.addEventListener("click", () => {
          const id = row.getAttribute("data-id");
          navigateTo("gis");
          setTimeout(() => selectTransformer(id, true), 150);
        });
      });
    }
  }

  // Main Initializer
  window.addEventListener("DOMContentLoaded", () => {
    initLandingMiniMap();
    initEvents();
    renderPriorityTable();
    renderDataTable();

    // Handle initial hash routing
    const initialHash = window.location.hash.replace("#", "");
    if (initialHash && document.getElementById(`view-${initialHash}`)) {
      navigateTo(initialHash);
    } else {
      navigateTo("landing");
    }
  });

})();
