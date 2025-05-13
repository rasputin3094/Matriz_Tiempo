// js/main.js

// --- Variables globales ---
let timeline, items, groups;
let nextGroupId = 1, nextEventId = 1;
let audioFiles = [];

const LS_ITEMS = "timeline_items";
const LS_GROUPS = "timeline_groups";
const LS_RANGE = "timeline_range";

let autoSaveInterval = null;

const controlSelectors = [
	"#btnOpenModal",
	"#btnAddEvento",
	"#btnExportar",
	"#btnImportar",
	"#btnLimpiar",
	"#btnNavBack",
	"#btnNavForward",
	"#btnZoomIn",
	"#btnZoomOut",
	"#btnNow"
];

// Carga dinámica de los MP3 desde /music/
async function loadAudioFiles() {
	try {
		const res = await fetch("music/");
		const text = await res.text();
		const doc = new DOMParser().parseFromString(text, "text/html");
		audioFiles = Array.from(doc.querySelectorAll("a"))
			.map(a => a.href.split("/").pop())
			.filter(name => name.endsWith(".mp3"));
	} catch (err) {
		console.error("Error al listar audio:", err);
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	// Inicializar DataSets
	items = new vis.DataSet();
	groups = new vis.DataSet();

	// Cargar archivos de audio
	await loadAudioFiles();

	// Limpiar inputs de fecha
	document.getElementById("fechaInicio").value = "";
	document.getElementById("fechaFin").value = "";

	// ─ Abrir modal Grupos ─
	document.getElementById("btnOpenModal").onclick = () => {
		if (!document.querySelector("#contenedorGrupos .col-12")) {
			agregarGrupoCard();
		}
	};
	document.getElementById("btnAddGrupo")
		.addEventListener("click", e => { e.preventDefault(); agregarGrupoCard(); });
	document.getElementById("formGrupos")
		.addEventListener("submit", onGuardarGrupos);

	// ─ Abrir modal Eventos ─
	document.getElementById("btnAddEvento").onclick = () => {
		fillGrupoSelect();
		clearEventosContainer();
		agregarEventoRow();
	};
	document.getElementById("btnAddEventoRow").onclick = e => {
		e.preventDefault();
		agregarEventoRow();
	};
	document.getElementById("formEventos")
		.addEventListener("submit", onGuardarEventos);

	// ─ Lógica de habilitación tras elegir Grupo ─
	document.getElementById("selectGrupo").onchange = onGrupoChange;
	// ─ Reset modal al cerrarlo ─
	document.getElementById("modalEventos")
		.addEventListener("hidden.bs.modal", resetModalEventos);

	// ─ Fechas → generar timeline ─
	document.getElementById("form-fechas")
		.addEventListener("submit", onCargarFechas);

	// ─ Export / Import / Limpiar ─
	document.getElementById("btnExportar").addEventListener("click", exportarJSON);
	document.getElementById("btnImportar").addEventListener("change", importarJSON);
	document.getElementById("btnLimpiar").addEventListener("click", limpiarTodo);

	// ─ Navegación / Zoom ─
	document.getElementById("btnNavBack").onclick = () => moverVentana(-1);
	document.getElementById("btnNavForward").onclick = () => moverVentana(1);
	document.getElementById("btnZoomIn").onclick = () => hacerZoom(0.5);
	document.getElementById("btnZoomOut").onclick = () => hacerZoom(2);
	document.getElementById("btnNow").onclick = centrarEnAhora;

	// ─ Cargar de localStorage si existe ─
	const hasSaved = localStorage.getItem(LS_ITEMS) || localStorage.getItem(LS_GROUPS);
	if (hasSaved) {
		cargarDesdeLocalStorage();
		setControlsDisabled(false);
	} else {
		setControlsDisabled(true);
		generarTimeline(new Date(), new Date(Date.now() + 2 * 3600000));
	}

	iniciarAutoGuardado();
});

function setControlsDisabled(disabled) {
	controlSelectors.forEach(sel => {
		document.querySelectorAll(sel).forEach(btn => btn.disabled = disabled);
	});
}
function iniciarAutoGuardado() {
	if (autoSaveInterval) clearInterval(autoSaveInterval);
	autoSaveInterval = setInterval(guardarEnLocalStorage, 10000);
}

// — Función para habilitar controles y setear color al elegir Grupo —
function onGrupoChange() {
	const gid = +this.value;
	const selU = document.getElementById("selectUnidad");
	const btnRow = document.getElementById("btnAddEventoRow");
	const btnSave = document.querySelector("#formEventos button[type='submit']");

	// habilitar/deshabilitar
	selU.disabled = !gid;
	btnRow.disabled = !gid;
	btnSave.disabled = !gid;

	// actualizar color por defecto de los pickers
	let baseColor = "#ffffff";
	if (gid) {
		const style = groups.get(gid).style || "";
		const m = style.match(/#([0-9A-Fa-f]{6})/);
		if (m) baseColor = m[0];
	}
	document.querySelectorAll(".evento-color")
		.forEach(i => i.value = baseColor);

	// recargar unidades
	fillUnidadSelect(gid);
}

// — Reset completo del modal de Eventos al cerrar —
function resetModalEventos() {
	document.getElementById("formEventos").reset();
	clearEventosContainer();
	document.getElementById("selectUnidad").disabled = true;
	document.getElementById("btnAddEventoRow").disabled = true;
	document.querySelector("#formEventos button[type='submit']").disabled = true;
}

// — Configurar Grupos —
function agregarGrupoCard() {
	const gid = nextGroupId++;
	const cont = document.getElementById("contenedorGrupos");
	const color = generarColorClaro();

	const col = document.createElement("div");
	col.className = "col-12 mb-3";
	col.dataset.grupoId = gid;
	col.innerHTML = `
    <div class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex mb-3">
          <input type="text" class="form-control me-2 nombre-grupo" placeholder="Nombre del Grupo" required>
          <input type="color" class="form-control form-control-color me-2 color-grupo" value="${color}">
          <button type="button" class="btn btn-outline-danger btn-sm btnRemoveGrupo">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
        <ul class="list-group lista-unidades mb-3"></ul>
        <button type="button" class="btn btn-outline-secondary btn-sm btnAddUnidad">
          <i class="fas fa-plus me-1"></i>Agregar Unidad
        </button>
      </div>
    </div>`
		;
	col.querySelector(".btnRemoveGrupo").onclick = () => col.remove();
	col.querySelector(".btnAddUnidad").onclick = () => {
		const ul = col.querySelector(".lista-unidades");
		const li = document.createElement("li");
		li.className = "list-group-item d-flex align-items-center";
		li.innerHTML = `
      <input type="text" class="form-control form-control-sm nombre-unidad me-2"
             placeholder="Nombre de la unidad" required>
      <button type="button" class="btn btn-outline-danger btn-sm btnRemoveUnidad">
        <i class="fas fa-times"></i>
      </button>`;
		li.querySelector(".btnRemoveUnidad").onclick = () => li.remove();
		ul.appendChild(li);
	};
	cont.appendChild(col);
}
function onGuardarGrupos(e) {
	e.preventDefault();
	groups.clear();
	const arr = [];
	document.querySelectorAll("#contenedorGrupos [data-grupo-id]").forEach(col => {
		const gid = +col.dataset.grupoId;
		const gName = col.querySelector(".nombre-grupo").value.trim();
		if (!gName) return;
		let color = col.querySelector(".color-grupo").value;
		const [r, g, b] = color.match(/[A-Fa-f0-9]{2}/g).map(h => parseInt(h, 16));
		if (!esColorClaro(r, g, b)) color = generarColorClaro();
		const nested = [];
		col.querySelectorAll(".nombre-unidad").forEach((inp, i) => {
			const u = inp.value.trim();
			if (!u) return;
			const uid = gid * 100 + i + 1;
			nested.push(uid);
			arr.push({ id: uid, content: u, treeLevel: 2, style: `background-color:${color}` });
		});
		arr.push({
			id: gid,
			content: `<strong>${gName}</strong>`,
			treeLevel: 1,
			nestedGroups: nested,
			style: `background-color:${color}`
		});
	});
	groups.add(arr);
	timeline.setGroups(groups);
	bootstrap.Modal.getInstance(document.getElementById("modalGrupos")).hide();
}

// — Configurar Eventos —
function fillGrupoSelect() {
	const sel = document.getElementById("selectGrupo");
	sel.innerHTML = `<option value="">-- Elige grupo --</option>`;
	groups.get({ filter: g => g.treeLevel === 1 })
		.forEach(g => sel.innerHTML += `<option value="${g.id}">${stripTags(g.content)}</option>`);
}
function fillUnidadSelect(gid) {
	const sel = document.getElementById("selectUnidad");
	sel.innerHTML = `<option value="">-- Elige unidad --</option>`;
	groups.get({ filter: u => u.treeLevel === 2 && String(u.id).startsWith(String(gid)) })
		.forEach(u => sel.innerHTML += `<option value="${u.id}">${u.content}</option>`);
}
function clearEventosContainer() {
	document.getElementById("eventosContainer").innerHTML = "";
}

// — Agregar fila de Evento (play/pause con <i>) —
function agregarEventoRow() {
	const gid = +document.getElementById("selectGrupo").value;
	let defaultColor = "#ffffff";
	if (gid) {
		const st = groups.get(gid).style || "";
		const m = st.match(/#([0-9A-Fa-f]{6})/);
		if (m) defaultColor = m[0];
	}

	const cont = document.getElementById("eventosContainer");
	const row = document.createElement("div");
	row.className = "row g-2 align-items-end evento-row mb-2";
	row.innerHTML = `
    <div class="col-md-4">
      <label class="form-label">Título</label>
      <input type="text" class="form-control evento-titulo" required>
    </div>
    <div class="col-md-1">
      <label class="form-label">Color</label>
      <input type="color" class="form-control form-control-color evento-color" value="${defaultColor}">
    </div>
    <div class="col-md-2">
      <label class="form-label">Inicio</label>
      <input type="datetime-local" class="form-control evento-fecha-inicio" required>
    </div>
    <div class="col-md-2">
      <label class="form-label">Fin</label>
      <input type="datetime-local" class="form-control evento-fecha-fin" required>
    </div>
    <div class="col-md-2 d-flex align-items-center">
      <div class="form-check mt-4">
        <input class="form-check-input evento-alerta" type="checkbox">
        <label class="form-check-label ms-1">Alerta</label>
      </div>
    </div>
    <div class="col-md-1 d-flex align-items-center">
      <button type="button" class="btn btn-outline-danger btn-sm btnRemoveEvento">
        <i class="fas fa-times"></i>
      </button>
    </div>
    <div class="col-md-12 d-flex align-items-center">
      <select class="form-select evento-audio me-2" style="display:none; width:auto;">
        <option value="">Seleccione alarma</option>
        ${audioFiles.map(f => `<option value="${f}">${f}</option>`).join("")}
      </select>
      <button type="button" class="btn btn-outline-secondary btn-sm btnPlayAudio" disabled style="display:none;">
        <i class="fas fa-play"></i>
      </button>
    </div>`
		;

	const chk = row.querySelector(".evento-alerta");
	const sel = row.querySelector(".evento-audio");
	const btn = row.querySelector(".btnPlayAudio");
	const audio = new Audio();

	// toggle de alerta
	chk.onchange = () => {
		const show = chk.checked;
		sel.style.display = show ? "" : "none";
		btn.style.display = show ? "" : "none";
		if (!show) {
			audio.pause();
			btn.disabled = true;
			btn.querySelector("i").className = "fas fa-play";
		}
	};
	// habilitar Play cuando elige audio
	sel.onchange = () => {
		if (sel.value) {
			btn.disabled = false;
			audio.src = `music/${sel.value}`;
			const svg = btn.querySelector("svg.svg-inline--fa");
			if (svg) {
				svg.classList.remove("fa-pause");
				svg.classList.add("fa-play");
			}
		} else {
			btn.disabled = true;
		}
	};
	// Play / Pause toggle sobre el <svg>
	btn.onclick = () => {
		const svg = btn.querySelector("svg.svg-inline--fa");
		if (audio.paused) {
			audio.play();
			if (svg) svg.classList.replace("fa-play", "fa-pause");
		} else {
			audio.pause();
			if (svg) svg.classList.replace("fa-pause", "fa-play");
		}
	};
	// eliminar fila
	row.querySelector(".btnRemoveEvento").onclick = () => {
		audio.pause();
		row.remove();
	};

	cont.appendChild(row);
}

function onGuardarEventos(e) {
	e.preventDefault();
	const uid = +document.getElementById("selectUnidad").value;

	document.querySelectorAll(".evento-row").forEach(row => {
		const color = row.querySelector(".evento-color").value;
		const t = row.querySelector(".evento-titulo").value.trim();
		const si = row.querySelector(".evento-fecha-inicio").value;
		const sf = row.querySelector(".evento-fecha-fin").value;
		const al = row.querySelector(".evento-alerta").checked;
		const aud = row.querySelector(".evento-audio").value;

		const start = new Date(si);
		const end = new Date(sf);

		items.add({
			id: nextEventId++,
			group: uid,
			content: t,
			start, end,
			type: 'range',
			style: `background-color:${color};`
		});

		if (al && aud) {
			toastr.error(t, '¡Alerta de evento!', { positionClass: 'toast-bottom-right' });
			new Audio(`music/${aud}`).play();
		}
	});

	timeline.setItems(items);
	guardarEnLocalStorage();
	bootstrap.Modal.getInstance(document.getElementById("modalEventos")).hide();
}

// — Cargar fechas y extender fin un día completo —
function onCargarFechas(e) {
	e.preventDefault();
	const iniRaw = new Date(document.getElementById("fechaInicio").value + "T00:00");
	const finRaw = new Date(document.getElementById("fechaFin").value + "T00:00");
	if (isNaN(iniRaw) || isNaN(finRaw) || finRaw < iniRaw) {
		return alert("La fecha final debe ser igual o posterior a la inicial.");
	}
	const fin = new Date(finRaw);
	fin.setDate(fin.getDate() + 1);
	generarTimeline(iniRaw, fin);
	setControlsDisabled(false);
}

// — Generar timeline —
function generarTimeline(start, end) {
	if (isNaN(start) || isNaN(end) || end - start < 2 * 3600000) {
		start = new Date(); end = new Date(start.getTime() + 2 * 3600000);
	}
	const oldI = items ? items.get() : [];
	const oldG = groups ? groups.get() : [];
	items = new vis.DataSet(oldI);
	groups = new vis.DataSet(oldG);

	const opts = {
		start, end, min: start, max: end,
		showCurrentTime: true, zoomable: true, moveable: true,
		editable: { add: false, updateTime: false, updateGroup: false },
		groupOrder: "content", orientation: { axis: "top" },
		timeAxis: { scale: "hour", step: 2 }, margin: { item: { horizontal: 15 }, axis: 5 }
	};

	if (timeline) timeline.destroy();
	timeline = new vis.Timeline(document.getElementById("visualization"), items, groups, opts);
}

function exportarJSON() {
	const data = { items: items.get(), groups: groups.get() };
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
	a.download = "timeline_export.json"; a.click();
}

function importarJSON(e) {
	const f = e.target.files[0]; if (!f) return;
	const r = new FileReader(); r.onload = ev => {
		try {
			const d = JSON.parse(ev.target.result);
			items.clear(); groups.clear();
			items.add(d.items || []); groups.add(d.groups || []);
			// recalc nextEventId
			const all = items.getIds().map(i => Number(i));
			nextEventId = all.length ? Math.max(...all) + 1 : 1;
			cargarDesdeLocalStorage();
			setControlsDisabled(false);
		} catch { alert("JSON inválido"); }
	}; r.readAsText(f);
}

function limpiarTodo() {
	localStorage.removeItem(LS_ITEMS);
	localStorage.removeItem(LS_GROUPS);
	localStorage.removeItem(LS_RANGE);
	items.clear(); groups.clear();
	generarTimeline(new Date(), new Date(Date.now() + 2 * 3600000));
	setControlsDisabled(true);
}

function guardarEnLocalStorage() {
	localStorage.setItem(LS_ITEMS, JSON.stringify(items.get()));
	localStorage.setItem(LS_GROUPS, JSON.stringify(groups.get()));
	if (timeline) {
		const w = timeline.getWindow();
		localStorage.setItem(LS_RANGE, JSON.stringify({ start: w.start, end: w.end }));
	}
}

function cargarDesdeLocalStorage() {
	const si = localStorage.getItem(LS_ITEMS),
		sg = localStorage.getItem(LS_GROUPS),
		sr = localStorage.getItem(LS_RANGE);
	items = new vis.DataSet(si ? JSON.parse(si) : []);
	groups = new vis.DataSet(sg ? JSON.parse(sg) : []);
	// recalc nextEventId
	const all = items.getIds().map(i => Number(i));
	nextEventId = all.length ? Math.max(...all) + 1 : 1;
	const start = sr ? new Date(JSON.parse(sr).start) : new Date(),
		end = sr ? new Date(JSON.parse(sr).end) : new Date(start.getTime() + 2 * 3600000);
	document.getElementById("fechaInicio").value = start.toISOString().slice(0, 10);
	document.getElementById("fechaFin").value = end.toISOString().slice(0, 10);
	generarTimeline(start, end);
}

function moverVentana(d) {
	if (!timeline) return;
	const w = timeline.getWindow();
	timeline.setWindow(
		new Date(w.start.getTime() + d * 86400000),
		new Date(w.end.getTime() + d * 86400000)
	);
}

function hacerZoom(f) {
	if (!timeline) return;
	const w = timeline.getWindow(),
		span = w.end - w.start,
		mid = new Date((w.start.getTime() + w.end.getTime()) / 2);
	timeline.setWindow(
		new Date(mid.getTime() - span * f / 2),
		new Date(mid.getTime() + span * f / 2)
	);
}

function centrarEnAhora() {
	if (timeline) timeline.moveTo(new Date());
}

// utilidades
function stripTags(html) {
	const tmp = document.createElement("div");
	tmp.innerHTML = html;
	return tmp.textContent || tmp.innerText;
}
function generarColorClaro() {
	let r, g, b;
	do {
		r = Math.floor(Math.random() * 256);
		g = Math.floor(Math.random() * 256);
		b = Math.floor(Math.random() * 256);
	} while (0.299 * r + 0.587 * g + 0.114 * b <= 180);
	return `#${r.toString(16).padStart(2, "0")}
		+ ${g.toString(16).padStart(2, "0")}
		+ ${b.toString(16).padStart(2, "0")};`
}
function esColorClaro(r, g, b) {
	return (0.299 * r + 0.587 * g + 0.114 * b) > 180;
}