(() => {
	const LOG_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Avmaskning', 'Pälsvård', 'Hälsodagbok', 'Övrigt'];
	const REMINDER_LABELS = { Kloklippning: '✂️ Kloklippning', Vaccination: '💉 Vaccination', Avmaskning: '💊 Avmaskning' };
	const typeIcons = {
		Katt: '🐈', Hund: '🐕', Kanin: '🐇', Marsvin: '🐹', Hamster: '🐹',
		Råtta: '🐭', Mus: '🐭', Gerbil: '🐭', Chinchilla: '🐭', Degu: '🐭',
		Iller: '🦦', Igelkott: '🦔', Fågel: '🐦', Sköldpadda: '🐢', Ödla: '🦎',
		Orm: '🐍', Fisk: '🐟'
	};
	const notice = document.querySelector('#notice');
	const gallery = document.querySelector('#gallery');
	const photoForm = document.querySelector('#photoForm');
	const photoInput = document.querySelector('#photoInput');
	const profileForm = document.querySelector('#profileForm');
	const logForm = document.querySelector('#logForm');
	const logList = document.querySelector('#logList');
	const reminderList = document.querySelector('#reminderList');
	const weightChart = document.querySelector('#weightChart');
	const exportLink = document.querySelector('#exportLink');
	const breedInput = document.querySelector('#breed');
	const breedOptions = document.querySelector('#breed-options');
	const medicationForm = document.querySelector('#medicationForm');
	const medicationList = document.querySelector('#medicationList');
	const costForm = document.querySelector('#costForm');
	const costList = document.querySelector('#costList');
	const expenseTotal = document.querySelector('#expenseTotal');
	const documentForm = document.querySelector('#documentForm');
	const documentInput = document.querySelector('#documentInput');
	const documentList = document.querySelector('#documentList');
	const sharingPanel = document.querySelector('#sharingPanel');
	const shareForm = document.querySelector('#shareForm');
	const shareList = document.querySelector('#shareList');

	const params = new URLSearchParams(window.location.search);
	const animalId = params.get('id');
	let animal = null;
	let shareManagementEnabled = false;

	function updateBreedOptions(type) {
		breedOptions.replaceChildren();
		(window.animalBreedOptions[type] || []).forEach(breed => {
			const option = document.createElement('option');
			option.value = breed;
			breedOptions.append(option);
		});
	}

	function getAnimalExampleImage(type) {
		return Object.prototype.hasOwnProperty.call(window.animalExampleImages, type)
			? window.animalExampleImages[type]
			: null;
	}

	function showNotice(message) {
		notice.textContent = message;
		notice.classList.add('visible');
	}

	if (!animalId) {
		showNotice('Inget djur valt. Gå till startsidan och klicka på "Öppna profil" på ett djur.');
		document.querySelector('.profile-panel').classList.add('hidden');
		document.querySelectorAll('.content-panel').forEach(panel => panel.classList.add('hidden'));
	}

	function clearNotice() {
		notice.classList.remove('visible');
	}

	async function api(path, options = {}) {
		const response = await fetch(path, {
			...options,
			headers: options.body instanceof FormData
				? (options.headers || {})
				: { 'Content-Type': 'application/json', ...(options.headers || {}) }
		});
		if (response.status === 401) {
			window.location.href = '/login.html';
			throw new Error('Inte inloggad.');
		}
		if (!response.ok) {
			const data = await response.json().catch(() => ({}));
			const error = new Error(data.error || 'Något gick fel.');
			error.status = response.status;
			throw error;
		}
		if (response.status === 204) return null;
		return response.json();
	}

	function element(tag, className, text) {
		const node = document.createElement(tag);
		if (className) node.className = className;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	function formatDate(date) {
		if (!date) return '';
		const parsed = new Date(`${date}T00:00:00`);
		return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('sv-SE').format(parsed);
	}

	function today() {
		const now = new Date();
		return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
	}

	function isOwner() {
		if (!animal) return false;
		if (typeof animal.isOwner === 'boolean') return animal.isOwner;
		if (animal.isOwner === true || animal.canManageShares === true || animal.owner === true || animal.role === 'owner') return true;
		if (animal.isOwner === false || animal.canManageShares === false || animal.owner === false || animal.role === 'collaborator') return false;
		return null;
	}

	function currency(amount) {
		return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(Number(amount) || 0);
	}

	function safelyShowError(error) {
		showNotice(error && error.message ? error.message : 'Något gick fel. Försök igen.');
	}

	function renderProfile() {
		document.title = `${animal.name} – Mina djur`;
		document.querySelector('#profile-title').textContent = animal.name;
		const typeDetails = [animal.breed ? `${animal.type} · ${animal.breed}` : animal.type];
		if (animal.sex) typeDetails.push(`${animal.sex === 'Hona' ? '♀' : '♂'} ${animal.sex}`);
		if (animal.neutered) typeDetails.push('🔒 Kastrerad');
		document.querySelector('#profileType').textContent = typeDetails.join(' · ');
		let icon = document.querySelector('#profileIcon');
		const exampleImage = getAnimalExampleImage(animal.type);
		if (animal.photos.length || exampleImage) {
			if (icon.tagName !== 'IMG') {
				const image = document.createElement('img');
				image.id = 'profileIcon';
				icon.replaceWith(image);
				icon = image;
			}
			icon.className = 'animal-cover profile-icon';
			icon.src = animal.photos.length ? animal.photos[0].url : exampleImage;
			icon.alt = animal.photos.length
				? `Foto på ${animal.name}`
				: `Exempelillustration av ${animal.type.toLocaleLowerCase('sv-SE')}`;
		} else {
			if (icon.tagName !== 'SPAN') {
				const placeholder = document.createElement('span');
				icon.replaceWith(placeholder);
				icon = placeholder;
				icon.id = 'profileIcon';
				icon.className = 'animal-icon profile-icon';
			}
			icon.textContent = typeIcons[animal.type] || '🐾';
		}

		document.querySelector('#name').value = animal.name;
		document.querySelector('#type').value = animal.type;
		breedInput.value = animal.breed || '';
		updateBreedOptions(animal.type);
		document.querySelector('#birthday').value = animal.birthday || '';
		document.querySelector('#sex').value = animal.sex || '';
		document.querySelector('#neutered').checked = Boolean(animal.neutered);
		document.querySelector('#initialWeight').value = animal.initialWeight ?? '';
		document.querySelector('#allergies').value = animal.allergies || '';
		document.querySelector('#microchipId').value = animal.microchipId || '';
		document.querySelector('#vetName').value = animal.vetName || '';
		document.querySelector('#vetPhone').value = animal.vetPhone || '';
		document.querySelector('#insuranceCompany').value = animal.insuranceCompany || '';
		document.querySelector('#insuranceNumber').value = animal.insuranceNumber || '';
		document.querySelector('#foodType').value = animal.foodType || '';
		document.querySelector('#foodAmount').value = animal.foodAmount || '';
		document.querySelector('#foodFrequency').value = animal.foodFrequency || '';
		document.querySelector('#breeder').value = animal.breeder || '';
		document.querySelector('#fatherName').value = animal.fatherName || '';
		document.querySelector('#fatherColorPattern').value = animal.fatherColorPattern || '';
		document.querySelector('#fatherCoat').value = animal.fatherCoat || '';
		document.querySelector('#motherName').value = animal.motherName || '';
		document.querySelector('#motherColorPattern').value = animal.motherColorPattern || '';
		document.querySelector('#motherCoat').value = animal.motherCoat || '';
		document.querySelector('#info').value = animal.info || '';
		exportLink.href = `/api/animals/${animalId}/export.csv`;

		gallery.innerHTML = '';
		if (!animal.photos.length) {
			gallery.append(element('p', 'field-hint', 'Inga bilder ännu. Ladda upp den första nedan.'));
		}
		animal.photos.forEach(photo => {
			const figure = element('figure', 'gallery-item');
			const img = document.createElement('img');
			img.src = photo.url;
			img.alt = `Foto på ${animal.name}`;
			const remove = element('button', 'delete-log', 'Ta bort');
			remove.type = 'button';
			remove.dataset.deletePhoto = photo.id;
			figure.append(img, remove);
			gallery.append(figure);
		});
	}

	function renderPrintPassport() {
		const passport = document.querySelector('#printPassport');
		passport.replaceChildren();

		const header = element('div', 'print-passport-header');
		const exampleImage = getAnimalExampleImage(animal.type);
		if (animal.photos.length || exampleImage) {
			const img = document.createElement('img');
			img.src = animal.photos.length ? animal.photos[0].url : exampleImage;
			img.alt = '';
			header.append(img);
		} else {
			header.append(element('span', 'print-icon', typeIcons[animal.type] || '🐾'));
		}
		const headerText = element('div');
		headerText.append(element('h1', '', animal.name));
		const subtitleParts = [animal.breed ? `${animal.type} · ${animal.breed}` : animal.type];
		if (animal.sex) subtitleParts.push(animal.sex);
		if (animal.neutered) subtitleParts.push('Kastrerad');
		headerText.append(element('p', '', subtitleParts.join(' · ')));
		header.append(headerText);
		passport.append(element('h2', '', 'Djurpass'), header);

		const weightRecords = (animal.records || []).filter(record => record.type === 'Vikt' && record.weight);
		const latestWeight = weightRecords.slice().sort((a, b) => b.date.localeCompare(a.date))[0];
		const weightValue = latestWeight ? latestWeight.weight : animal.initialWeight;
		const clawRecords = (animal.records || []).filter(record => record.type === 'Kloklippning');
		const latestClaw = clawRecords.slice().sort((a, b) => b.date.localeCompare(a.date))[0];

		function row(label, value) {
			if (!value) return null;
			const cell = element('div');
			cell.append(element('strong', '', `${label}:`), document.createTextNode(` ${value}`));
			return cell;
		}

		const basics = element('div', 'print-passport-grid');
		[
			row('Födelsedatum', animal.birthday ? formatDate(animal.birthday) : ''),
			row('Vikt', weightValue ? `${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(weightValue)} kg` : ''),
			row('Senast klippta klor', latestClaw ? formatDate(latestClaw.date) : ''),
			row('Chipnummer', animal.microchipId),
			row('Veterinärklinik', animal.vetName),
			row('Veterinärens telefon', animal.vetPhone),
			row('Försäkringsbolag', animal.insuranceCompany),
			row('Försäkringsnummer', animal.insuranceNumber),
			row('Foder', animal.foodType),
			row('Mängd per gång', animal.foodAmount),
			row('Hur ofta', animal.foodFrequency)
		].filter(Boolean).forEach(cell => basics.append(cell));
		passport.append(basics);

		if (animal.allergies) {
			passport.append(element('h2', '', 'Allergier / specialbehov'));
			passport.append(element('p', 'print-passport-note', animal.allergies));
		}

		const hasPedigree = animal.breeder || animal.fatherName || animal.motherName;
		if (hasPedigree) {
			passport.append(element('h2', '', 'Uppfödning och föräldrar'));
			const pedigree = element('div', 'print-passport-grid');
			[
				row('Uppfödare', animal.breeder),
				row('Far', animal.fatherName),
				row('Far – färg & teckning', animal.fatherColorPattern),
				row('Far – hårlag', animal.fatherCoat),
				row('Mor', animal.motherName),
				row('Mor – färg & teckning', animal.motherColorPattern),
				row('Mor – hårlag', animal.motherCoat)
			].filter(Boolean).forEach(cell => pedigree.append(cell));
			passport.append(pedigree);
		}

		const medications = (animal.medications || []).filter(medication => !medication.endDate || medication.endDate >= today());
		if (medications.length) {
			passport.append(element('h2', '', 'Aktuell medicinering'));
			medications.forEach(medication => {
				passport.append(element('p', 'print-passport-note', `${medication.name} – ${medication.dosage}, ${medication.frequency}`));
			});
		}

		if (animal.info) {
			passport.append(element('h2', '', 'Övrig information'));
			passport.append(element('p', 'print-passport-note', animal.info));
		}

		passport.append(element('p', 'print-passport-footer', `Utskrivet från Mina djur ${formatDate(today())}`));
	}

	function renderReminders() {
		reminderList.innerHTML = '';
		(animal.reminders || []).forEach(reminder => {
			const row = element('div', 'reminder-row');
			const label = element('span', 'reminder-name', REMINDER_LABELS[reminder.type] || reminder.type);
			row.append(label);

			const info = element('div', 'reminder-info');
			if (!reminder.lastDate) {
				info.append(element('span', 'field-hint', 'Ingen anteckning ännu'));
			} else {
				info.append(element('span', '', `Senast: ${formatDate(reminder.lastDate)}`));
				const statusClass = reminder.status === 'försenad' ? 'overdue' : reminder.status === 'snart' ? 'soon' : 'ok';
				const statusText = reminder.status === 'försenad'
					? `Försenad sedan ${formatDate(reminder.nextDate)}`
					: `Nästa: ${formatDate(reminder.nextDate)}`;
				info.append(element('span', `reminder-badge ${statusClass}`, statusText));
			}
			row.append(info);

			const intervalForm = element('form', 'reminder-interval-form');
			intervalForm.dataset.reminderType = reminder.type;
			const intervalInput = document.createElement('input');
			intervalInput.type = 'number';
			intervalInput.min = '1';
			intervalInput.max = '3650';
			intervalInput.value = reminder.intervalDays;
			intervalInput.setAttribute('aria-label', `Intervall i dagar för ${reminder.type}`);
			const intervalLabel = element('span', 'field-hint', 'dagars intervall');
			const saveButton = element('button', 'text-button', 'Spara');
			saveButton.type = 'submit';
			intervalForm.append(intervalInput, intervalLabel, saveButton);
			row.append(intervalForm);

			reminderList.append(row);
		});
	}

	function renderWeightChart() {
		weightChart.innerHTML = '';
		const points = (animal.records || [])
			.filter(record => record.type === 'Vikt' && record.weight)
			.slice()
			.sort((a, b) => a.date.localeCompare(b.date));
		if (points.length < 2) {
			weightChart.append(element('p', 'field-hint', 'Logga minst två viktmätningar för att se en graf.'));
			return;
		}

		const width = 600;
		const height = 200;
		const padding = 30;
		const weights = points.map(point => point.weight);
		const minWeight = Math.min(...weights);
		const maxWeight = Math.max(...weights);
		const weightRange = maxWeight - minWeight || 1;
		const stepX = (width - padding * 2) / (points.length - 1);
		const coords = points.map((point, index) => {
			const x = padding + index * stepX;
			const y = height - padding - ((point.weight - minWeight) / weightRange) * (height - padding * 2);
			return { x, y, point };
		});

		const svgNs = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(svgNs, 'svg');
		svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
		svg.setAttribute('class', 'weight-chart-svg');

		const polyline = document.createElementNS(svgNs, 'polyline');
		polyline.setAttribute('points', coords.map(c => `${c.x},${c.y}`).join(' '));
		polyline.setAttribute('fill', 'none');
		polyline.setAttribute('stroke', '#3f7a4d');
		polyline.setAttribute('stroke-width', '2.5');
		svg.append(polyline);

		coords.forEach(({ x, y, point }) => {
			const circle = document.createElementNS(svgNs, 'circle');
			circle.setAttribute('cx', x);
			circle.setAttribute('cy', y);
			circle.setAttribute('r', 4);
			circle.setAttribute('fill', '#3f7a4d');
			const title = document.createElementNS(svgNs, 'title');
			title.textContent = `${formatDate(point.date)}: ${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(point.weight)} kg`;
			circle.append(title);
			svg.append(circle);
		});

		weightChart.append(svg);
		const summary = element('p', 'field-hint', `Lägsta: ${minWeight} kg · Högsta: ${maxWeight} kg · Senaste: ${weights[weights.length - 1]} kg`);
		weightChart.append(summary);
	}

	function makeRecordItem(record) {
		const row = element('div', 'log-item');
		row.append(element('span', 'log-dot'));
		const content = element('div');
		const titleText = record.type === 'Vikt' && record.weight
			? `Vikt · ${new Intl.NumberFormat('sv-SE', { maximumFractionDigits: 2 }).format(record.weight)} kg`
			: record.type;
		content.append(element('p', 'log-title', titleText));
		if (record.note) content.append(element('p', 'log-note', record.note));
		[
			['Diagnos', record.diagnosis],
			['Behandling', record.treatment],
			['Uppföljning', record.followUpDate ? formatDate(record.followUpDate) : ''],
			['Symtom', record.symptoms],
			['Aptit', record.appetite],
			['Humör', record.mood]
		].forEach(([label, value]) => {
			if (value) content.append(element('p', 'log-note', `${label}: ${value}`));
		});
		const date = element('span', 'log-date', formatDate(record.date));
		row.append(content, date);
		const remove = element('button', 'delete-log', 'Ta bort');
		remove.type = 'button';
		remove.dataset.deleteRecord = record.id;
		row.append(remove);
		return row;
	}

	function renderRecords() {
		logList.innerHTML = '';
		if (!animal.records.length) {
			logList.append(element('p', 'field-hint', 'Här samlas viktmätningar, kloklippning, veterinärbesök och andra anteckningar.'));
			return;
		}
		animal.records.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach(record => logList.append(makeRecordItem(record)));
	}

	function renderMedications() {
		medicationList.replaceChildren();
		const medications = animal.medications || [];
		if (!medications.length) {
			medicationList.append(element('p', 'field-hint', 'Inga läkemedel tillagda ännu.'));
			return;
		}

		const soonDate = new Date(`${today()}T00:00:00`);
		soonDate.setDate(soonDate.getDate() + 7);
		const soonLimit = `${soonDate.getFullYear()}-${String(soonDate.getMonth() + 1).padStart(2, '0')}-${String(soonDate.getDate()).padStart(2, '0')}`;
		medications.slice().sort((a, b) => String(a.nextDose || a.startDate).localeCompare(String(b.nextDose || b.startDate))).forEach(medication => {
			const row = element('article', 'feature-item');
			const details = element('div', 'feature-item-main');
			details.append(element('h3', 'feature-item-title', medication.name));
			details.append(element('p', 'feature-item-copy', `${medication.dosage || 'Dos saknas'} · ${medication.frequency || 'Frekvens saknas'}`));
			details.append(element('p', 'feature-item-copy', `Start: ${formatDate(medication.startDate)}${medication.endDate ? ` · Slut: ${formatDate(medication.endDate)}` : ''}`));
			if (medication.note) details.append(element('p', 'feature-item-copy', medication.note));
			const treatmentEnded = medication.endDate && medication.endDate < today();
			if (treatmentEnded) {
				details.append(element('span', 'reminder-badge ok medication-reminder', `Behandling avslutad · ${formatDate(medication.endDate)}`));
			} else if (medication.nextDose) {
				const dueToday = medication.nextDose === today();
				const overdue = medication.nextDose < today();
				const dueSoon = !dueToday && !overdue && medication.nextDose <= soonLimit;
				const dueClass = overdue ? 'overdue' : dueToday || dueSoon ? 'soon' : 'ok';
				const dueText = overdue
					? `Dos försenad · ${formatDate(medication.nextDose)}`
					: dueToday
						? `Dos idag · ${formatDate(medication.nextDose)}`
						: dueSoon
							? `Dos snart · ${formatDate(medication.nextDose)}`
							: `Nästa dos · ${formatDate(medication.nextDose)}`;
				details.append(element('span', `reminder-badge ${dueClass} medication-reminder`, dueText));
			} else {
				details.append(element('span', 'reminder-badge medication-reminder', 'Påminnelse saknas · ange nästa dos'));
			}
			const actions = element('div', 'feature-actions medication-actions');
			const edit = element('button', 'text-button', 'Redigera');
			edit.type = 'button';
			edit.dataset.editMedication = medication.id;
			edit.setAttribute('aria-expanded', 'false');
			edit.setAttribute('aria-label', `Redigera ${medication.name}`);
			const remove = element('button', 'delete-log feature-delete', 'Ta bort');
			remove.type = 'button';
			remove.dataset.deleteMedication = medication.id;
			remove.setAttribute('aria-label', `Ta bort ${medication.name}`);
			actions.append(edit, remove);
			row.append(details, actions);

			const editForm = element('form', 'log-form feature-form medication-edit-form hidden');
			editForm.dataset.medicationId = medication.id;
			const addEditField = (name, labelText, type, value, required = false) => {
				const id = `edit-medication-${medication.id}-${name}`;
				const label = element('label', name === 'note' ? 'full' : '', labelText);
				label.htmlFor = id;
				const field = type === 'textarea'
					? element('textarea', name === 'note' ? 'full' : '')
					: document.createElement('input');
				field.id = id;
				field.name = name;
				field.value = value || '';
				field.maxLength = name === 'note' ? 500 : 120;
				if (type !== 'textarea') field.type = type;
				field.required = required;
				editForm.append(label, field);
			};
			addEditField('name', 'Läkemedel', 'text', medication.name, true);
			addEditField('dosage', 'Dos', 'text', medication.dosage, true);
			addEditField('frequency', 'Frekvens', 'text', medication.frequency, true);
			addEditField('startDate', 'Startdatum', 'date', medication.startDate, true);
			addEditField('endDate', 'Slutdatum (valfritt)', 'date', medication.endDate);
			addEditField('nextDose', 'Nästa dos (valfritt)', 'date', medication.nextDose);
			addEditField('note', 'Anteckning (valfritt)', 'textarea', medication.note);
			const save = element('button', 'primary full', 'Spara ändringar');
			save.type = 'submit';
			const cancel = element('button', 'text-button full', 'Avbryt');
			cancel.type = 'button';
			cancel.dataset.cancelMedicationEdit = medication.id;
			editForm.append(save, cancel);
			row.append(editForm);
			medicationList.append(row);
		});
	}

	function renderCosts() {
		costList.replaceChildren();
		const costs = animal.costs || [];
		const total = costs.reduce((sum, cost) => sum + (Number(cost.amount) || 0), 0);
		expenseTotal.textContent = `Totalt: ${currency(total)}`;
		if (!costs.length) {
			costList.append(element('p', 'field-hint', 'Inga utgifter registrerade ännu.'));
			return;
		}
		costs.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).forEach(cost => {
			const row = element('article', 'feature-item');
			const details = element('div', 'feature-item-main');
			details.append(element('h3', 'feature-item-title', `${cost.category} · ${currency(cost.amount)}`));
			details.append(element('p', 'feature-item-copy', formatDate(cost.date)));
			if (cost.note) details.append(element('p', 'feature-item-copy', cost.note));
			const remove = element('button', 'delete-log feature-delete', 'Ta bort');
			remove.type = 'button';
			remove.dataset.deleteCost = cost.id;
			remove.setAttribute('aria-label', `Ta bort utgift ${cost.category}`);
			row.append(details, remove);
			costList.append(row);
		});
	}

	function renderDocuments() {
		documentList.replaceChildren();
		const documents = animal.documents || [];
		if (!documents.length) {
			documentList.append(element('p', 'field-hint', 'Inga dokument uppladdade ännu.'));
			return;
		}
		documents.slice().sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))).forEach(documentRecord => {
			const row = element('article', 'feature-item');
			const details = element('div', 'feature-item-main');
			details.append(element('h3', 'feature-item-title', documentRecord.name));
			if (documentRecord.uploadedAt) details.append(element('p', 'feature-item-copy', `Uppladdat ${formatDate(String(documentRecord.uploadedAt).slice(0, 10))}`));
			const actions = element('div', 'feature-actions');
			const download = element('a', 'text-button', 'Hämta');
			download.href = `/api/animals/${encodeURIComponent(animalId)}/documents/${encodeURIComponent(documentRecord.id)}/file`;
			download.setAttribute('aria-label', `Hämta dokumentet ${documentRecord.name}`);
			const remove = element('button', 'delete-log feature-delete', 'Ta bort');
			remove.type = 'button';
			remove.dataset.deleteDocument = documentRecord.id;
			remove.setAttribute('aria-label', `Ta bort dokumentet ${documentRecord.name}`);
			actions.append(download, remove);
			row.append(details, actions);
			documentList.append(row);
		});
	}

	async function loadShares() {
		if (isOwner() === false) {
			sharingPanel.classList.add('hidden');
			return;
		}
		try {
			const shares = await api(`/api/animals/${encodeURIComponent(animalId)}/shares`);
			shareManagementEnabled = true;
			sharingPanel.classList.remove('hidden');
			animal.shares = Array.isArray(shares) ? shares : [];
			renderShares();
		} catch (error) {
			shareManagementEnabled = false;
			sharingPanel.classList.add('hidden');
			if (isOwner() === true || (error.status !== 403 && error.status !== 404)) safelyShowError(error);
		}
	}

	function renderShares() {
		shareList.replaceChildren();
		const shares = animal.shares || [];
		if (!shares.length) {
			shareList.append(element('p', 'field-hint', 'Profilen delas inte med någon ännu.'));
			return;
		}
		shares.forEach(share => {
			const row = element('div', 'feature-item share-item');
			row.append(element('strong', 'feature-item-title', share.username));
			const remove = element('button', 'delete-log feature-delete', 'Ta bort åtkomst');
			remove.type = 'button';
			remove.dataset.deleteShare = share.id;
			remove.setAttribute('aria-label', `Ta bort åtkomst för ${share.username}`);
			row.append(remove);
			shareList.append(row);
		});
	}

	function buildLogForm() {
		logForm.innerHTML = '';
		const typeLabel = element('label', '', 'Vad vill du anteckna?');
		typeLabel.htmlFor = 'record-type';
		const recordType = element('select');
		recordType.id = 'record-type';
		recordType.name = 'recordType';
		LOG_TYPES.forEach(type => recordType.add(new Option(type, type)));

		const dateLabel = element('label', '', 'Datum');
		dateLabel.htmlFor = 'record-date';
		const date = element('input');
		date.id = 'record-date';
		date.name = 'date';
		date.type = 'date';
		date.value = today();
		date.required = true;

		const weightLabel = element('label', '', 'Vikt i kg');
		weightLabel.htmlFor = 'record-weight';
		const weight = element('input');
		weight.id = 'record-weight';
		weight.name = 'weight';
		weight.type = 'number';
		weight.min = '0.01';
		weight.max = '1000';
		weight.step = '0.01';
		weight.inputMode = 'decimal';
		weight.placeholder = 'Till exempel 4,2';
		recordType.addEventListener('change', () => {
			const isWeight = recordType.value === 'Vikt';
			weight.classList.toggle('hidden', !isWeight);
			weightLabel.classList.toggle('hidden', !isWeight);
			weight.required = isWeight;
		});

		const noteLabel = element('label', 'full', 'Anteckning (valfritt)');
		noteLabel.htmlFor = 'record-note';
		const note = element('textarea', 'full');
		note.id = 'record-note';
		note.name = 'note';
		note.maxLength = 500;

		function makeField(name, labelText, type = 'textarea') {
			const id = `record-${name}`;
			const label = element('label', 'full', labelText);
			label.htmlFor = id;
			const field = type === 'textarea' ? element('textarea', 'full') : document.createElement('input');
			field.id = id;
			field.name = name;
			field.maxLength = 500;
			if (type !== 'textarea') field.type = type;
			field.classList.add('full', 'record-detail', `record-detail-${name}`);
			return { label, field };
		}
		const vetFields = [
			makeField('diagnosis', 'Diagnos'),
			makeField('treatment', 'Behandling'),
			makeField('followUpDate', 'Datum för uppföljning', 'date')
		];
		const healthFields = [
			makeField('symptoms', 'Symtom'),
			makeField('appetite', 'Aptit'),
			makeField('mood', 'Humör')
		];
		const details = [...vetFields, ...healthFields];
		const save = element('button', 'primary full', 'Spara anteckning');
		save.type = 'submit';

		logForm.append(typeLabel, recordType, dateLabel, date, weightLabel, weight, noteLabel, note);
		details.forEach(({ label, field }) => {
			label.classList.add('record-detail');
			logForm.append(label, field);
		});
		logForm.append(save);
		recordType.addEventListener('change', () => {
			const isVet = recordType.value === 'Veterinärbesök';
			const isHealth = recordType.value === 'Hälsodagbok';
			vetFields.forEach(({ label, field }) => {
				label.classList.toggle('hidden', !isVet);
				field.classList.toggle('hidden', !isVet);
			});
			healthFields.forEach(({ label, field }) => {
				label.classList.toggle('hidden', !isHealth);
				field.classList.toggle('hidden', !isHealth);
			});
		});
		recordType.dispatchEvent(new Event('change'));
	}

	async function load() {
		try {
			animal = await api(`/api/animals/${encodeURIComponent(animalId)}`);
			animal.records = Array.isArray(animal.records) ? animal.records : [];
			animal.photos = Array.isArray(animal.photos) ? animal.photos : [];
			animal.medications = Array.isArray(animal.medications) ? animal.medications : [];
			animal.costs = Array.isArray(animal.costs) ? animal.costs : [];
			animal.documents = Array.isArray(animal.documents) ? animal.documents : [];
			animal.shares = Array.isArray(animal.shares) ? animal.shares : [];
			renderProfile();
			renderRecords();
			renderReminders();
			renderWeightChart();
			renderMedications();
			renderCosts();
			renderDocuments();
			renderPrintPassport();
			await loadShares();
		} catch (error) {
			showNotice(error.message);
		}
	}

	photoForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		if (!photoInput.files.length) return;
		const formData = new FormData();
		formData.append('photo', photoInput.files[0]);
		const submitButton = photoForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const photo = await api(`/api/animals/${animalId}/photos`, { method: 'POST', body: formData });
			animal.photos.push(photo);
			renderProfile();
			renderPrintPassport();
			photoForm.reset();
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	gallery.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-photo]');
		if (!button) return;
		if (!confirm('Ta bort den här bilden?')) return;
		try {
			await api(`/api/animals/${animalId}/photos/${button.dataset.deletePhoto}`, { method: 'DELETE' });
			animal.photos = animal.photos.filter(photo => photo.id !== button.dataset.deletePhoto);
			renderProfile();
			renderPrintPassport();
		} catch (error) {
			showNotice(error.message);
		}
	});

	profileForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const payload = {
			name: document.querySelector('#name').value.trim(),
			type: document.querySelector('#type').value.trim(),
			breed: breedInput.value.trim(),
			birthday: document.querySelector('#birthday').value,
			info: document.querySelector('#info').value.trim(),
			initialWeight: document.querySelector('#initialWeight').value
				? Number(document.querySelector('#initialWeight').value.replace(',', '.'))
				: null,
			sex: document.querySelector('#sex').value,
			neutered: document.querySelector('#neutered').checked,
			allergies: document.querySelector('#allergies').value.trim(),
			microchipId: document.querySelector('#microchipId').value.trim(),
			vetName: document.querySelector('#vetName').value.trim(),
			vetPhone: document.querySelector('#vetPhone').value.trim(),
			insuranceCompany: document.querySelector('#insuranceCompany').value.trim(),
			insuranceNumber: document.querySelector('#insuranceNumber').value.trim(),
			foodType: document.querySelector('#foodType').value.trim(),
			foodAmount: document.querySelector('#foodAmount').value.trim(),
			foodFrequency: document.querySelector('#foodFrequency').value.trim(),
			breeder: document.querySelector('#breeder').value.trim(),
			fatherName: document.querySelector('#fatherName').value.trim(),
			fatherColorPattern: document.querySelector('#fatherColorPattern').value.trim(),
			fatherCoat: document.querySelector('#fatherCoat').value.trim(),
			motherName: document.querySelector('#motherName').value.trim(),
			motherColorPattern: document.querySelector('#motherColorPattern').value.trim(),
			motherCoat: document.querySelector('#motherCoat').value.trim()
		};
		const submitButton = profileForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const updated = await api(`/api/animals/${animalId}`, { method: 'PUT', body: JSON.stringify(payload) });
			animal = { ...animal, ...updated };
			renderProfile();
			renderPrintPassport();
			showNotice('Sparat!');
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	document.querySelector('#type').addEventListener('input', event => {
		updateBreedOptions(event.currentTarget.value.trim());
	});

	logForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const formData = new FormData(logForm);
		const recordType = String(formData.get('recordType'));
		const followUpDate = String(formData.get('followUpDate') || '');
		if (recordType === 'Veterinärbesök' && followUpDate && followUpDate < String(formData.get('date'))) {
			showNotice('Uppföljningsdatumet kan inte vara före veterinärbesöket.');
			document.querySelector('#record-followUpDate').focus();
			return;
		}
		const payload = {
			type: recordType,
			date: String(formData.get('date')),
			weight: recordType === 'Vikt' ? Number(String(formData.get('weight')).replace(',', '.')) : null,
			note: String(formData.get('note') || '').trim(),
			diagnosis: String(formData.get('diagnosis') || '').trim(),
			treatment: String(formData.get('treatment') || '').trim(),
			followUpDate: followUpDate || null,
			symptoms: String(formData.get('symptoms') || '').trim(),
			appetite: String(formData.get('appetite') || '').trim(),
			mood: String(formData.get('mood') || '').trim()
		};
		const submitButton = logForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const record = await api(`/api/animals/${animalId}/records`, { method: 'POST', body: JSON.stringify(payload) });
			animal.records = [record, ...animal.records];
			renderRecords();
			renderReminders();
			renderWeightChart();
			renderPrintPassport();
			logForm.reset();
			buildLogForm();
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
		}
	});

	medicationForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const formData = new FormData(medicationForm);
		const startDate = String(formData.get('startDate') || '');
		const endDate = String(formData.get('endDate') || '');
		if (endDate && endDate < startDate) {
			showNotice('Slutdatumet kan inte vara före startdatumet.');
			document.querySelector('#medicationEndDate').focus();
			return;
		}
		const payload = {
			name: String(formData.get('name') || '').trim(),
			dosage: String(formData.get('dosage') || '').trim(),
			frequency: String(formData.get('frequency') || '').trim(),
			startDate,
			endDate: endDate || null,
			nextDose: String(formData.get('nextDose') || '') || null,
			note: String(formData.get('note') || '').trim()
		};
		if (!payload.name || !payload.dosage || !payload.frequency || !startDate) {
			showNotice('Fyll i läkemedel, dos, frekvens och startdatum.');
			return;
		}
		const button = medicationForm.querySelector('button[type="submit"]');
		button.disabled = true;
		try {
			const medication = await api(`/api/animals/${encodeURIComponent(animalId)}/medications`, {
				method: 'POST',
				body: JSON.stringify(payload)
			});
			animal.medications.push(medication);
			renderMedications();
			renderPrintPassport();
			medicationForm.reset();
			document.querySelector('#medicationStartDate').value = today();
		} catch (error) {
			safelyShowError(error);
		} finally {
			button.disabled = false;
		}
	});

	medicationList.addEventListener('click', async event => {
		const editButton = event.target.closest('button[data-edit-medication]');
		if (editButton) {
			const row = editButton.closest('.feature-item');
			const editForm = row.querySelector('.medication-edit-form');
			const expanded = editButton.getAttribute('aria-expanded') === 'true';
			editButton.setAttribute('aria-expanded', String(!expanded));
			editForm.classList.toggle('hidden', expanded);
			if (!expanded) editForm.querySelector('input')?.focus();
			return;
		}
		const cancelButton = event.target.closest('button[data-cancel-medication-edit]');
		if (cancelButton) {
			const row = cancelButton.closest('.feature-item');
			row.querySelector('.medication-edit-form').classList.add('hidden');
			row.querySelector('[data-edit-medication]')?.setAttribute('aria-expanded', 'false');
			return;
		}
		const button = event.target.closest('button[data-delete-medication]');
		if (!button || !confirm('Ta bort medicinen från listan?')) return;
		try {
			await api(`/api/animals/${encodeURIComponent(animalId)}/medications/${encodeURIComponent(button.dataset.deleteMedication)}`, { method: 'DELETE' });
			animal.medications = animal.medications.filter(item => String(item.id) !== button.dataset.deleteMedication);
			renderMedications();
			renderPrintPassport();
		} catch (error) {
			safelyShowError(error);
		}
	});

	medicationList.addEventListener('submit', async event => {
		const form = event.target.closest('.medication-edit-form');
		if (!form) return;
		event.preventDefault();
		clearNotice();
		const formData = new FormData(form);
		const startDate = String(formData.get('startDate') || '');
		const endDate = String(formData.get('endDate') || '');
		if (endDate && endDate < startDate) {
			showNotice('Slutdatumet kan inte vara före startdatumet.');
			form.querySelector('[name="endDate"]').focus();
			return;
		}
		const payload = {
			name: String(formData.get('name') || '').trim(),
			dosage: String(formData.get('dosage') || '').trim(),
			frequency: String(formData.get('frequency') || '').trim(),
			startDate,
			endDate: endDate || null,
			nextDose: String(formData.get('nextDose') || '') || null,
			note: String(formData.get('note') || '').trim()
		};
		if (!payload.name || !payload.dosage || !payload.frequency || !payload.startDate) {
			showNotice('Fyll i läkemedel, dos, frekvens och startdatum.');
			return;
		}
		const button = form.querySelector('button[type="submit"]');
		button.disabled = true;
		try {
			const updated = await api(`/api/animals/${encodeURIComponent(animalId)}/medications/${encodeURIComponent(form.dataset.medicationId)}`, {
				method: 'PUT',
				body: JSON.stringify(payload)
			});
			const updatedMedication = { ...payload, ...(updated || {}), id: form.dataset.medicationId };
			animal.medications = animal.medications.map(item => String(item.id) === form.dataset.medicationId ? updatedMedication : item);
			renderMedications();
			renderPrintPassport();
			showNotice('Medicinen är uppdaterad.');
		} catch (error) {
			safelyShowError(error);
		} finally {
			button.disabled = false;
		}
	});

	costForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const formData = new FormData(costForm);
		const amount = Number(String(formData.get('amount') || '').replace(',', '.'));
		if (!Number.isFinite(amount) || amount <= 0) {
			showNotice('Ange ett belopp som är större än noll.');
			document.querySelector('#costAmount').focus();
			return;
		}
		const payload = {
			date: String(formData.get('date') || ''),
			category: String(formData.get('category') || '').trim(),
			amount,
			note: String(formData.get('note') || '').trim()
		};
		if (!payload.date || !payload.category) {
			showNotice('Fyll i datum och kategori för utgiften.');
			return;
		}
		const button = costForm.querySelector('button[type="submit"]');
		button.disabled = true;
		try {
			const cost = await api(`/api/animals/${encodeURIComponent(animalId)}/costs`, {
				method: 'POST',
				body: JSON.stringify(payload)
			});
			animal.costs.push(cost);
			renderCosts();
			costForm.reset();
			document.querySelector('#costDate').value = today();
		} catch (error) {
			safelyShowError(error);
		} finally {
			button.disabled = false;
		}
	});

	costList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-cost]');
		if (!button || !confirm('Ta bort den här utgiften?')) return;
		try {
			await api(`/api/animals/${encodeURIComponent(animalId)}/costs/${encodeURIComponent(button.dataset.deleteCost)}`, { method: 'DELETE' });
			animal.costs = animal.costs.filter(item => String(item.id) !== button.dataset.deleteCost);
			renderCosts();
		} catch (error) {
			safelyShowError(error);
		}
	});

	documentForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		const file = documentInput.files[0];
		if (!file) {
			showNotice('Välj ett dokument att ladda upp.');
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			showNotice('Dokumentet är för stort. Maximal filstorlek är 10 MB.');
			documentInput.focus();
			return;
		}
		const formData = new FormData();
		formData.append('document', file);
		const button = documentForm.querySelector('button[type="submit"]');
		button.disabled = true;
		try {
			const documentRecord = await api(`/api/animals/${encodeURIComponent(animalId)}/documents`, { method: 'POST', body: formData });
			animal.documents.push(documentRecord);
			renderDocuments();
			documentForm.reset();
		} catch (error) {
			safelyShowError(error);
		} finally {
			button.disabled = false;
		}
	});

	documentList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-document]');
		if (!button || !confirm('Ta bort dokumentet permanent?')) return;
		try {
			await api(`/api/animals/${encodeURIComponent(animalId)}/documents/${encodeURIComponent(button.dataset.deleteDocument)}`, { method: 'DELETE' });
			animal.documents = animal.documents.filter(item => String(item.id) !== button.dataset.deleteDocument);
			renderDocuments();
		} catch (error) {
			safelyShowError(error);
		}
	});

	shareForm.addEventListener('submit', async event => {
		event.preventDefault();
		clearNotice();
		if (!shareManagementEnabled) return;
		const username = document.querySelector('#shareUsername').value.trim();
		if (!/^[A-Za-z0-9_.-]{3,64}$/.test(username)) {
			showNotice('Ange ett giltigt användarnamn med 3–32 bokstäver, siffror, punkt, bindestreck eller understreck.');
			return;
		}
		const button = shareForm.querySelector('button[type="submit"]');
		button.disabled = true;
		try {
			await api(`/api/animals/${encodeURIComponent(animalId)}/shares`, {
				method: 'POST',
				body: JSON.stringify({ username })
			});
			shareForm.reset();
			await loadShares();
			showNotice(`Profilen delas nu med ${username}.`);
		} catch (error) {
			safelyShowError(error);
		} finally {
			button.disabled = false;
		}
	});

	shareList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-share]');
		if (!button || !shareManagementEnabled || !confirm('Ta bort den här personens åtkomst till profilen?')) return;
		try {
			await api(`/api/animals/${encodeURIComponent(animalId)}/shares/${encodeURIComponent(button.dataset.deleteShare)}`, { method: 'DELETE' });
			animal.shares = animal.shares.filter(share => String(share.id) !== button.dataset.deleteShare);
			renderShares();
		} catch (error) {
			safelyShowError(error);
		}
	});

	logList.addEventListener('click', async event => {
		const button = event.target.closest('button[data-delete-record]');
		if (!button) return;
		if (!confirm('Ta bort den här anteckningen?')) return;
		try {
			await api(`/api/animals/${animalId}/records/${button.dataset.deleteRecord}`, { method: 'DELETE' });
			animal.records = animal.records.filter(record => record.id !== button.dataset.deleteRecord);
			renderRecords();
			renderReminders();
			renderWeightChart();
			renderPrintPassport();
		} catch (error) {
			showNotice(error.message);
		}
	});

	reminderList.addEventListener('submit', async event => {
		const form = event.target.closest('.reminder-interval-form');
		if (!form) return;
		event.preventDefault();
		const type = form.dataset.reminderType;
		const value = Number(form.querySelector('input').value);
		try {
			await api(`/api/animals/${animalId}/reminders/${encodeURIComponent(type)}`, {
				method: 'PUT',
				body: JSON.stringify({ intervalDays: value })
			});
			animal = await api(`/api/animals/${encodeURIComponent(animalId)}`);
			renderReminders();
			showNotice('Påminnelsen är sparad!');
		} catch (error) {
			showNotice(error.message);
		}
	});

	document.querySelector('#logoutButton').addEventListener('click', async () => {
		try {
			await api('/api/auth/logout', { method: 'POST' });
		} finally {
			window.location.href = '/login.html';
		}
	});

	const printButton = document.querySelector('#printPassportButton');
	if (printButton) {
		printButton.addEventListener('click', () => {
			if (!animal) return;
			window.print();
		});
	}

	buildLogForm();
	document.querySelector('#medicationStartDate').value = today();
	document.querySelector('#costDate').value = today();
	if (animalId) load();
})();
