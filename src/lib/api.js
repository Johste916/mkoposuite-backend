// Simple fetch wrapper with auth + multitenant headers.
// Usage: api('/api/payroll/payruns'), api('/api/billing/overview', {method:'POST', body:{...}})
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:10000';

export async function api(path, opts = {}) {
  const {
    method = 'GET',
    body,
    token = localStorage.getItem('token'),
    tenantId = localStorage.getItem('tenantId') || import.meta.env.VITE_DEFAULT_TENANT_ID,
    branchId = localStorage.getItem('branchId'),
    headers = {},
  } = opts;

  const h = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
    ...(branchId ? { 'x-branch-id': branchId } : {}),
    ...headers,
  };

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: h,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // Try to decode JSON, but don't crash if no body
  let data = null;
  try { data = await res.json(); } catch { data = null; }

  if (!res.ok) {
    const msg = data?.error || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
