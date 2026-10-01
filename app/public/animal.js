(() => {
	const LOG_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Avmaskning', 'Pälsvård', 'Övrigt'];
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

	const params = new URLSearchParams(window.location.search);
	const animalId = params.get('id');
	let animal = null;

	function updateBreedOptions(type) {
		breedOptions.replaceChildren();
		(window.animalBreedOptions[type] || []).forEach(breed => {
			const option = document.createElement('option');
			option.value = breed;
			breedOptions.append(option);
		});
	}

	function showNotice(message) {
		notice.textContent = message;
		notice.classList.add('visible');
	}

	if (!animalId) {
		showNotice('Inget djur valt. Gå till startsidan och klicka på "Öppna profil" på ett djur.');
		document.querySelector('.profile-panel').classList.add('hidden');
		document.querySelector('.content-panel').classList.add('hidden');
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
			throw new Error(data.error || 'Något gick fel.');
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

	function renderProfile() {
		document.title = `${animal.name} – Mina djur`;
		document.querySelector('#profile-title').textContent = animal.name;
		const typeDetails = [animal.breed ? `${animal.type} · ${animal.breed}` : animal.type];
		if (animal.sex) typeDetails.push(`${animal.sex === 'Hona' ? '♀' : '♂'} ${animal.sex}`);
		if (animal.neutered) typeDetails.push('🔒 Kastrerad');
		document.querySelector('#profileType').textContent = typeDetails.join(' · ');
		const icon = document.querySelector('#profileIcon');
		if (animal.photos.length) {
			icon.replaceWith(Object.assign(document.createElement('img'), {
				id: 'profileIcon', className: 'animal-cover profile-icon', src: animal.photos[0].url, alt: `Foto på ${animal.name}`
			}));
		} else {
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
		const save = element('button', 'primary full', 'Spara anteckning');
		save.type = 'submit';

		logForm.append(typeLabel, recordType, dateLabel, date, weightLabel, weight, noteLabel, note, save);
		recordType.dispatchEvent(new Event('change'));
	}

	async function load() {
		try {
			animal = await api(`/api/animals/${encodeURIComponent(animalId)}`);
			renderProfile();
			renderRecords();
			renderReminders();
			renderWeightChart();
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
		const payload = {
			type: recordType,
			date: String(formData.get('date')),
			weight: recordType === 'Vikt' ? Number(String(formData.get('weight')).replace(',', '.')) : null,
			note: String(formData.get('note') || '').trim()
		};
		const submitButton = logForm.querySelector('button[type="submit"]');
		submitButton.disabled = true;
		try {
			const record = await api(`/api/animals/${animalId}/records`, { method: 'POST', body: JSON.stringify(payload) });
			animal.records = [record, ...animal.records];
			renderRecords();
			renderReminders();
			renderWeightChart();
			logForm.reset();
			buildLogForm();
		} catch (error) {
			showNotice(error.message);
		} finally {
			submitButton.disabled = false;
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

	buildLogForm();
	if (animalId) load();
})();
