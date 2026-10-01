'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startTestEnvironment } = require('./support/test-environment');
const { TestClient } = require('./support/test-client');

let env;

before(async () => {
	env = await startTestEnvironment();
}, { timeout: 30000 });

after(async () => {
	if (env) await env.stop();
});

function uniqueUsername(prefix) {
	return `${prefix}${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

test('registrering, inloggning och /me', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('anna');
	const register = await client.post('/api/auth/register', { username, password: 'test12345' });
	assert.equal(register.status, 201);
	assert.equal(register.data.username, username);

	const me = await client.get('/api/auth/me');
	assert.equal(me.status, 200);
	assert.equal(me.data.username, username);

	await client.post('/api/auth/logout');
	const meAfterLogout = await client.get('/api/auth/me');
	assert.equal(meAfterLogout.status, 401);

	const login = await client.post('/api/auth/login', { username, password: 'test12345' });
	assert.equal(login.status, 200);
});

test('felaktigt lösenord ger 401', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('bertil');
	await client.post('/api/auth/register', { username, password: 'test12345' });
	await client.post('/api/auth/logout');
	const login = await client.post('/api/auth/login', { username, password: 'felLosenord' });
	assert.equal(login.status, 401);
});

test('kan skapa, läsa, uppdatera och ta bort ett djur', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('cecilia');
	await client.post('/api/auth/register', { username, password: 'test12345' });

	const created = await client.post('/api/animals', {
		name: 'Molly',
		type: 'Katt',
		breed: 'Huskatt',
		sex: 'Hona',
		neutered: true,
		initialWeight: 4.2
	});
	assert.equal(created.status, 201);
	assert.equal(created.data.name, 'Molly');
	assert.equal(created.data.isOwner, true);

	const list = await client.get('/api/animals');
	assert.equal(list.status, 200);
	assert.equal(list.data.length, 1);

	const updated = await client.put(`/api/animals/${created.data.id}`, { name: 'Molly Molnkatt', type: 'Katt', breed: 'Huskatt' });
	assert.equal(updated.status, 200);
	assert.equal(updated.data.name, 'Molly Molnkatt');

	const record = await client.post(`/api/animals/${created.data.id}/records`, {
		type: 'Kloklippning', date: '2026-01-05', weight: null, note: ''
	});
	assert.equal(record.status, 201);

	const fetched = await client.get(`/api/animals/${created.data.id}`);
	assert.equal(fetched.data.records.length, 1);

	const removed = await client.delete(`/api/animals/${created.data.id}`);
	assert.equal(removed.status, 204);

	const listAfterDelete = await client.get('/api/animals');
	assert.equal(listAfterDelete.data.length, 0);
});

test('en användare kan se men inte redigera en annan användares djur', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('dagny');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Hemlig', type: 'Hund' });
	assert.equal(created.status, 201);

	const otherClient = new TestClient(env.baseUrl);
	const otherUsername = uniqueUsername('erik');
	await otherClient.post('/api/auth/register', { username: otherUsername, password: 'test12345' });

	// "Mina djur"-listan ska bara innehålla egna och delade djur, inte andras.
	const otherList = await otherClient.get('/api/animals');
	assert.equal(otherList.status, 200);
	assert.equal(otherList.data.length, 0);

	// Men profilen går att läsa (för att kunna bläddra bland andra användares djur),
	// skrivskyddat och utan privata dokument eller delningslista.
	const directFetch = await otherClient.get(`/api/animals/${created.data.id}`);
	assert.equal(directFetch.status, 200);
	assert.equal(directFetch.data.isOwner, false);
	assert.equal(directFetch.data.isShared, false);
	assert.equal(directFetch.data.canEdit, false);
	assert.equal(directFetch.data.ownerUsername, ownerUsername);
	assert.deepEqual(directFetch.data.documents, []);
	assert.deepEqual(directFetch.data.shares, []);

	// Skrivåtgärder ska fortfarande nekas (404, för att inte läcka att id:t finns).
	const updateAttempt = await otherClient.put(`/api/animals/${created.data.id}`, { name: 'Kapad', type: 'Hund' });
	assert.equal(updateAttempt.status, 404);
	const deleteAttempt = await otherClient.delete(`/api/animals/${created.data.id}`);
	assert.equal(deleteAttempt.status, 404);
	const recordAttempt = await otherClient.post(`/api/animals/${created.data.id}/records`, { type: 'Vikt', date: '2024-01-01', weight: 4 });
	assert.equal(recordAttempt.status, 404);
});

test('man kan bläddra bland en annan användares djur skrivskyddat via /api/users/:id/animals', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('frida');
	const register = await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const ownerId = register.data.id;
	const created = await ownerClient.post('/api/animals', { name: 'Synlig', type: 'Katt' });

	const otherClient = new TestClient(env.baseUrl);
	await otherClient.post('/api/auth/register', { username: uniqueUsername('gustav'), password: 'test12345' });

	const response = await otherClient.get(`/api/users/${ownerId}/animals`);
	assert.equal(response.status, 200);
	assert.equal(response.data.username, ownerUsername);
	const animal = response.data.animals.find(item => item.id === created.data.id);
	assert.ok(animal, 'djuret ska finnas med i listan');
	assert.equal(animal.isOwner, false);
	assert.equal(animal.canEdit, false);
	assert.equal(animal.ownerUsername, ownerUsername);

	const unauthResponse = await new TestClient(env.baseUrl).get(`/api/users/${ownerId}/animals`);
	assert.equal(unauthResponse.status, 401);

	const missingUser = await otherClient.get('/api/users/00000000-0000-0000-0000-000000000000/animals');
	assert.equal(missingUser.status, 404);
});

test('delning ger en annan användare åtkomst till djuret', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('filip');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Delad', type: 'Kanin' });

	const friendClient = new TestClient(env.baseUrl);
	const friendUsername = uniqueUsername('gunnel');
	await friendClient.post('/api/auth/register', { username: friendUsername, password: 'test12345' });

	const share = await ownerClient.post(`/api/animals/${created.data.id}/shares`, { username: friendUsername });
	assert.equal(share.status, 201);

	const friendView = await friendClient.get(`/api/animals/${created.data.id}`);
	assert.equal(friendView.status, 200);
	assert.equal(friendView.data.isOwner, false);
	assert.equal(friendView.data.ownerUsername, ownerUsername);

	const friendList = await friendClient.get('/api/animals');
	const sharedEntry = friendList.data.find(animal => animal.id === created.data.id);
	assert.ok(sharedEntry, 'det delade djuret ska synas i listan');
	assert.equal(sharedEntry.isOwner, false);
	assert.equal(sharedEntry.ownerUsername, ownerUsername);

	const friendDelete = await friendClient.delete(`/api/animals/${created.data.id}`);
	// Appen svarar 404 (inte 403) för icke-ägare för att inte läcka att ett
	// annat konto äger id:t – matchar samma mönster som GET för otillåten åtkomst.
	assert.equal(friendDelete.status, 404);
});

test('listan över användare visar andra konton och delningsstatistik', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('hilda');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Delningsvän', type: 'Katt' });

	const friendClient = new TestClient(env.baseUrl);
	const friendUsername = uniqueUsername('ivar');
	await friendClient.post('/api/auth/register', { username: friendUsername, password: 'test12345' });

	await ownerClient.post(`/api/animals/${created.data.id}/shares`, { username: friendUsername });

	const ownerUsers = await ownerClient.get('/api/users');
	assert.equal(ownerUsers.status, 200);
	const friendEntry = ownerUsers.data.find(user => user.username === friendUsername);
	assert.ok(friendEntry, 'vännen ska finnas med i listan');
	assert.equal(friendEntry.sharedByMe, 1);
	assert.equal(friendEntry.sharedWithMe, 0);
	assert.ok(!ownerUsers.data.some(user => user.username === ownerUsername), 'man ska inte se sig själv i listan');

	const friendUsers = await friendClient.get('/api/users');
	const ownerEntry = friendUsers.data.find(user => user.username === ownerUsername);
	assert.ok(ownerEntry, 'ägaren ska finnas med i vännens lista');
	assert.equal(ownerEntry.sharedByMe, 0);
	assert.equal(ownerEntry.sharedWithMe, 1);

	const unauthResponse = await new TestClient(env.baseUrl).get('/api/users');
	assert.equal(unauthResponse.status, 401);
});

test('oautentiserad åtkomst nekas', async () => {
	const client = new TestClient(env.baseUrl);
	const response = await client.get('/api/animals');
	assert.equal(response.status, 401);
});

test('medicin och utgifter kan läggas till, listas och tas bort', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('hugo');
	await client.post('/api/auth/register', { username, password: 'test12345' });
	const created = await client.post('/api/animals', { name: 'Pixel', type: 'Hund' });

	const medication = await client.post(`/api/animals/${created.data.id}/medications`, {
		name: 'Antibiotika', dosage: '1 tablett', frequency: 'Två gånger dagligen', startDate: '2026-01-01'
	});
	assert.equal(medication.status, 201);

	const cost = await client.post(`/api/animals/${created.data.id}/costs`, {
		date: '2026-01-02', category: 'Veterinär', amount: 450.5, note: 'Kontroll'
	});
	assert.equal(cost.status, 201);

	const fetched = await client.get(`/api/animals/${created.data.id}`);
	assert.equal(fetched.data.medications.length, 1);
	assert.equal(fetched.data.costs.length, 1);
	assert.equal(fetched.data.costs[0].amount, 450.5);

	const deletedCost = await client.delete(`/api/animals/${created.data.id}/costs/${cost.data.id}`);
	assert.equal(deletedCost.status, 204);

	const afterDelete = await client.get(`/api/animals/${created.data.id}`);
	assert.equal(afterDelete.data.costs.length, 0);
});

test('ogiltig kostnad avvisas med 400', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('ingrid');
	await client.post('/api/auth/register', { username, password: 'test12345' });
	const created = await client.post('/api/animals', { name: 'Sune', type: 'Marsvin' });

	const invalidCost = await client.post(`/api/animals/${created.data.id}/costs`, {
		date: '2026-01-02', category: 'Veterinär', amount: -5
	});
	assert.equal(invalidCost.status, 400);
});

test('eget påminnelseintervall kan sättas och återställas', async () => {
	const client = new TestClient(env.baseUrl);
	const username = uniqueUsername('johan');
	await client.post('/api/auth/register', { username, password: 'test12345' });
	const created = await client.post('/api/animals', { name: 'Ärtan', type: 'Katt' });

	const setInterval_ = await client.put(`/api/animals/${created.data.id}/reminders/Kloklippning`, { intervalDays: 21 });
	assert.equal(setInterval_.status, 200);
	assert.equal(setInterval_.data.intervalDays, 21);

	const reset = await client.put(`/api/animals/${created.data.id}/reminders/Kloklippning`, { intervalDays: null });
	assert.equal(reset.status, 200);
});

test('CSV-export fungerar och nekas för icke-ägare', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('karin');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Smulan', type: 'Katt' });

	const exportResponse = await ownerClient.get(`/api/animals/${created.data.id}/export.csv`);
	assert.equal(exportResponse.status, 200);

	const otherClient = new TestClient(env.baseUrl);
	const otherUsername = uniqueUsername('lars');
	await otherClient.post('/api/auth/register', { username: otherUsername, password: 'test12345' });
	const deniedExport = await otherClient.get(`/api/animals/${created.data.id}/export.csv`);
	assert.equal(deniedExport.status, 404);
});

test('rate limit på delning slår till efter för många förfrågningar', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('maria');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Loppan', type: 'Hund' });

	let lastStatus = null;
	for (let i = 0; i < 31; i += 1) {
		// eslint-disable-next-line no-await-in-loop
		const response = await ownerClient.post(`/api/animals/${created.data.id}/shares`, { username: 'finns-inte-alls' });
		lastStatus = response.status;
		if (lastStatus === 429) break;
	}
	assert.equal(lastStatus, 429);
});
