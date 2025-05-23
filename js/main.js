// js/main.js

// --- Variables globales ---
let timeline, items, groups;
let nextGroupId = 1, nextEventId = 1;
let audioFiles = [];

// Claves para localStorage
const LS_ITEMS = "timeline_items";
const LS_GROUPS = "timeline_groups";
const LS_RANGE = "timeline_range";

let autoSaveInterval = null;
const controlSelectors = [
	"#btnOpenModal",
	"#btnEditGrupos",
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

// Para programar alertas futuras
let alertTimeouts = [];

// Estado de edición de grupos
let editingGroups = false;
let currentEditGroupId = null;

/**
 * Programa una alerta visual y sonora para un evento futuro
 * @param {{id:number,content:string,start:Date,alerta:boolean,audio:string}} evt
 */
function scheduleAlert(evt) {
	if (!evt.alerta || !evt.audio) return;
	const now = Date.now();
	const startTime = new Date(evt.start).getTime();
	const delay = startTime - now;
	if (delay <= 0) return; // ya pasó o es inmediato
	const timeoutId = setTimeout(() => {
		toastr.error(evt.content, '¡Alerta de evento!', { positionClass: 'toast-bottom-right' });
		new Audio(`music/${evt.audio}`).play();
	}, delay);
	alertTimeouts.push(timeoutId);
}

/** Cancela todas las alertas programadas */
function clearScheduledAlerts() {
	alertTimeouts.forEach(id => clearTimeout(id));
	alertTimeouts = [];
}

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

	// ─ Botón Agregar Grupos ─
	document.getElementById("btnOpenModal").onclick = () => {
		editingGroups = false;
		currentEditGroupId = null;
		document.getElementById("btnAddGrupo").style.display = "";
		document.getElementById("contenedorGrupos").innerHTML = "";
		// Agregar un card en blanco
		agregarGrupoCard();
		new bootstrap.Modal(document.getElementById("modalGrupos")).show();
	};

	const modalGruposEl = document.getElementById("modalGrupos");
	modalGruposEl.addEventListener("hidden.bs.modal", () => {
		// Quitar la clase que bloquea el scroll al body
		document.body.classList.remove("modal-open");
		// Eliminar todos los backdrops que hayan quedado
		document.querySelectorAll(".modal-backdrop").forEach(el => el.remove());
	});

	// ─ Botón Editar Grupos ─
	document.getElementById("btnEditGrupos").onclick = () => {
		editingGroups = true;
		currentEditGroupId = null;
		document.getElementById("btnAddGrupo").style.display = "";
		const cont = document.getElementById("contenedorGrupos");
		cont.innerHTML = "";
		groups.get({ filter: g => g.treeLevel === 1 }).forEach(g => {
			crearGrupoCardDesdeData(g.id, stripTags(g.content), g.style, g.nestedGroups);
		});
		new bootstrap.Modal(document.getElementById("modalGrupos")).show();
	};

	// ─ Guardar Grupos (añadir o editar) ─
	document.getElementById("btnAddGrupo").addEventListener("click", e => {
		e.preventDefault();
		agregarGrupoCard();
	});
	document.getElementById("formGrupos").addEventListener("submit", onGuardarGrupos);

	// ─ Botón Agregar Eventos ─
	document.getElementById("btnAddEvento").onclick = () => {
		fillGrupoSelect();
		clearEventosContainer();
		agregarEventoRow();
	};
	document.getElementById("btnAddEventoRow").onclick = e => {
		e.preventDefault();
		agregarEventoRow();
	};
	document.getElementById("formEventos").addEventListener("submit", onGuardarEventos);

	// ─ Habilitación tras elegir Grupo en modal Eventos ─
	document.getElementById("selectGrupo").onchange = onGrupoChange;
	document.getElementById("modalEventos").addEventListener("hidden.bs.modal", resetModalEventos);

	// ─ Fechas → generar timeline ─
	document.getElementById("form-fechas").addEventListener("submit", onCargarFechas);

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
		generarTimeline(new Date(), new Date(Date.now() + 2 * 3600_000));
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
	autoSaveInterval = setInterval(guardarEnLocalStorage, 10_000);
}

// ─ Habilitar controles y setear color tras elegir Grupo ─
function onGrupoChange() {
	const gid = +this.value;
	const selU = document.getElementById("selectUnidad");
	const btnRow = document.getElementById("btnAddEventoRow");
	const btnSave = document.querySelector("#formEventos button[type='submit']");

	selU.disabled = !gid;
	btnRow.disabled = !gid;
	btnSave.disabled = !gid;

	let baseColor = "#ffffff";
	if (gid) {
		const style = groups.get(gid).style || "";
		const m = style.match(/#([0-9A-Fa-f]{6})/);
		if (m) baseColor = m[0];
	}
	document.querySelectorAll(".evento-color").forEach(i => i.value = baseColor);

	fillUnidadSelect(gid);
}

// ─ Reset modal Eventos al cerrarlo ─
function resetModalEventos() {
	document.getElementById("formEventos").reset();
	clearEventosContainer();
	document.getElementById("selectUnidad").disabled = true;
	document.getElementById("btnAddEventoRow").disabled = true;
	document.querySelector("#formEventos button[type='submit']").disabled = true;
}

// ─ Agregar tarjeta en modal Grupos ─
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
        <button type="button" class="btn btn-outline-secondary btn-sm w-100 btnAddUnidad">
          <i class="fas fa-plus me-1"></i>Agregar Unidad
        </button>
      </div>
    </div>
  `;
	// Borrar tarjeta
	col.querySelector(".btnRemoveGrupo").onclick = () => {
		Swal.fire({
			title: '¿Eliminar este grupo?',
			text: 'Se borrarán sus unidades y eventos.',
			icon: 'warning',
			showCancelButton: true,
			confirmButtonText: 'Sí, eliminar'
		}).then(res => {
			if (res.isConfirmed) {
				const gidNum = +col.dataset.grupoId;
				items.remove(it => String(it.group).startsWith(String(gidNum)));
				col.remove();
			}
		});
	};
	// Agregar unidad
	col.querySelector(".btnAddUnidad").onclick = () => {
		const ul = col.querySelector(".lista-unidades");
		const li = document.createElement("li");
		li.className = "list-group-item d-flex align-items-center";
		li.innerHTML = `
      <input type="text" class="form-control form-control-sm nombre-unidad me-2" placeholder="Nombre de la unidad" required>
      <button type="button" class="btn btn-outline-danger btn-sm btnRemoveUnidad">
        <i class="fas fa-times"></i>
      </button>
    `;
		li.querySelector(".btnRemoveUnidad").onclick = () => {
			Swal.fire({
				title: '¿Eliminar esta unidad?',
				text: 'Se borrarán sus eventos.',
				icon: 'warning',
				showCancelButton: true,
				confirmButtonText: 'Sí, eliminar'
			}).then(res => {
				if (res.isConfirmed) {
					const idx = Array.from(ul.children).indexOf(li);
					const uid = gid * 100 + idx + 1;
					items.remove(it => it.group === uid);
					li.remove();
				}
			});
		};
		ul.appendChild(li);
	};

	cont.appendChild(col);
}

// ─ Guardar o actualizar Grupos ─
function onGuardarGrupos(e) {
	e.preventDefault();

	// Edición de un solo grupo
	if (editingGroups && currentEditGroupId !== null) {
		const col = document.querySelector(`[data-grupo-id="${currentEditGroupId}"]`);
		const gName = col.querySelector(".nombre-grupo").value.trim();
		let color = col.querySelector(".color-grupo").value;
		const [r, g, b] = color.match(/[A-Fa-f0-9]{2}/g).map(h => parseInt(h, 16));
		if (!esColorClaro(r, g, b)) color = generarColorClaro();

		// Eliminar antiguas unidades y eventos
		const oldNested = groups.get(currentEditGroupId).nestedGroups || [];
		oldNested.forEach(uid => {
			items.remove(it => it.group === uid);
			groups.remove(uid);
		});

		// Nuevo nested
		const newUnits = [];
		col.querySelectorAll(".nombre-unidad").forEach((inp, i) => {
			const u = inp.value.trim();
			if (!u) return;
			newUnits.push(currentEditGroupId * 100 + i + 1);
		});

		// Actualizar padre
		groups.update({
			id: currentEditGroupId,
			content: `<strong>${gName}</strong>`,
			nestedGroups: newUnits,
			style: `background-color:${color}`
		});

		// Añadir unidades
		newUnits.forEach((uid, i) => {
			const name = col.querySelectorAll(".nombre-unidad")[i].value.trim();
			groups.add({
				id: uid,
				content: name,
				treeLevel: 2,
				style: `background-color:${color}`
			});
		});

		timeline.setGroups(groups);
		bootstrap.Modal.getInstance(document.getElementById("modalGrupos")).hide();
		guardarEnLocalStorage();
		return;
	}

	// Modo batch (crear/reemplazar todos)
	// groups.clear();
	const arr = [];
	let orden = 0;
	document.querySelectorAll("#contenedorGrupos [data-grupo-id]").forEach(col => {
		const gid = +col.dataset.grupoId;
		const gName = col.querySelector(".nombre-grupo").value.trim();
		if (!gName) return;
		let color = col.querySelector(".color-grupo").value;
		// const [r, g, b] = color.match(/[A-Fa-f0-9]{2}/g).map(h => parseInt(h, 16));
		// if (!esColorClaro(r, g, b)) color = generarColorClaro();
		const nested = [];
		col.querySelectorAll(".nombre-unidad").forEach((inp, i) => {
			const u = inp.value.trim();
			if (!u) return;
			const uid = gid * 100 + i + 1;
			nested.push(uid);
			arr.push({
				id: uid,
				content: u,
				treeLevel: 2,
				style: `background-color:${color}`,
				order: orden + i + 1 // no estrictamente necesario para subgrupos
			});
		});
		arr.push({
			id: gid,
			content: `<strong>${gName}</strong>`,
			treeLevel: 1,
			nestedGroups: nested,
			style: `background-color:${color}`,
			order: orden
		});
		orden++;
	});
	groups.add(arr);
	timeline.setGroups(groups);
	bootstrap.Modal.getInstance(document.getElementById("modalGrupos")).hide();
	guardarEnLocalStorage();
}

// ─ Plantilla para crear tarjeta desde datos ─
function crearGrupoCardDesdeData(gid, nombre, style, nestedIds) {
	const cont = document.getElementById("contenedorGrupos");
	const colorMatch = style.match(/#([0-9A-Fa-f]{6})/);
	const color = colorMatch ? colorMatch[0] : generarColorClaro();

	const col = document.createElement("div");
	col.className = "col-12 mb-3";
	col.dataset.grupoId = gid;
	col.innerHTML = `
    <div class="card shadow-sm">
      <div class="card-body">
        <div class="d-flex mb-3">
          <input type="text" class="form-control me-2 nombre-grupo" value="${nombre}" required>
          <input type="color" class="form-control form-control-color me-2 color-grupo" value="${color}">
          <button type="button" class="btn btn-outline-danger btn-sm btnRemoveGrupo">
            <i class="fas fa-trash-alt"></i>
          </button>
          <button type="button" class="btn btn-outline-secondary btn-sm btnEditThis">
            <i class="fas fa-edit"></i>
          </button>
        </div>
        <ul class="list-group lista-unidades mb-3"></ul>
        <button type="button" class="btn btn-outline-secondary btn-sm btnAddUnidad w-100">
          <i class="fas fa-plus me-1"></i>Agregar Unidad
        </button>
      </div>
    </div>
  `;
	// Eliminar grupo
	col.querySelector(".btnRemoveGrupo").onclick = () => {
		Swal.fire({
			title: '¿Eliminar este grupo?',
			text: 'Se borrarán sus unidades y eventos.',
			icon: 'warning',
			showCancelButton: true
		}).then(res => {
			if (res.isConfirmed) {
				items.remove(it => it.group.toString().startsWith(gid.toString()));
				groups.remove({ id: gid });
				col.remove();
			}
		});
	};
	// Editar solo este grupo
	col.querySelector(".btnEditThis").onclick = () => abrirModalEdicionGrupo(gid);
	// Agregar unidad
	col.querySelector(".btnAddUnidad").onclick = () => {
		const ul = col.querySelector(".lista-unidades");
		const li = document.createElement("li");
		li.className = "list-group-item d-flex align-items-center";
		li.innerHTML = `
      <input type="text" class="form-control form-control-sm nombre-unidad me-2" placeholder="Nombre de la unidad" required>
      <button type="button" class="btn btn-outline-danger btn-sm btnRemoveUnidad">
        <i class="fas fa-times"></i>
      </button>`;
		li.querySelector(".btnRemoveUnidad").onclick = () => {
			Swal.fire({
				title: '¿Eliminar esta unidad?',
				text: 'Se borrarán sus eventos.',
				icon: 'warning',
				showCancelButton: true
			}).then(res => {
				if (res.isConfirmed) {
					const idx = Array.from(ul.children).indexOf(li);
					const uid = gid * 100 + idx + 1;
					items.remove(it => it.group === uid);
					li.remove();
				}
			});
		};
		ul.appendChild(li);
	};
	// Cargar subunidades existentes
	const ul = col.querySelector(".lista-unidades");
	nestedIds.forEach(uid => {
		const unidad = groups.get(uid);
		if (!unidad) return;
		const li = document.createElement("li");
		li.className = "list-group-item d-flex align-items-center";
		li.innerHTML = `
      <input type="text" class="form-control form-control-sm nombre-unidad me-2" value="${unidad.content}" required>
      <button type="button" class="btn btn-outline-danger btn-sm btnRemoveUnidad">
        <i class="fas fa-times"></i>
      </button>`;
		li.querySelector(".btnRemoveUnidad").onclick = () => {
			Swal.fire({
				title: '¿Eliminar esta unidad?',
				text: 'Se borrarán sus eventos.',
				icon: 'warning',
				showCancelButton: true
			}).then(res => {
				if (res.isConfirmed) {
					items.remove(it => it.group === uid);
					li.remove();
				}
			});
		};
		ul.appendChild(li);
	});

	cont.appendChild(col);
}

// ─ Abrir modal para editar un grupo existente ─
function abrirModalEdicionGrupo(gid) {
	editingGroups = true;
	currentEditGroupId = gid;
	document.getElementById("btnAddGrupo").style.display = "none";
	const cont = document.getElementById("contenedorGrupos");
	cont.innerHTML = "";
	const g = groups.get(gid);
	crearGrupoCardDesdeData(gid, stripTags(g.content), g.style, g.nestedGroups || []);
	new bootstrap.Modal(document.getElementById("modalGrupos")).show();
}

// ─ Persistencia en LocalStorage ─
function guardarEnLocalStorage() {
	localStorage.setItem(LS_ITEMS, JSON.stringify(items.get()));
	localStorage.setItem(LS_GROUPS, JSON.stringify(groups.get()));
	if (timeline) {
		const w = timeline.getWindow();
		localStorage.setItem(LS_RANGE, JSON.stringify({ start: w.start, end: w.end }));
	}
}

// ─ Exportar JSON ─
function exportarJSON() {
	const range = timeline.getWindow();
	const data = {
		items: items.get(),
		groups: groups.get(),
		range: {
			start: range.start.toISOString(),
			end: range.end.toISOString()
		}
	};
	const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
	const a = document.createElement("a");
	a.href = URL.createObjectURL(blob);
	a.download = "timeline_export.json";
	a.click();
}

// ─ Importar JSON ─
function importarJSON(e) {
	const f = e.target.files[0];
	if (!f) return;
	const r = new FileReader();
	r.onload = ev => {
		try {
			const d = JSON.parse(ev.target.result);
			items.clear();
			groups.clear();
			items.add(d.items || []);
			groups.add(d.groups || []);
			const all = items.getIds().map(i => Number(i));
			nextEventId = all.length ? Math.max(...all) + 1 : 1;

			// Establecer rango de fechas si viene
			let start = new Date();
			let end = new Date(start.getTime() + 2 * 3600_000);
			if (d.range?.start && d.range?.end) {
				start = new Date(d.range.start);
				end = new Date(d.range.end);
			}

			document.getElementById("fechaInicio").value = start.toISOString().slice(0, 10);
			document.getElementById("fechaFin").value = end.toISOString().slice(0, 10);

			generarTimeline(start, end);
			setControlsDisabled(false);
			clearScheduledAlerts();
			items.get().forEach(evt => scheduleAlert(evt));
		} catch {
			alert("JSON inválido");
		}
	};
	r.readAsText(f);
}


function limpiarTodo() {
	// Cancelar alertas activas
	clearScheduledAlerts();

	// Borrar LocalStorage
	localStorage.removeItem(LS_ITEMS);
	localStorage.removeItem(LS_GROUPS);
	localStorage.removeItem(LS_RANGE);

	// Limpiar datasets
	items.clear();
	groups.clear();

	// Vaciar inputs de fecha
	document.getElementById("fechaInicio").value = "";
	document.getElementById("fechaFin").value = "";

	// Limpiar selects del modal de eventos
	document.getElementById("selectGrupo").innerHTML = `<option value="">-- Elige grupo --</option>`;
	document.getElementById("selectUnidad").innerHTML = `<option value="">-- Elige unidad --</option>`;
	document.getElementById("selectUnidad").disabled = true;

	// Limpiar contenedor de eventos
	document.getElementById("eventosContainer").innerHTML = "";

	// Deshabilitar botones
	setControlsDisabled(true);

	// Regenerar timeline limpio
	generarTimeline(new Date(), new Date(Date.now() + 2 * 3600_000));
}


// ─ Modal Eventos: Guardar nuevos eventos ─
function onGuardarEventos(e) {
	e.preventDefault();
	const uid = +document.getElementById("selectUnidad").value;

	clearScheduledAlerts();
	// no removemos items aquí para soportar múltiple

	document.querySelectorAll(".evento-row").forEach(row => {
		const color = row.querySelector(".evento-color").value;
		const t = row.querySelector(".evento-titulo").value.trim();
		const si = row.querySelector(".evento-fecha-inicio").value;
		const sf = row.querySelector(".evento-fecha-fin").value;
		const al = row.querySelector(".evento-alerta").checked;
		const aud = row.querySelector(".evento-audio").value;

		const start = new Date(si);
		const end = new Date(sf);

		const evt = {
			id: nextEventId++,
			group: uid,
			content: t,
			start, end,
			type: 'range',
			style: `background-color:${color};`,
			alerta: al,
			audio: aud
		};
		items.add(evt);
		scheduleAlert(evt);
	});

	timeline.setItems(items);
	guardarEnLocalStorage();
	bootstrap.Modal.getInstance(document.getElementById("modalEventos")).hide();
}

// ─ Agregar fila de Evento en modal ─
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
    </div>
  `;
	const chk = row.querySelector(".evento-alerta");
	const sel = row.querySelector(".evento-audio");
	const btn = row.querySelector(".btnPlayAudio");
	const audio = new Audio();

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
	sel.onchange = () => {
		if (sel.value) {
			btn.disabled = false;
			audio.src = `music/${sel.value}`;
			btn.querySelector("i").classList.replace("fa-pause", "fa-play");
		} else {
			btn.disabled = true;
		}
	};
	btn.onclick = () => {
		const icon = btn.querySelector("i");
		if (audio.paused) {
			audio.play();
			icon.classList.replace("fa-play", "fa-pause");
		} else {
			audio.pause();
			icon.classList.replace("fa-pause", "fa-play");
		}
	};
	row.querySelector(".btnRemoveEvento").onclick = () => {
		audio.pause();
		row.remove();
	};

	cont.appendChild(row);
}

// ─ Manejo de fechas y recarga del timeline ─
function onCargarFechas(e) {
	e.preventDefault();
	const iniRaw = new Date(document.getElementById("fechaInicio").value + "T00:00");
	const finRaw = new Date(document.getElementById("fechaFin").value + "T00:00");
	if (isNaN(iniRaw) || isNaN(finRaw) || finRaw < iniRaw) {
		return alert("La fecha final debe ser igual o posterior a la inicial.");
	}
	const fin = new Date(finRaw);
	fin.setHours(23, 59, 59, 999);
	generarTimeline(iniRaw, fin);
	setControlsDisabled(false);
	guardarEnLocalStorage();
}

// ─ Generar o regenerar el timeline ─
function generarTimeline(start, end) {
	if (isNaN(start) || isNaN(end) || end - start < 2 * 3600_000) {
		start = new Date();
		end = new Date(start.getTime() + 2 * 3600_000);
	}
	const oldI = items ? items.get() : [];
	const oldG = groups ? groups.get() : [];
	items = new vis.DataSet(oldI);
	groups = new vis.DataSet(oldG);

	const opts = {
		start, end,
		min: start, max: end,
		showCurrentTime: true,
		zoomable: true,
		moveable: true,
		editable: { add: false, updateTime: false, updateGroup: false },
		// groupOrder: "content",
		groupOrder: (a, b) => (a.order ?? 0) - (b.order ?? 0),
		orientation: { axis: "top" },
		timeAxis: { scale: "hour", step: 2 },
		margin: { item: { horizontal: 15 }, axis: 5 }
	};

	if (timeline) timeline.destroy();
	timeline = new vis.Timeline(document.getElementById("visualization"), items, groups, opts);

	timeline.on("doubleClick", props => {
		if (props.item == null) return;

		const evt = items.get(props.item);
		if (!evt) return;

		document.getElementById("eventoId").value = evt.id;
		document.getElementById("nombreEvento").value = evt.content;
		document.getElementById("inicioEvento").value = toLocalDateTimeString(evt.start);
		document.getElementById("finEvento").value = toLocalDateTimeString(evt.end);
		document.getElementById("colorEvento").value = evt.style?.match(/#([0-9A-Fa-f]{6})/)?.[0] || "#ffffff";
		document.getElementById("alertaEvento").checked = !!evt.alerta;

		const fila = document.getElementById("filaAlerta");
		fila.style.display = evt.alerta ? "" : "none";
		const sel = document.getElementById("audioSelect");
		sel.innerHTML = '<option value="">Seleccione alarma</option>' + audioFiles.map(f => `<option value="${f}">${f}</option>`).join("");
		sel.value = evt.audio || "";
		document.getElementById("btnPlayAudio").disabled = !evt.audio;

		const unidad = groups.get(evt.group);
		const grupo = groups.get(+String(evt.group).slice(0, -2));
		document.getElementById("grupoEvento").value = grupo ? stripTags(grupo.content) : "Desconocido";
		document.getElementById("unidadEvento").value = unidad ? unidad.content : "Desconocido";

		new bootstrap.Modal(document.getElementById("modalEditarEvento")).show();
	});
}
function toLocalDateTimeString(date) {
	const d = new Date(date);
	const pad = n => n.toString().padStart(2, '0');
	const yyyy = d.getFullYear();
	const mm = pad(d.getMonth() + 1);
	const dd = pad(d.getDate());
	const hh = pad(d.getHours());
	const mi = pad(d.getMinutes());
	return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}
// ─ Navegación horizontal ─
function moverVentana(d) {
	if (!timeline) return;
	const w = timeline.getWindow();
	timeline.setWindow(
		new Date(w.start.getTime() + d * 24 * 3600_000),
		new Date(w.end.getTime() + d * 24 * 3600_000)
	);
}
function hacerZoom(f) {
	if (!timeline) return;
	const w = timeline.getWindow();
	const span = w.end - w.start;
	const mid = new Date((w.start.getTime() + w.end.getTime()) / 2);
	timeline.setWindow(
		new Date(mid.getTime() - span * f / 2),
		new Date(mid.getTime() + span * f / 2)
	);
}
function centrarEnAhora() {
	if (timeline) timeline.moveTo(new Date());
}
// Vacía el contenedor de filas de evento
function clearEventosContainer() {
	document.getElementById("eventosContainer").innerHTML = "";
}

// Rellena el SELECT de Grupos en el modal de Eventos
function fillGrupoSelect() {
	const sel = document.getElementById("selectGrupo");
	sel.innerHTML = `<option value="">-- Elige grupo --</option>`;
	groups.get({ filter: g => g.treeLevel === 1 })
		.forEach(g => {
			sel.innerHTML += `<option value="${g.id}">${stripTags(g.content)}</option>`;
		});
}

// Rellena el SELECT de Unidades según el grupo seleccionado
function fillUnidadSelect(gid) {
	const sel = document.getElementById("selectUnidad");
	sel.innerHTML = `<option value="">-- Elige unidad --</option>`;
	groups.get({
		filter: u =>
			u.treeLevel === 2 &&
			String(u.id).startsWith(String(gid))
	}).forEach(u => {
		sel.innerHTML += `<option value="${u.id}">${u.content}</option>`;
	});
}
// ─ Utilidades ─
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
	} while ((0.299 * r + 0.587 * g + 0.114 * b) <= 180);
	return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
function esColorClaro(r, g, b) {
	return (0.299 * r + 0.587 * g + 0.114 * b) > 180;
}

// ─ Cargar estado desde localStorage ─
function cargarDesdeLocalStorage() {
	const si = localStorage.getItem(LS_ITEMS),
		sg = localStorage.getItem(LS_GROUPS),
		sr = localStorage.getItem(LS_RANGE);

	items = new vis.DataSet(si ? JSON.parse(si) : []);
	groups = new vis.DataSet(sg ? JSON.parse(sg) : []);

	const all = items.getIds().map(i => Number(i));
	nextEventId = all.length ? Math.max(...all) + 1 : 1;

	let start = new Date(), end = new Date(start.getTime() + 2 * 3600_000);
	if (sr) {
		const r = JSON.parse(sr);
		start = new Date(r.start);
		end = new Date(r.end);
	}
	document.getElementById("fechaInicio").value = start.toISOString().slice(0, 10);
	document.getElementById("fechaFin").value = end.toISOString().slice(0, 10);

	generarTimeline(start, end);

	// Reprogramar alertas
	clearScheduledAlerts();
	items.get().forEach(evt => scheduleAlert(evt));
}

document.getElementById("alertaEvento").addEventListener("change", function () {
	const fila = document.getElementById("filaAlerta");
	fila.style.display = this.checked ? "" : "none";
});

document.getElementById("audioSelect").addEventListener("change", function () {
	const btn = document.getElementById("btnPlayAudio");
	btn.disabled = !this.value;
});

document.getElementById("btnPlayAudio").addEventListener("click", () => {
	const audio = new Audio(`music/${document.getElementById("audioSelect").value}`);
	audio.play();
});

document.getElementById("btnGuardarCambios").addEventListener("click", async () => {
	const id = +document.getElementById("eventoId").value;
	const evt = items.get(id);
	if (!evt) return;

	const result = await Swal.fire({
		title: "¿Guardar cambios?",
		icon: "question",
		showCancelButton: true,
		confirmButtonText: "Sí, guardar",
		cancelButtonText: "Cancelar"
	});
	if (!result.isConfirmed) return;

	evt.content = document.getElementById("nombreEvento").value.trim();
	evt.start = new Date(document.getElementById("inicioEvento").value);
	evt.end = new Date(document.getElementById("finEvento").value);
	evt.style = `background-color:${document.getElementById("colorEvento").value}`;
	evt.alerta = document.getElementById("alertaEvento").checked;
	evt.audio = document.getElementById("audioSelect").value || "";

	items.update(evt);
	clearScheduledAlerts();
	items.get().forEach(e => scheduleAlert(e));
	timeline.setItems(items);
	guardarEnLocalStorage();
	bootstrap.Modal.getInstance(document.getElementById("modalEditarEvento")).hide();
});

document.getElementById("btnEliminarEvento").addEventListener("click", async () => {
	const id = +document.getElementById("eventoId").value;
	const evt = items.get(id);
	if (!evt) return;

	const result = await Swal.fire({
		title: "¿Eliminar evento?",
		text: "Esta acción no se puede deshacer.",
		icon: "warning",
		showCancelButton: true,
		confirmButtonText: "Sí, eliminar",
		cancelButtonText: "Cancelar"
	});
	if (!result.isConfirmed) return;

	items.remove(id);
	clearScheduledAlerts();
	items.get().forEach(e => scheduleAlert(e));
	timeline.setItems(items);
	guardarEnLocalStorage();
	bootstrap.Modal.getInstance(document.getElementById("modalEditarEvento")).hide();
});