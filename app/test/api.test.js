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

test('en användare kan inte se en annan användares djur', async () => {
	const ownerClient = new TestClient(env.baseUrl);
	const ownerUsername = uniqueUsername('dagny');
	await ownerClient.post('/api/auth/register', { username: ownerUsername, password: 'test12345' });
	const created = await ownerClient.post('/api/animals', { name: 'Hemlig', type: 'Hund' });
	assert.equal(created.status, 201);

	const otherClient = new TestClient(env.baseUrl);
	const otherUsername = uniqueUsername('erik');
	await otherClient.post('/api/auth/register', { username: otherUsername, password: 'test12345' });

	const otherList = await otherClient.get('/api/animals');
	assert.equal(otherList.status, 200);
	assert.equal(otherList.data.length, 0);

	const directFetch = await otherClient.get(`/api/animals/${created.data.id}`);
	assert.equal(directFetch.status, 404);
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

	const friendDelete = await friendClient.delete(`/api/animals/${created.data.id}`);
	// Appen svarar 404 (inte 403) för icke-ägare för att inte läcka att ett
	// annat konto äger id:t – matchar samma mönster som GET för otillåten åtkomst.
	assert.equal(friendDelete.status, 404);
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
