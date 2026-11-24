/**
 * REST API Client & Shared Network Infrastructure
 * DragonDub AI Studio - Frontend Services
 */

let lastNotifiedBackendState = null;

export function notifyBackendOffline() {
  if (typeof window !== 'undefined' && lastNotifiedBackendState !== 'offline') {
    lastNotifiedBackendState = 'offline';
    window.dispatchEvent(new CustomEvent('backend-offline'));
  }
}

export function notifyBackendOnline() {
  if (typeof window !== 'undefined' && lastNotifiedBackendState !== 'online') {
    lastNotifiedBackendState = 'online';
    window.dispatchEvent(new CustomEvent('backend-online'));
  }
}

/**
 * Safely parse JSON responses from backend or handle proxy errors (like 502 Bad Gateway)
 * @param {Response} res
 * @param {string} defaultErrMsg
 */
export async function parseResponseJson(res, defaultErrMsg = 'Request failed') {
  if (!res) {
    throw new Error(`${defaultErrMsg}: No response received from server`);
  }
  let text = '';
  try {
    text = await res.text();
  } catch (readErr) {
    throw new Error(`${defaultErrMsg}: Could not read response stream (${readErr.message})`);
  }

  let data = null;
  if (text && text.trim().length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      // Response is not JSON (e.g. 502 Bad Gateway HTML or empty string from proxy)
      if (res.status === 502) {
        notifyBackendOffline();
        const error = new Error('Backend server is temporarily unreachable or restarting (502 Bad Gateway). Please check if backend is running.');
        error.status = 502;
        throw error;
      }
      if (!res.ok) {
        const error = new Error(`${defaultErrMsg}: Server returned status ${res.status} (${res.statusText || 'Error'})`);
        error.status = res.status;
        throw error;
      }
    }
  }

  if (!res.ok) {
    if (res.status === 502) {
      notifyBackendOffline();
    }
    let rawError = data?.error;
    if (rawError === 'fetch failed' || rawError?.startsWith('fetch failed')) {
      rawError = 'ការតភ្ជាប់ទៅកាន់ Google Gemini AI បរាជ័យ (Network / Gemini API fetch failed)។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ឬ API Key។';
    }
    const errorMsg = rawError || (res.status === 502 
      ? 'Backend server is temporarily unreachable or restarting (502 Bad Gateway).' 
      : `${defaultErrMsg} (status ${res.status})`);
    const error = new Error(errorMsg);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  if (data && data.success === false) {
    let rawError = data.error;
    if (rawError === 'fetch failed' || rawError?.startsWith('fetch failed')) {
      rawError = 'ការតភ្ជាប់ទៅកាន់ Google Gemini AI បរាជ័យ (Network / Gemini API fetch failed)។ សូមពិនិត្យការតភ្ជាប់អ៊ីនធឺណិត ឬ API Key។';
    }
    const error = new Error(rawError || defaultErrMsg);
    error.status = res.status;
    error.data = data;
    throw error;
  }

  notifyBackendOnline();
  return data || {};
}

/**
 * Check backend health status
 */
export async function checkBackendHealth() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) {
      notifyBackendOffline();
      return { online: false, data: null };
    }
    const text = await res.text();
    if (!text || !text.trim()) {
      notifyBackendOffline();
      return { online: false, data: null };
    }
    const data = JSON.parse(text);
    notifyBackendOnline();
    return { online: true, data };
  } catch {
    notifyBackendOffline();
    return { online: false, data: null };
  }
}

