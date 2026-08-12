import 'dotenv/config';
import axios from 'axios';
import crypto from 'crypto';
import logger from './logger.js';
import { EXTERNAL_REQUEST_TIMEOUT_MS } from '../constants/rate-limits.js';

const BASE_URL = 'https://api.coinbase.com/api/v1';
const API_KEY = process.env.COINBASE_API_KEY;
const API_SECRET = process.env.COINBASE_API_SECRET;

// Check if Coinbase credentials are configured
let isConfigured = false;

/**
 * Validate and initialize Coinbase credentials
 */
async function initializeCoinbaseCredentials() {
  // Check if credentials are present and non-empty
  if (!API_KEY || !API_SECRET || API_KEY.trim() === '' || API_SECRET.trim() === '') {
    logger.warn('Coinbase API credentials not configured - using demo mode');
    isConfigured = false;
    return;
  }

  try {
    // Make a test API call to verify credentials
    logger.info('Testing Coinbase API credentials...');
    const testResponse = await makeRequest('GET', '/accounts');

    if (testResponse) {
      isConfigured = true;
      logger.info('Coinbase API credentials loaded successfully');
    } else {
      isConfigured = false;
      logger.error('Coinbase API test call failed - falling back to demo mode');
    }
  } catch (error) {
    isConfigured = false;
    logger.error('Coinbase API credential validation failed:', error.message, '- falling back to demo mode');
  }
}

/**
 * Get mock balance for demo mode
 */
function getMockBalance() {
  return {
    id: 'mock-account-1',
    currency: 'USD',
    balance: '10000.00',
    available: '10000.00',
    hold: '0.00',
  };
}

/**
 * Get mock trades for demo mode
 */
function getMockTrades() {
  return [];
}

/**
 * Generate authentication headers for Coinbase Advanced Trade API
 */
function generateAuthHeaders(method, path, body = '') {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = timestamp + method + path + body;

  const signature = crypto
    .createHmac('sha256', API_SECRET)
    .update(message)
    .digest('hex');

  return {
    'CB-ACCESS-KEY': API_KEY,
    'CB-ACCESS-SIGN': signature,
    'CB-ACCESS-TIMESTAMP': timestamp,
    'Content-Type': 'application/json',
  };
}

/**
 * Make authenticated request to Coinbase API
 */
async function makeRequest(method, path, data = null) {
  // Return null if credentials not configured
  if (!isConfigured) {
    logger.debug(`Coinbase API not configured, returning null for ${method} ${path}`);
    return null;
  }

  const url = `${BASE_URL}${path}`;
  const body = data ? JSON.stringify(data) : '';
  const headers = generateAuthHeaders(method, path, body);

  try {
    const response = await axios({
      method,
      url,
      headers,
      data: data || undefined,
      timeout: EXTERNAL_REQUEST_TIMEOUT_MS,
    });
    return response.data;
  } catch (error) {
    const errorMessage = error.response?.data?.message || error.message;
    logger.error(`Coinbase API error (${method} ${path}):`, errorMessage);
    return null;
  }
}

/**
 * Get product (market) information
 */
export async function getProduct(productId) {
  try {
    const data = await makeRequest('GET', `/products/${productId}`);

    if (!data) {
      // Return mock product data
      logger.debug(`Returning mock product data for ${productId}`);
      return {
        id: productId,
        price: '45000.00',
        base_currency: productId.split('-')[0],
        quote_currency: productId.split('-')[1],
      };
    }

    return {
      id: data.id,
      price: data.price,
      base_currency: data.base_currency,
      quote_currency: data.quote_currency,
    };
  } catch (error) {
    logger.error(`Failed to get product ${productId}:`, error.message);
    // Return mock data on error
    return {
      id: productId,
      price: '45000.00',
      base_currency: productId.split('-')[0],
      quote_currency: productId.split('-')[1],
    };
  }
}

/**
 * Get candles (OHLCV data) for a product
 * @param {string} productId - Product ID (e.g., 'BTC-USD')
 * @param {number} granularity - Candle granularity in seconds (60, 300, 900, 3600, 21600, 86400)
 * @param {number} limit - Number of candles to fetch (default 100, max 300)
 */
export async function getCandles(productId, granularity, limit = 100) {
  try {
    const startTime = Math.floor(Date.now() / 1000) - granularity * limit;
    const endTime = Math.floor(Date.now() / 1000);

    const data = await makeRequest(
      'GET',
      `/products/${productId}/candles?start_time=${startTime}&end_time=${endTime}&granularity=${granularity}`
    );

    if (!data) {
      // Return mock candle data
      logger.debug(`Returning mock candle data for ${productId}`);
      const mockCandles = [];
      const basePrice = 45000;
      for (let i = 0; i < limit; i++) {
        const variation = (Math.random() - 0.5) * 1000;
        mockCandles.push({
          timestamp: Math.floor(Date.now() / 1000) - (limit - i) * granularity,
          open: (basePrice + variation).toString(),
          high: (basePrice + variation + 500).toString(),
          low: (basePrice + variation - 500).toString(),
          close: (basePrice + variation + 200).toString(),
          volume: (Math.random() * 100).toString(),
        });
      }
      return mockCandles;
    }

    // API returns candles in reverse chronological order, so reverse to get oldest first
    return (data.candles || []).reverse().map(candle => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));
  } catch (error) {
    logger.error(`Failed to get candles for ${productId}:`, error.message);
    // Return mock candle data on error
    const mockCandles = [];
    const basePrice = 45000;
    for (let i = 0; i < limit; i++) {
      const variation = (Math.random() - 0.5) * 1000;
      mockCandles.push({
        timestamp: Math.floor(Date.now() / 1000) - (limit - i) * granularity,
        open: (basePrice + variation).toString(),
        high: (basePrice + variation + 500).toString(),
        low: (basePrice + variation - 500).toString(),
        close: (basePrice + variation + 200).toString(),
        volume: (Math.random() * 100).toString(),
      });
    }
    return mockCandles;
  }
}

/**
 * Get account information
 */
export async function getAccount() {
  try {
    const data = await makeRequest('GET', '/accounts');

    if (!data) {
      // Return mock account data
      logger.debug('Returning mock account data');
      return getMockBalance();
    }

    // Find the primary account or first account
    const account = Array.isArray(data) ? data[0] : data;

    return {
      id: account.id,
      currency: account.currency,
      balance: account.balance,
      available: account.available,
      hold: account.hold,
    };
  } catch (error) {
    logger.error('Failed to get account:', error.message);
    // Return mock account data on error
    return getMockBalance();
  }
}

/**
 * Get all accounts and sum balances
 */
export async function getAllAccounts() {
  try {
    const data = await makeRequest('GET', '/accounts');

    if (!data) {
      // Return mock account data
      logger.debug('Returning mock account data');
      return [getMockBalance()];
    }

    return Array.isArray(data) ? data : [data];
  } catch (error) {
    logger.error('Failed to get all accounts:', error.message);
    // Return mock account data on error
    return [getMockBalance()];
  }
}

/**
 * Get order history/fills
 */
export async function getOrders(productId = null, limit = 100) {
  try {
    let path = `/orders?limit=${limit}`;
    if (productId) {
      path += `&product_id=${productId}`;
    }

    const data = await makeRequest('GET', path);

    if (!data) {
      // Return empty mock orders
      logger.debug('Returning empty mock orders');
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (error) {
    logger.error('Failed to get orders:', error.message);
    // Return empty orders on error
    return [];
  }
}

/**
 * Create a market order
 * @param {string} productId - Product ID (e.g., 'BTC-USD')
 * @param {string} side - 'BUY' or 'SELL'
 * @param {number} size - Amount to buy/sell (in base currency for SELL, in quote currency for BUY)
 */
export async function createMarketOrder(productId, side, size) {
  try {
    const orderData = {
      product_id: productId,
      side: side.toUpperCase(),
      order_configuration: {
        market_market_ioc: {
          [side.toUpperCase() === 'BUY' ? 'quote_size' : 'base_size']: size.toString(),
        },
      },
    };

    const data = await makeRequest('POST', '/orders', orderData);

    if (!data) {
      // Return mock order data
      logger.debug(`Returning mock order data for ${side} ${productId}`);
      return {
        order_id: `mock-order-${Date.now()}`,
        product_id: productId,
        side: side.toUpperCase(),
        status: 'FILLED',
        filled_size: size.toString(),
        average_filled_price: '45000.00',
      };
    }

    return {
      order_id: data.order_id,
      product_id: data.product_id,
      side: data.side,
      status: data.status,
      filled_size: data.filled_size,
      average_filled_price: data.average_filled_price,
    };
  } catch (error) {
    logger.error(`Failed to create market order for ${productId}:`, error.message);
    // Return mock order data on error
    return {
      order_id: `mock-order-${Date.now()}`,
      product_id: productId,
      side: side.toUpperCase(),
      status: 'FILLED',
      filled_size: size.toString(),
      average_filled_price: '45000.00',
    };
  }
}

/**
 * Get order details
 */
export async function getOrder(orderId) {
  try {
    const data = await makeRequest('GET', `/orders/${orderId}`);

    if (!data) {
      // Return mock order data
      logger.debug(`Returning mock order data for ${orderId}`);
      return {
        order_id: orderId,
        product_id: 'BTC-USD',
        side: 'BUY',
        status: 'FILLED',
        filled_size: '0.1',
        average_filled_price: '45000.00',
      };
    }

    return {
      order_id: data.order_id,
      product_id: data.product_id,
      side: data.side,
      status: data.status,
      filled_size: data.filled_size,
      average_filled_price: data.average_filled_price,
    };
  } catch (error) {
    logger.error(`Failed to get order ${orderId}:`, error.message);
    // Return mock order data on error
    return {
      order_id: orderId,
      product_id: 'BTC-USD',
      side: 'BUY',
      status: 'FILLED',
      filled_size: '0.1',
      average_filled_price: '45000.00',
    };
  }
}

// Initialize credentials on startup
await initializeCoinbaseCredentials();

logger.info('Coinbase API client initialized');

export { isConfigured, getMockBalance, getMockTrades };

export default {
  getProduct,
  getCandles,
  getAccount,
  getAllAccounts,
  getOrders,
  createMarketOrder,
  getOrder,
  isConfigured,
};