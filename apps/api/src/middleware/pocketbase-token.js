import { Buffer } from 'node:buffer';
import Pocketbase from 'pocketbase';

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://localhost:8090';

export function getBearerToken(req) {
	return req.headers.authorization?.split(' ')?.[1];
}

export function decodePocketBaseAuthToken(token) {
	try {
		const base64Decoded = Buffer.from(token, 'base64').toString('utf-8');
		const tokenData = JSON.parse(base64Decoded);

		if (!tokenData?.token || !tokenData?.record) {
			return null;
		}

		return tokenData;
	} catch {
		return null;
	}
}

export async function refreshPocketBaseSession(tokenData) {
	const pocketbaseClient = new Pocketbase(POCKETBASE_URL);
	pocketbaseClient.authStore.save(tokenData.token, tokenData.record);

	return pocketbaseClient.collection(tokenData.record.collectionName).authRefresh();
}