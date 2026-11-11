(() => {
  "use strict";

  const one = (selector) => document.querySelector(selector);
  const many = (selector) => Array.from(document.querySelectorAll(selector));
  const numberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
  const dateFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

  const state = {
    vehicles: [],
    selectedId: null,
    filter: "all",
    search: "",
    nearestFirst: true,
    updatedAt: null
  };

  const aliases = {
    asset: ["bem", "codigo do bem", "cod bem", "bem codigo", "codigo bem"],
    plate: ["placa", "numero da placa"],
    model: ["modelo", "modelo bem", "descricao do bem", "descricao bem", "nome do bem"],
    description: ["descricao", "descricao do equipamento", "descricao ativo"],
    category: ["classe", "categoria", "tipo bem", "grupo bem", "tipo do bem", "classificacao"],
    driver: ["condutor", "motorista", "nome do condutor"],
    current: ["cont acumulado", "cont atual", "contador atual", "leitura atual", "horimetro atual"],
    next: ["cont manutencao", "contador manutencao", "proxima manutencao", "proxima revisao"],
    remaining: ["cont restante", "contador restante", "restante", "faltam"],
    interval: ["incremento manut", "incremento manutencao", "intervalo manutencao", "periodicidade manutencao"],
    tolerance: ["tolerancia cont", "tolerancia contador", "tolerancia"],
    maintenance: ["desc manutencao", "descricao manutencao", "tipo manut", "tipo manutencao", "servico"],
    date: ["data contador", "data leitura", "data medicao"],
    unit: ["unidade contador", "tipo contador", "unidade cont", "unidade de medida", "medicao"]
  };

  function normalizeText(value) {
    return String(value == null ? "" : value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[char]);
  }

  function pick(row, keys) {
    const normalized = Object.keys(row || {}).map((key) => [normalizeText(key), row[key]]);
    for (const alias of keys) {
      const match = normalized.find((entry) => entry[0] === normalizeText(alias));
      if (match && String(match[1] == null ? "" : match[1]).trim() !== "") return match[1];
    }
    return "";
  }

  function toNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null || String(value).trim() === "") return null;
    const source = String(value).trim();
    const cleaned = source.replace(/[^\d,.\-]/g, "");
    if (!cleaned || cleaned === "-" || cleaned === "," || cleaned === ".") return null;
    let normalized = cleaned;
    if (normalized.includes(",") && normalized.includes(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (normalized.includes(",")) {
      normalized = normalized.replace(",", ".");
    } else if (/\.\d{3}($|[^0-9])/.test(normalized)) {
      normalized = normalized.replace(/\./g, "");
    }
    const result = Number(normalized);
    return Number.isFinite(result) ? result : null;
  }

  function formatNumber(value) {
    return value == null || !Number.isFinite(Number(value)) ? "—" : numberFormat.format(Math.round(Number(value)));
  }

  function typeFromRow(row) {
    const explicit = normalizeText(pick(row, aliases.category));
    const model = normalizeText(pick(row, aliases.model));
    const description = normalizeText(pick(row, aliases.description));
    const source = explicit + " " + model + " " + description;
    if (/moto|motocic|bros|cg 160|nxr|fan 160|biz 125|pop 110|xtz|yamaha factor/.test(source)) return "moto";
    if (/onibus|bus urbano|volvo b[0-9]|marcopolo|caio apache/.test(source)) return "bus";
    if (/caminhao|truck|cavalo mecanico|volvo fh|volvo fm|scania|daf xf|mercedes actros|cargo 24|iveco stralis/.test(source)) return "truck";
    return "other";
  }

  function unitFromRow(row) {
    const unitValue = normalizeText(pick(row, aliases.unit));
    const counterValues = ["current", "next", "remaining", "interval"].map((key) => String(pick(row, aliases[key]) || "").toLowerCase()).join(" ");
    const combined = unitValue + " " + counterValues;
    return /\b(h|hr|hrs|hora|horas|horimetro)\b/.test(combined) ? "h" : "km";
  }

  function getAssetCode(raw) {
    const value = String(raw || "").trim();
    const vec = value.match(/\bV\s*E\s*C\s*[- ]?\s*(\d{2,})\b/i);
    if (vec) return "VEC " + vec[1];
    if (!value) return "Bem sem código";
    return value;
  }

  function buildVehicle(row, index) {
    const rawAsset = pick(row, aliases.asset);
    const plate = String(pick(row, aliases.plate) || "").trim().toUpperCase();
    const assetCode = getAssetCode(rawAsset);
    const model = String(pick(row, aliases.model) || pick(row, aliases.description) || "Modelo não informado").trim();
    const driver = String(pick(row, aliases.driver) || "").trim();
    const current = toNumber(pick(row, aliases.current));
    const lastService = toNumber(pick(row, aliases.next));
    const reportedRemaining = toNumber(pick(row, aliases.remaining));
    const reportedInterval = toNumber(pick(row, aliases.interval));
    const type = typeFromRow(row);
    const unit = unitFromRow(row);
    const defaultInterval = type === "moto" ? 10000 : (type === "truck" || type === "bus" ? 30000 : null);
    const hasMaintenanceRecord = lastService != null && lastService > 0;
    const interval = (!hasMaintenanceRecord && type === "moto" ? defaultInterval : reportedInterval) || defaultInterval;
    const dueFromRecord = hasMaintenanceRecord && interval != null ? lastService + interval : null;
    let remaining = hasMaintenanceRecord ? reportedRemaining : null;
    if (remaining == null && dueFromRecord != null && current != null) remaining = dueFromRecord - current;
    if (remaining == null && current != null && interval != null && interval > 0) {
      const withinCycle = current % interval;
      remaining = withinCycle === 0 ? interval : interval - withinCycle;
    }
    const nextService = dueFromRecord != null ? dueFromRecord : (current != null && remaining != null ? current + remaining : null);
    const rawTolerance = toNumber(pick(row, aliases.tolerance));
    const toleranceEstimated = !hasMaintenanceRecord || rawTolerance == null;
    const tolerance = toleranceEstimated ? (unit === "h" ? 100 : 1000) : rawTolerance;
    const maintenance = hasMaintenanceRecord ? String(pick(row, aliases.maintenance) || "").trim() : "Revisão periódica estimada";
    const measuredAt = String(pick(row, aliases.date) || "").trim();
    const idValue = String(rawAsset || plate || model + "-" + index).trim();
    return {
      id: normalizeText(idValue) || "veiculo-" + index,
      assetCode: assetCode,
      plate: plate,
      model: model,
      driver: driver,
      type: type,
      unit: unit,
      current: current,
      nextService: nextService,
      interval: interval,
      remaining: remaining,
      tolerance: tolerance,
      toleranceEstimated: toleranceEstimated,
      planEstimated: !hasMaintenanceRecord,
      _hasMaintenanceRecord: hasMaintenanceRecord,
      maintenance: maintenance,
      measuredAt: measuredAt
    };
  }

  function chooseMaintenanceRow(candidates) {
    const registered = candidates.filter((item) => item._hasMaintenanceRecord);
    const candidatesWithPlan = registered.length ? registered : candidates;
    const periodic = candidatesWithPlan.filter((item) => !(item.type === "moto" && /primeira revisao/.test(normalizeText(item.maintenance)) && item.current > item.interval * 2));
    const pool = periodic.length ? periodic : candidatesWithPlan;
    return pool.slice().sort((a, b) => {
      const ar = a.remaining == null ? Number.POSITIVE_INFINITY : a.remaining;
      const br = b.remaining == null ? Number.POSITIVE_INFINITY : b.remaining;
      if (ar !== br) return ar - br;
      if (a.current == null && b.current != null) return 1;
      if (b.current == null && a.current != null) return -1;
      return String(a.maintenance).localeCompare(String(b.maintenance), "pt-BR");
    })[0];
  }

  function normalizeReport(rows) {
    const grouped = new Map();
    rows.forEach((row, index) => {
      const assetValue = String(pick(row, aliases.asset) || "").trim();
      const plate = String(pick(row, aliases.plate) || "").trim();
      if (!assetValue && !plate) return;
      const vehicle = buildVehicle(row, index);
      const key = normalizeText(assetValue || plate);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(vehicle);
    });
    return Array.from(grouped.values()).map((candidates) => {
      const chosen = chooseMaintenanceRow(candidates);
      delete chosen._hasMaintenanceRecord;
      return chosen;
    });
  }

  function getStatus(vehicle) {
    if (vehicle.remaining == null) return { label: "Sem leitura", tone: "neutral" };
    if (vehicle.remaining < 0) {
      if (vehicle.tolerance != null && Math.abs(vehicle.remaining) <= vehicle.tolerance) {
        return { label: "Dentro da tolerância", tone: "attention" };
      }
      return { label: "Revisão vencida", tone: "late" };
    }
    if (vehicle.remaining === 0) return { label: "Revisão agora", tone: "attention" };
    if (vehicle.interval != null && vehicle.remaining <= vehicle.interval * 0.2) return { label: "Revisão próxima", tone: "attention" };
    return { label: "Em dia", tone: "good" };
  }

  function progress(vehicle) {
    if (vehicle.remaining == null || !vehicle.interval) return 0;
    return Math.max(0, Math.min(100, 100 - (vehicle.remaining / vehicle.interval) * 100));
  }

  function progressSegments(value, tolerance, interval) {
    const total = 22;
    const filled = Math.round((value / 100) * total);
    const toleranceShare = tolerance && interval ? tolerance / interval : 0;
    const toleranceBoundary = Math.max(0, Math.min(total, Math.round((1 - toleranceShare) * total)));
    let html = "";
    for (let i = 0; i < total; i += 1) {
      let cls = "progress-segment";
      if (i < filled) cls += i >= toleranceBoundary ? " is-tolerance" : " is-filled";
      html += '<i class="' + cls + '"></i>';
    }
    return html;
  }

  function vehicleImage(type) {
    if (type === "moto") return "/assets/moto.svg";
    if (type === "bus") return "/assets/bus.svg";
    return "/assets/truck.svg";
  }

  function imageClass(type) {
    return type === "moto" ? "feature-vehicle--moto" : (type === "bus" ? "feature-vehicle--bus" : "");
  }

  function plateMarkup(plate, mini) {
    const number = plate || "SEM PLACA";
    return '<span class="' + (mini ? "mini-plate" : "mercosul-plate") + '" aria-label="Placa ' + escapeHtml(number) + '">' +
      '<span class="plate-band"><span>BRASIL</span><span>▰</span></span>' +
      '<span class="plate-number">' + escapeHtml(number) + "</span></span>";
  }

  function remainingText(vehicle) {
    const value = vehicle.remaining;
    if (value == null) return "Sem leitura";
    const unit = vehicle.unit || "km";
    if (value < 0) return "Passou " + formatNumber(Math.abs(value)) + " " + unit;
    if (value === 0) return "No limite";
    return "Faltam " + formatNumber(value) + " " + unit;
  }

  function updateCounts() {
    const count = (type) => state.vehicles.filter((vehicle) => vehicle.type === type).length;
    const urgent = state.vehicles.filter((vehicle) => {
      const status = getStatus(vehicle).tone;
      return status === "attention" || status === "late";
    }).length;
    one("#count-truck").textContent = formatNumber(count("truck"));
    one("#count-moto").textContent = formatNumber(count("moto"));
    one("#count-bus").textContent = formatNumber(count("bus"));
    one("#count-total").textContent = formatNumber(state.vehicles.length);
    one("#fleet-count").textContent = String(state.vehicles.length);
    one("#filter-all-count").textContent = String(state.vehicles.length);
    one("#filter-truck-count").textContent = String(count("truck"));
    one("#filter-moto-count").textContent = String(count("moto"));
    one("#filter-bus-count").textContent = String(count("bus"));
    one("#filter-urgent-count").textContent = String(urgent);
  }

  function renderFeature() {
    const vehicle = state.vehicles.find((item) => item.id === state.selectedId);
    const panel = one("#selected-panel");
    const statusElement = one("#hero-status");
    if (!vehicle) {
      panel.className = "feature-card feature-card--empty";
      panel.innerHTML =
        '<div class="feature-empty">' +
          '<div class="feature-empty-copy"><p class="eyebrow"><span class="eyebrow-line"></span> PRIMEIRA ATUALIZAÇÃO</p>' +
          '<h3>Seu painel está pronto para a frota.</h3>' +
          '<p>Importe o relatório exportado do Qlik para acompanhar caminhões, motocicletas e ônibus. A próxima revisão e o que falta aparecem aqui assim que os dados forem carregados.</p>' +
          '<button class="button button--orange" type="button" data-open-import>Importar relatório <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6"/></svg></button></div>' +
          '<img class="empty-illustration" src="/assets/truck.svg" alt="" aria-hidden="true">' +
        '</div>';
      statusElement.className = "status-pill status-pill--neutral";
      statusElement.innerHTML = '<span class="status-dot"></span>Aguardando dados';
      return;
    }

    const status = getStatus(vehicle);
    const pct = progress(vehicle);
    const currentLabel = vehicle.current == null ? "—" : formatNumber(vehicle.current);
    const nextLabel = vehicle.nextService == null ? "—" : formatNumber(vehicle.nextService);
    const intervalLabel = vehicle.interval == null ? "Intervalo não cadastrado" : "A cada " + formatNumber(vehicle.interval) + " " + vehicle.unit + (vehicle.planEstimated ? " · estimativa" : "");
    const toleranceLabel = vehicle.tolerance == null ? "Não informada" : formatNumber(vehicle.tolerance) + " " + vehicle.unit;
    const statusClass = status.tone === "late" ? "status-pill--late" : (status.tone === "attention" ? "status-pill--attention" : (status.tone === "neutral" ? "status-pill--neutral" : ""));
    const maintenance = vehicle.maintenance || "Plano de manutenção";
    const driver = vehicle.driver || "Condutor não informado";
    const code = vehicle.assetCode || "Bem sem código";
    panel.className = "feature-card";
    panel.innerHTML =
      '<div class="driver-ribbon"><span class="driver-avatar"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2"/><path d="M5.5 19c.8-3.2 3.1-4.8 6.5-4.8s5.7 1.6 6.5 4.8"/></svg></span>' +
        '<span class="driver-meta"><small>MOTORISTA RESPONSÁVEL</small><strong>' + escapeHtml(driver) + "</strong></span></div>" +
      '<div class="feature-inner">' +
        '<div class="feature-visual"><span class="feature-kicker"><i></i> VEÍCULO SELECIONADO</span>' +
          '<img class="feature-vehicle ' + imageClass(vehicle.type) + '" src="' + vehicleImage(vehicle.type) + '" alt="' + escapeHtml(vehicle.model) + '">' +
        '</div>' +
        '<div class="feature-info">' +
          '<div class="feature-header"><div><p class="asset-overline">' + escapeHtml(code) + "</p><h3 class=\"feature-title\">" + escapeHtml(vehicle.model) + "</h3>" +
            '<p class="vehicle-subline">' + escapeHtml(intervalLabel) + "</p></div>" + plateMarkup(vehicle.plate, false) + "</div>" +
          '<div class="metric-row">' +
            '<div class="metric-block"><span class="metric-label">CONTADOR ATUAL</span><strong class="metric-value">' + currentLabel + '<span class="metric-unit">' + escapeHtml(vehicle.unit) + "</span></strong>" +
              '<span class="metric-detail">' + escapeHtml(vehicle.measuredAt ? "Leitura em " + vehicle.measuredAt : "Última leitura do relatório") + "</span></div>" +
            '<div class="metric-block metric-block--next"><span class="metric-label">PRÓXIMA REVISÃO</span><strong class="metric-value metric-value--next">' + nextLabel + '<span class="metric-unit">' + escapeHtml(vehicle.unit) + "</span></strong>" +
              '<span class="metric-detail">' + escapeHtml(maintenance) + "</span></div>" +
          "</div>" +
          '<div class="progress-section"><div class="progress-heading"><strong>' + escapeHtml(remainingText(vehicle)) + '</strong><span>' + Math.round(pct) + "% do ciclo</span></div>" +
            '<div class="progress-track" role="img" aria-label="' + Math.round(pct) + '% do intervalo percorrido">' + progressSegments(pct, vehicle.tolerance, vehicle.interval) + "</div>" +
            '<div class="tolerance-row"><span>Intervalo <strong>' + escapeHtml(vehicle.interval == null ? "—" : formatNumber(vehicle.interval) + " " + vehicle.unit) + "</strong></span>" +
              '<span>Tolerância <strong>' + escapeHtml(toleranceLabel) + (vehicle.toleranceEstimated ? " · referência" : "") + "</strong></span></div></div>" +
          '<div class="feature-footer"><span class="maintenance-label"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 6a4 4 0 0 0-5.4 5.4l-5.1 5.1a2 2 0 0 0 2.8 2.8l5.1-5.1A4 4 0 0 0 17 8.8L14.5 11l-2.5-2.5L14 6Z"/></svg>' + escapeHtml(maintenance) + "</span>" +
            '<span class="service-status-text">' + escapeHtml(status.label) + "</span></div>" +
        "</div>" +
      "</div>";
    statusElement.className = "status-pill " + statusClass;
    statusElement.innerHTML = '<span class="status-dot"></span>' + escapeHtml(status.label);
  }

  function cardMarkup(vehicle) {
    const status = getStatus(vehicle);
    const pct = progress(vehicle);
    const statusClass = status.tone === "late" ? "card-status--late" : (status.tone === "attention" ? "card-status--attention" : (status.tone === "neutral" ? "card-status--neutral" : ""));
    const selectedClass = vehicle.id === state.selectedId ? " is-selected" : "";
    const imageClassName = vehicle.type === "moto" ? "card-vehicle-art--moto" : (vehicle.type === "bus" ? "card-vehicle-art--bus" : "");
    const remainderClass = status.tone === "late" ? "is-late" : "";
    const segments = progressSegments(pct, vehicle.tolerance, vehicle.interval);
    const code = vehicle.assetCode || "Bem sem código";
    return '<article class="vehicle-card' + selectedClass + '" data-vehicle-id="' + escapeHtml(vehicle.id) + '" tabindex="0" role="button" aria-label="Selecionar ' + escapeHtml(vehicle.model) + ", placa " + escapeHtml(vehicle.plate || "não informada") + '">' +
      '<div class="vehicle-card-top"><div><span class="card-asset-code">' + escapeHtml(code) + '</span><strong class="card-model">' + escapeHtml(vehicle.model) + "</strong></div>" + plateMarkup(vehicle.plate, true) + "</div>" +
      '<img class="card-vehicle-art ' + imageClassName + '" src="' + vehicleImage(vehicle.type) + '" alt="" aria-hidden="true">' +
      '<div class="card-metric"><div><small>CONTADOR ATUAL</small><strong>' + (vehicle.current == null ? "—" : formatNumber(vehicle.current)) + ' <span class="metric-unit">' + escapeHtml(vehicle.unit) + "</span></strong></div>" +
      '<div class="card-remain"><small>PRÓXIMA REVISÃO</small><strong class="' + remainderClass + '">' + escapeHtml(remainingText(vehicle)) + "</strong></div></div>" +
      '<div class="card-progress" role="img" aria-label="' + Math.round(pct) + "% do intervalo percorrido\">" + segments + "</div>" +
      '<div class="card-bottom"><span>' + escapeHtml(vehicle.interval == null ? "Intervalo não informado" : "A cada " + formatNumber(vehicle.interval) + " " + vehicle.unit + (vehicle.planEstimated ? " · estimativa" : "")) + '</span><span class="card-status ' + statusClass + '">' + escapeHtml(status.label) + "</span></div>" +
    "</article>";
  }

  function visibleVehicles() {
    let vehicles = state.vehicles.slice();
    if (state.filter === "urgent") {
      vehicles = vehicles.filter((item) => {
        const tone = getStatus(item).tone;
        return tone === "attention" || tone === "late";
      });
    } else if (state.filter !== "all") {
      vehicles = vehicles.filter((item) => item.type === state.filter);
    }
    const query = normalizeText(state.search);
    if (query) {
      vehicles = vehicles.filter((item) => normalizeText([item.assetCode, item.plate, item.model, item.driver].join(" ")).includes(query));
    }
    vehicles.sort((a, b) => {
      if (state.nearestFirst) {
        const ar = a.remaining == null ? Number.POSITIVE_INFINITY : a.remaining;
        const br = b.remaining == null ? Number.POSITIVE_INFINITY : b.remaining;
        if (ar !== br) return ar - br;
      }
      return String(a.assetCode).localeCompare(String(b.assetCode), "pt-BR", { numeric: true });
    });
    return vehicles;
  }

  function renderGrid() {
    const grid = one("#vehicle-grid");
    const noResults = one("#empty-results");
    const vehicles = visibleVehicles();
    if (!state.vehicles.length) {
      grid.innerHTML = "";
      noResults.hidden = true;
      return;
    }
    if (!vehicles.length) {
      grid.innerHTML = "";
      noResults.hidden = false;
      return;
    }
    noResults.hidden = true;
    grid.innerHTML = vehicles.map(cardMarkup).join("");
  }

  function renderTimestamp() {
    const label = one("#updated-label");
    const footer = one("#footer-updated");
    if (!state.updatedAt) {
      label.textContent = "Aguardando relatório";
      footer.textContent = "Dados compartilhados pela última importação.";
      return;
    }
    const date = new Date(state.updatedAt);
    const value = Number.isNaN(date.getTime()) ? String(state.updatedAt) : dateFormat.format(date);
    label.textContent = "Atualizado " + value;
    footer.textContent = "Frota atualizada em " + value + ".";
  }

  function render() {
    updateCounts();
    renderFeature();
    renderGrid();
    renderTimestamp();
  }

  async function loadFleet() {
    try {
      const response = await fetch("/api/fleet", { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível consultar a frota.");
      const payload = await response.json();
      state.vehicles = Array.isArray(payload.vehicles) ? payload.vehicles : [];
      state.updatedAt = payload.updatedAt || null;
      if (!state.vehicles.some((item) => item.id === state.selectedId)) {
        state.selectedId = state.vehicles.length ? state.vehicles[0].id : null;
      }
      render();
    } catch (error) {
      state.vehicles = [];
      state.updatedAt = null;
      render();
      one("#updated-label").textContent = "Sem conexão";
      one("#footer-updated").textContent = "Não foi possível carregar os dados compartilhados.";
    }
  }

  const dialog = one("#import-dialog");
  const fileInput = one("#report-file");
  const tokenInput = one("#import-token");
  const submitButton = one("#submit-import");
  const importMessage = one("#import-message");

  function openImport() {
    importMessage.textContent = "";
    importMessage.className = "import-message";
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "open");
  }

  function updateImportButton() {
    submitButton.disabled = !fileInput.files.length || !tokenInput.value.trim();
  }

  function headerMatches(headers, searchKeys) {
    const normalized = headers.map((header) => [normalizeText(header), header]);
    for (const key of searchKeys) {
      const target = normalizeText(key);
      const match = normalized.find((pair) => pair[0] === target);
      if (match) return match[1];
    }
    return null;
  }

  function workbookRows(workbook) {
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const matrix = window.XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
      if (matrix.length < 2) continue;
      const headers = matrix[0].map((cell) => String(cell || "").trim());
      const hasAsset = headerMatches(headers, aliases.asset);
      const hasPlate = headerMatches(headers, aliases.plate);
      if (!hasAsset && !hasPlate) continue;
      return matrix.slice(1).map((values) => {
        const row = {};
        headers.forEach((header, column) => {
          if (header) row[header] = values[column] == null ? "" : values[column];
        });
        return row;
      });
    }
    throw new Error("Não encontrei uma aba com as colunas Bem ou Placa.");
  }

  async function publishReport(event) {
    event.preventDefault();
    const file = fileInput.files[0];
    const token = tokenInput.value.trim();
    if (!file || !token) return;
    if (!window.XLSX) {
      importMessage.className = "import-message is-error";
      importMessage.textContent = "A biblioteca de leitura do Excel não carregou. Atualize a página e tente novamente.";
      return;
    }
    submitButton.disabled = true;
    submitButton.querySelector("span").textContent = "Lendo relatório...";
    importMessage.className = "import-message";
    importMessage.textContent = "Lendo planilha e agrupando veículos...";
    try {
      const workbook = window.XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const rows = workbookRows(workbook);
      const vehicles = normalizeReport(rows);
      if (!vehicles.length) throw new Error("Não encontrei veículos com código do bem ou placa.");
      const response = await fetch("/api/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ vehicles: vehicles })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao publicar o relatório.");
      importMessage.className = "import-message is-success";
      importMessage.textContent = vehicles.length + " veículos atualizados. Abrindo painel...";
      tokenInput.value = "";
      await loadFleet();
      window.setTimeout(() => {
        if (dialog.open) dialog.close();
        fileInput.value = "";
        one("#file-label").textContent = "Escolher relatório Excel";
        submitButton.querySelector("span").textContent = "Publicar atualização";
        updateImportButton();
      }, 700);
    } catch (error) {
      importMessage.className = "import-message is-error";
      importMessage.textContent = error && error.message ? error.message : "Não foi possível importar esse relatório.";
      submitButton.querySelector("span").textContent = "Publicar atualização";
      updateImportButton();
    }
  }

  one("#open-import").addEventListener("click", openImport);
  one("#close-import").addEventListener("click", () => dialog.close());
  one("#import-form").addEventListener("submit", publishReport);
  fileInput.addEventListener("change", () => {
    one("#file-label").textContent = fileInput.files.length ? fileInput.files[0].name : "Escolher relatório Excel";
    updateImportButton();
  });
  tokenInput.addEventListener("input", updateImportButton);
  one("#search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    renderGrid();
  });
  one("#sort-button").addEventListener("click", (event) => {
    state.nearestFirst = !state.nearestFirst;
    event.currentTarget.querySelector("span").textContent = state.nearestFirst ? "Mais próximos" : "A–Z";
    renderGrid();
  });
  many(".filter-chip").forEach((button) => button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    many(".filter-chip").forEach((item) => item.classList.toggle("is-active", item === button));
    renderGrid();
  }));
  one("#vehicle-grid").addEventListener("click", (event) => {
    const card = event.target.closest("[data-vehicle-id]");
    if (!card) return;
    state.selectedId = card.dataset.vehicleId;
    renderFeature();
    renderGrid();
  });
  one("#vehicle-grid").addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest("[data-vehicle-id]");
    if (!card) return;
    event.preventDefault();
    state.selectedId = card.dataset.vehicleId;
    renderFeature();
    renderGrid();
  });
  one("#selected-panel").addEventListener("click", (event) => {
    if (event.target.closest("[data-open-import]")) openImport();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && !event.ctrlKey && !event.metaKey && !event.altKey && !/input|textarea/i.test(document.activeElement.tagName)) {
      event.preventDefault();
      one("#search-input").focus();
    }
    if (event.key === "Escape" && dialog.open) dialog.close();
  });

  loadFleet();
})();

